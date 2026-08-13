/**
 * Contrato da API pública do Easypanel (2.33+).
 *
 * Cada procedure que as tools chamam é conferida contra um snapshot real do
 * OpenAPI do painel (`fixtures/easypanel-2.33-ops.json`, 375 operações extraídas
 * de um 2.33.1). O ponto é transformar uma renomeação futura do Easypanel em
 * falha de CI em vez de 404 em produção — foi exatamente assim que o 2.33 quebrou
 * o `trpc_raw` da v2: o painel reorganizou o spec e o cliente só percebeu ao vivo.
 *
 * Para atualizar o snapshot quando sair uma versão nova do painel:
 *   curl -H "Authorization: Bearer $EASYPANEL_TOKEN" $EASYPANEL_URL/api/openapi.json
 * e regerar o fixture (paths → { method, params }).
 *
 * Rodar: `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PUBLIC_PROCEDURES, publicNameFor, internalNameFor } from "../src/procedures.js";
import { publicIndexFromSpec, toQueryParams, errorMessageFromBody } from "../src/client.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/easypanel-2.33-ops.json", import.meta.url), "utf8")
) as {
  panelVersion: string;
  ops: Record<string, { method: "get" | "post"; params?: Record<string, string> }>;
};

/** Procedures que as tools curadas chamam como LEITURA (devem ser GET no spec). */
const CURATED_READS = [
  "projects.listProjectsAndServices",
  "projects.inspectProject",
  "projects.getDockerContainers",
  "services.app.inspectService",
  "services.app.getExposedPorts",
  "services.compose.inspectService",
  "services.common.getNotes",
  "services.common.getServiceError",
  "domains.listDomains",
  "mounts.listMounts",
  "ports.listPorts",
  "actions.listActions",
  "actions.getAction",
  "monitorOld.getSystemStats",
  "monitorOld.getServiceStats",
  "monitorOld.getDockerTaskStats",
  "monitorOld.getStorageStats",
  "certificates.listCertificates",
  "cluster.listNodes",
  "users.listUsers",
];

/** Procedures que as tools curadas chamam como ESCRITA (devem ser POST no spec). */
const CURATED_WRITES = [
  "projects.createProject",
  "projects.destroyProject",
  "services.app.createService",
  "services.app.destroyService",
  "services.app.deployService",
  "services.app.startService",
  "services.app.stopService",
  "services.app.restartService",
  "services.app.updateEnv",
  "services.app.updateResources",
  "services.app.updateSourceGithub",
  "services.app.updateSourceImage",
  "services.app.enableGithubDeploy",
  "services.app.disableGithubDeploy",
  "services.common.setNotes",
  "services.common.rename",
  "services.compose.createService",
  "services.compose.deployService",
  "services.compose.destroyService",
  "services.compose.startService",
  "services.compose.stopService",
  "services.compose.restartService",
  "services.compose.updateEnv",
  "domains.createDomain",
  "domains.deleteDomain",
  "domains.setPrimaryDomain",
  "mounts.createMount",
  "ports.createPort",
  "settings.systemPrune",
  "settings.cleanupDockerImages",
  "settings.restartEasypanel",
  "server.reboot",
];

test("toda procedure mapeada existe no OpenAPI do painel 2.33", () => {
  const faltando: string[] = [];
  for (const [internal, pub] of Object.entries(PUBLIC_PROCEDURES)) {
    if (!fixture.ops[pub]) faltando.push(`${internal} -> ${pub}`);
  }
  assert.deepEqual(faltando, [], "procedures ausentes no spec do painel");
});

test("leituras curadas são GET no spec (classificação exata, sem heurística)", () => {
  for (const internal of CURATED_READS) {
    const pub = PUBLIC_PROCEDURES[internal];
    assert.ok(pub, `sem mapeamento público: ${internal}`);
    assert.equal(fixture.ops[pub].method, "get", `${internal} -> ${pub} deveria ser GET`);
  }
});

test("escritas curadas são POST no spec", () => {
  for (const internal of CURATED_WRITES) {
    const pub = PUBLIC_PROCEDURES[internal];
    assert.ok(pub, `sem mapeamento público: ${internal}`);
    assert.equal(fixture.ops[pub].method, "post", `${internal} -> ${pub} deveria ser POST`);
  }
});

test("todo banco suportado tem create/inspect/destroy mapeados", () => {
  for (const type of ["postgres", "mysql", "mariadb", "mongo", "redis"]) {
    for (const op of ["createService", "inspectService", "destroyService"]) {
      const internal = `services.${type}.${op}`;
      const pub = PUBLIC_PROCEDURES[internal];
      assert.ok(pub, `sem mapeamento: ${internal}`);
      assert.ok(fixture.ops[pub], `ausente no spec: ${internal} -> ${pub}`);
    }
  }
});

test("publicNameFor traduz a notação antiga e deixa a nova passar", () => {
  assert.equal(publicNameFor("services.app.inspectService"), "inspectAppService");
  assert.equal(publicNameFor("monitorOld.getSystemStats"), "getLegacyMonitorSystemStats");
  // nome já achatado passa direto — é o que o usuário lê no openapi.json do painel
  assert.equal(publicNameFor("listVolumeBackups"), "listVolumeBackups");
  // namespaced desconhecido → null (o chamador decide recusar ou usar o transporte interno)
  assert.equal(publicNameFor("namespace.inexistente"), null);
});

test("internalNameFor faz o caminho de volta (fallback ao transporte /api/rpc)", () => {
  assert.equal(internalNameFor("inspectAppService"), "services.app.inspectService");
  assert.equal(internalNameFor("listActions"), "actions.listActions");
  // já namespaced volta como veio
  assert.equal(internalNameFor("traefik.getDashboard"), "traefik.getDashboard");
  // achatado fora da tabela não tem equivalente interno conhecido
  assert.equal(internalNameFor("listVolumeBackups"), null);
});

test("leituras com param não-string têm rota interna (senão seriam inalcançáveis)", () => {
  // A API pública recusa número/array na query string, então estas leituras só
  // funcionam pelo transporte /api/rpc — que precisa do nome com namespace.
  // Sem mapeamento, `easypanel_raw` não conseguiria chamá-las de forma alguma.
  const comParamNaoString = Object.entries(fixture.ops)
    .filter(([, op]) => op.method === "get")
    .filter(([, op]) => Object.values(op.params ?? {}).some((t) => t !== "string"))
    .map(([nome]) => nome);

  assert.ok(comParamNaoString.length > 0, "fixture sem nenhuma leitura de param não-string?");
  const semRota = comParamNaoString.filter((nome) => internalNameFor(nome) === null);
  assert.deepEqual(
    semRota,
    [],
    `leituras inalcançáveis (nem query string nem rota interna): ${semRota.join(", ")}`
  );
});

test("a tradução é uma bijeção (nenhum nome público repetido)", () => {
  const publicos = Object.values(PUBLIC_PROCEDURES);
  assert.equal(
    new Set(publicos).size,
    publicos.length,
    "dois nomes internos apontam para o mesmo público — o reverso ficaria ambíguo"
  );
});

// ---------------------------------------------------------------------------
// publicIndexFromSpec — reconhecer o formato certo de spec
// ---------------------------------------------------------------------------

test("publicIndexFromSpec indexa método e params do spec achatado (2.33)", () => {
  const index = publicIndexFromSpec({
    servers: [{ url: "/api" }],
    paths: {
      "/inspectAppService": {
        get: {
          parameters: [
            { name: "projectName", schema: { type: "string" } },
            { name: "serviceName", schema: { type: "string" } },
          ],
        },
      },
      "/deployAppService": { post: {} },
      "/listActions": { get: { parameters: [{ name: "limit", schema: { type: "number" } }] } },
    },
  });
  assert.ok(index);
  assert.equal(index!.get("inspectAppService")?.method, "get");
  assert.equal(index!.get("deployAppService")?.method, "post");
  assert.equal(index!.get("listActions")?.params.limit, "number");
});

test("publicIndexFromSpec ignora spec de painel 2.31/2.32 (paths com /api/rpc/)", () => {
  // Painéis antigos não podem ser lidos como públicos por engano — os paths têm
  // mais de um segmento, então nenhum casa com o formato achatado.
  assert.equal(
    publicIndexFromSpec({
      servers: [{ url: "/api/rpc" }],
      paths: { "/projects/listProjects": { post: {} }, "/services/app/deployService": { post: {} } },
    }),
    null
  );
  assert.equal(publicIndexFromSpec({ paths: {} }), null);
  assert.equal(publicIndexFromSpec(null), null);
});

test("publicIndexFromSpec casa com o snapshot real do painel", () => {
  // Sanidade do fixture: as 375 operações continuam no formato que o cliente espera.
  const ops = Object.keys(fixture.ops);
  assert.ok(ops.length > 300, `esperava ~375 operações, veio ${ops.length}`);
  assert.equal(fixture.ops["listProjects"].method, "get");
  assert.equal(fixture.ops["createProject"].method, "post");
});

// ---------------------------------------------------------------------------
// toQueryParams — a API pública não faz coerção de tipo em query string
// ---------------------------------------------------------------------------

test("toQueryParams serializa input só-string", () => {
  assert.equal(
    toQueryParams({ projectName: "app", serviceName: "web" })?.toString(),
    "projectName=app&serviceName=web"
  );
  assert.equal(toQueryParams(undefined)?.toString(), "");
  assert.equal(toQueryParams({})?.toString(), "");
});

test("toQueryParams ignora campos opcionais não informados", () => {
  assert.equal(toQueryParams({ a: "1", b: undefined })?.toString(), "a=1");
});

test("toQueryParams recusa valores não-string (força o transporte interno)", () => {
  // O painel valida query params com zod SEM coerção: `?limit=5` chega "5" e é
  // rejeitado. Devolver null aqui é o que faz o cliente cair no /api/rpc.
  assert.equal(toQueryParams({ limit: 50 }), null);
  assert.equal(toQueryParams({ enabled: true }), null);
  assert.equal(toQueryParams({ levels: ["error"] }), null);
  assert.equal(toQueryParams({ values: { port: 3000 } }), null);
  assert.equal(toQueryParams(["a"]), null);
});

// ---------------------------------------------------------------------------
// errorMessageFromBody — zodErrors por campo viram diagnóstico acionável
// ---------------------------------------------------------------------------

test("errorMessageFromBody expõe os zodErrors campo a campo", () => {
  const msg = errorMessageFromBody({
    code: "BAD_REQUEST",
    message: "Input validation failed",
    data: { zodErrors: { projectName: "Required", serviceName: "Invalid name." } },
  });
  assert.match(msg!, /Input validation failed/);
  assert.match(msg!, /projectName: Required/);
  assert.match(msg!, /serviceName: Invalid name\./);
});

test("errorMessageFromBody cobre as três gerações de envelope", () => {
  assert.equal(errorMessageFromBody({ message: "Project not found." }), "Project not found.");
  assert.equal(errorMessageFromBody({ json: { message: "Service not found." } }), "Service not found.");
  assert.equal(
    errorMessageFromBody({ error: { json: { message: "UNAUTHORIZED" } } }),
    "UNAUTHORIZED"
  );
  assert.equal(errorMessageFromBody({}), null);
});

test("errorMessageFromBody trunca mensagem gigante do servidor", () => {
  const msg = errorMessageFromBody({ message: "x".repeat(500) });
  assert.ok(msg!.length <= 301, `mensagem não truncada: ${msg!.length}`);
});
