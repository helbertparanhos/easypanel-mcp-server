/**
 * Testes do mascaramento central de segredos (src/mascarar.ts) e da sua
 * aplicação em `handleTool`.
 *
 * Não tocam a rede: as funções puras são exercitadas direto, e os testes de ponta
 * a ponta trocam o `fetch` global por um painel falso (flavor `rpc`) que devolve
 * dados FICTÍCIOS — nenhum token ou senha real aparece aqui.
 *
 * Rodar: `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MASCARA,
  chaveSensivel,
  mascararTexto,
  mascarar,
  mascararTextoDeTool,
  devolveSegredos,
} from "../src/mascarar.js";

// ---------------------------------------------------------------------------
// Dados fictícios
// ---------------------------------------------------------------------------
const SEGREDOS = {
  senhaBanco: "s3nhaFakeBanco",
  pepper: "pepperFake999",
  tokenDeploy: "tokFake_abcdef0123456789",
  tokenGit: "ghp_FAKEtoken123456",
  senhaBasicAuth: "basicFakeSenha",
  senhaAninhada: "aninhadaFakeSenha",
  senhaPostgres: "pgFakeSenha42",
};

const ENV_TEXTO = [
  `DATABASE_URL=postgres://u:${SEGREDOS.senhaBanco}@db.interno:5432/loja`,
  `PAT_PEPPER=${SEGREDOS.pepper}`,
  "NODE_ENV=production",
  "PORT=3000",
].join("\n");

const SERVICO = {
  name: "api",
  projectName: "loja",
  type: "app",
  image: "ghcr.io/acme/api:1.2.3",
  source: {
    type: "git",
    repo: `https://deploy-bot:${SEGREDOS.tokenGit}@github.com/acme/api.git`,
    ref: "main",
  },
  env: ENV_TEXTO,
  token: SEGREDOS.tokenDeploy,
  deploymentUrl: `https://painel.exemplo.test/api/deploy/${SEGREDOS.tokenDeploy}`,
  notes: `webhook antigo: https://painel.exemplo.test/api/deploy/${SEGREDOS.tokenDeploy}`,
  domains: [{ host: "api.exemplo.com.br", https: true, port: 3000 }],
  basicAuth: [{ username: "admin", password: SEGREDOS.senhaBasicAuth }],
  deploy: { replicas: 1, zeroDowntime: true },
  advanced: { database: { config: { password: SEGREDOS.senhaAninhada } } },
};

function semSegredos(texto: string, quais: string[] = Object.values(SEGREDOS)) {
  for (const s of quais) assert.ok(!texto.includes(s), `segredo vazou: ${s}\n---\n${texto}`);
}

// ---------------------------------------------------------------------------
// chaveSensivel
// ---------------------------------------------------------------------------
test("chaveSensivel reconhece nomes de segredo em qualquer convenção", () => {
  for (const k of [
    "password", "DATABASE_PASSWORD", "apiToken", "token", "PAT_PEPPER", "JWT_SECRET",
    "privateKey", "SSH_KEY", "credentials", "basicAuth", "webhookUrl", "deploymentUrl",
    "deployUrl", "DB_PASS", "pwd", "PASSWORD_SALT", "SESSION_COOKIE",
  ]) {
    assert.equal(chaveSensivel(k), true, k);
  }
  for (const k of [
    "name", "image", "host", "domains", "PORT", "NODE_ENV", "DATABASE_URL", "replicas",
    "passthrough", "autoDeploy", "key", "type", "projectName",
  ]) {
    assert.equal(chaveSensivel(k), false, k);
  }
});

// ---------------------------------------------------------------------------
// mascararTexto — por forma
// ---------------------------------------------------------------------------
test("mascararTexto: token do webhook de deploy em qualquer string", () => {
  const t = `curl -X POST https://painel.exemplo.test/api/deploy/${SEGREDOS.tokenDeploy}?ref=main`;
  const m = mascararTexto(t);
  assert.equal(m, "curl -X POST https://painel.exemplo.test/api/deploy/***?ref=main");
});

test("mascararTexto: credencial em URL some, esquema/host/caminho ficam", () => {
  assert.equal(
    mascararTexto(`postgres://u:${SEGREDOS.senhaBanco}@db.interno:5432/loja`),
    "postgres://***@db.interno:5432/loja"
  );
  assert.equal(
    mascararTexto(`https://deploy-bot:${SEGREDOS.tokenGit}@github.com/acme/api.git`),
    "https://***@github.com/acme/api.git"
  );
  // token como usuário (formato comum do GitHub)
  assert.equal(mascararTexto(`https://${SEGREDOS.tokenGit}@github.com/a/b`), "https://***@github.com/a/b");
  // senha com @ sem escape
  assert.equal(mascararTexto("mysql://root:p@ss@db:3306/x"), "mysql://***@db:3306/x");
  // `git@` em URL ssh não é segredo
  assert.equal(mascararTexto("ssh://git@github.com/acme/api.git"), "ssh://git@github.com/acme/api.git");
  // URL sem credencial fica igual
  assert.equal(mascararTexto("https://api.exemplo.com.br/health"), "https://api.exemplo.com.br/health");
});

test("mascararTexto: env em texto (CHAVE=valor por linha)", () => {
  const m = mascararTexto(ENV_TEXTO);
  assert.equal(
    m,
    [
      "DATABASE_URL=postgres://***@db.interno:5432/loja",
      "PAT_PEPPER=***",
      "NODE_ENV=production",
      "PORT=3000",
    ].join("\n")
  );
});

test("mascararTexto: env com CRLF, export, aspas e espaços no valor", () => {
  const m = mascararTexto('export JWT_SECRET="frase fake com espaco"\r\nAPP_NAME=loja\r\n');
  assert.equal(m, "export JWT_SECRET=***\r\nAPP_NAME=loja\r\n");
});

test("mascararTexto: compose YAML (mapa e lista)", () => {
  const yaml = [
    "services:",
    "  db:",
    "    image: postgres:16",
    "    environment:",
    `      POSTGRES_PASSWORD: ${SEGREDOS.senhaPostgres}`,
    `      - REDIS_PASSWORD=${SEGREDOS.senhaPostgres}`,
    "      POSTGRES_DB: loja",
  ].join("\n");
  const m = mascararTexto(yaml);
  semSegredos(m, [SEGREDOS.senhaPostgres]);
  assert.ok(m.includes("image: postgres:16"));
  assert.ok(m.includes("POSTGRES_DB: loja"));
  assert.ok(m.includes("POSTGRES_PASSWORD: ***"));
});

test("mascararTexto: atribuição no meio da linha, query string e Bearer", () => {
  assert.equal(
    mascararTexto(`docker run -e DB_PASSWORD=${SEGREDOS.senhaBanco} -e PORT=3000 img`),
    "docker run -e DB_PASSWORD=*** -e PORT=3000 img"
  );
  assert.equal(
    mascararTexto(`https://api.exemplo.com.br/x?api_key=${SEGREDOS.tokenGit}&page=2`),
    "https://api.exemplo.com.br/x?api_key=***&page=2"
  );
  assert.equal(
    mascararTexto(`chamando com Bearer ${SEGREDOS.tokenGit}`),
    "chamando com Bearer ***"
  );
});

test("mascararTexto: chave privada PEM", () => {
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIfakefakefake\n-----END RSA PRIVATE KEY-----";
  assert.equal(mascararTexto(`chave:\n${pem}\nfim`), "chave:\n***\nfim");
});

test("mascararTexto: texto sem segredo passa intacto", () => {
  const t = "Deploy concluído em 32s\nimagem ghcr.io/acme/api:1.2.3\nhttps://api.exemplo.com.br";
  assert.equal(mascararTexto(t), t);
});

// ---------------------------------------------------------------------------
// mascarar — por estrutura
// ---------------------------------------------------------------------------
test("mascarar: password aninhado em qualquer profundidade", () => {
  const m = mascarar({ a: { b: [{ c: { password: SEGREDOS.senhaAninhada, user: "app" } }] } }) as any;
  assert.equal(m.a.b[0].c.password, MASCARA);
  assert.equal(m.a.b[0].c.user, "app");
});

test("mascarar: tudo abaixo de um campo sensível vira ***, booleanos ficam", () => {
  const m = mascarar({
    secrets: { FOO: "x1", nested: ["y2", 42] },
    twoFactorEnabled: true,
    privateRegistry: null,
  }) as any;
  assert.deepEqual(m.secrets, { FOO: MASCARA, nested: [MASCARA, MASCARA] });
  assert.equal(m.twoFactorEnabled, true);
  assert.equal(m.privateRegistry, null);
});

test("mascarar: pares { key|name, value } com nome sensível", () => {
  const m = mascarar([
    { key: "PAT_PEPPER", value: SEGREDOS.pepper },
    { name: "PORT", value: "3000" },
  ]) as any;
  assert.deepEqual(m, [
    { key: "PAT_PEPPER", value: MASCARA },
    { name: "PORT", value: "3000" },
  ]);
});

test("mascarar: serviço com token de deploy — segredos somem, resto intacto", () => {
  const m = mascarar(SERVICO) as any;
  semSegredos(JSON.stringify(m));
  assert.equal(m.token, MASCARA);
  assert.equal(m.deploymentUrl, MASCARA);
  assert.equal(m.notes, "webhook antigo: https://painel.exemplo.test/api/deploy/***");
  assert.equal(m.source.repo, "https://***@github.com/acme/api.git");
  assert.equal(m.basicAuth[0].password, MASCARA);
  assert.equal(m.advanced.database.config.password, MASCARA);
  // não sensíveis
  assert.equal(m.name, "api");
  assert.equal(m.image, "ghcr.io/acme/api:1.2.3");
  assert.deepEqual(m.domains, SERVICO.domains);
  assert.deepEqual(m.deploy, SERVICO.deploy);
  assert.ok(m.env.includes("NODE_ENV=production"));
  assert.ok(m.env.includes("DATABASE_URL=postgres://***@db.interno:5432/loja"));
});

// ---------------------------------------------------------------------------
// mascararTextoDeTool — formato real de resposta (cabeçalho + JSON)
// ---------------------------------------------------------------------------
test("mascararTextoDeTool preserva o cabeçalho de contexto e o JSON válido", () => {
  const texto = `[Contexto ativo: projeto="loja" | serviço="api"]\n\n` + JSON.stringify(SERVICO, null, 2);
  const m = mascararTextoDeTool(texto);
  assert.ok(m.startsWith(`[Contexto ativo: projeto="loja" | serviço="api"]\n\n`));
  const corpo = JSON.parse(m.slice(m.indexOf("\n\n") + 2));
  assert.equal(corpo.token, MASCARA);
  semSegredos(m);
});

test("mascararTextoDeTool em texto que não é JSON (logs)", () => {
  const m = mascararTextoDeTool(`boot ok\nPAT_PEPPER=${SEGREDOS.pepper}\nouvindo :3000`);
  assert.equal(m, "boot ok\nPAT_PEPPER=***\nouvindo :3000");
});

test("devolveSegredos só abre exceção com booleano true explícito", () => {
  assert.equal(devolveSegredos("get_env_vars", { include_values: true }), true);
  assert.equal(devolveSegredos("get_env_vars", { include_values: "true" }), false);
  assert.equal(devolveSegredos("get_env_vars", {}), false);
  assert.equal(devolveSegredos("inspect_database", { include_secrets: true }), true);
  assert.equal(devolveSegredos("inspect_service", { include_values: true, include_secrets: true }), false);
  assert.equal(devolveSegredos("easypanel_raw", { include_values: true }), false);
});

// ---------------------------------------------------------------------------
// Ponta a ponta: handleTool com um painel falso (sem rede)
// ---------------------------------------------------------------------------
const ROTAS: Record<string, unknown> = {
  "/api/rpc/projects/listProjectsAndServices": {
    projects: [{ name: "loja" }],
    services: [
      { projectName: "loja", name: "api", type: "app" },
      { projectName: "loja", name: "db", type: "postgres" },
    ],
  },
  "/api/rpc/services/app/inspectService": SERVICO,
  "/api/rpc/projects/inspectProject": { project: { name: "loja" }, services: [SERVICO] },
  "/api/rpc/services/postgres/inspectService": {
    name: "db",
    image: "postgres:16",
    username: "loja",
    password: SEGREDOS.senhaPostgres,
    internalHost: "loja_db",
    exposedPort: 5432,
    database: "loja",
  },
};

const SPEC = {
  paths: Object.fromEntries(Object.keys(ROTAS).map((p) => [p, { get: {}, post: {} }])),
};

async function comPainelFalso(fn: () => Promise<void>) {
  const fetchOriginal = globalThis.fetch;
  process.env.EASYPANEL_URL = "https://painel.exemplo.test";
  process.env.EASYPANEL_TOKEN = "token-ficticio-de-teste";
  process.env.EASYPANEL_API_FLAVOR = "rpc";
  globalThis.fetch = (async (url: string | URL) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/openapi.json") return new Response(JSON.stringify(SPEC), { status: 200 });
    if (path in ROTAS) return new Response(JSON.stringify({ json: ROTAS[path] }), { status: 200 });
    return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = fetchOriginal;
  }
}

async function chamar(nome: string, args: Record<string, unknown>): Promise<string> {
  const { handleTool } = await import("../src/tools/index.js");
  const r = (await handleTool(nome, args)) as { content: { type: string; text: string }[] };
  return r.content.map((c) => c.text).join("\n");
}

test("handleTool: inspect_service não devolve token de deploy nem env sensível", async () => {
  await comPainelFalso(async () => {
    const texto = await chamar("inspect_service", { projectName: "loja", serviceName: "api" });
    semSegredos(texto);
    assert.ok(texto.includes('"image": "ghcr.io/acme/api:1.2.3"'));
    assert.ok(texto.includes('"host": "api.exemplo.com.br"'));
    assert.ok(texto.includes('"name": "api"'));
    assert.ok(texto.includes("/api/deploy/***"));
  });
});

test("handleTool: get_project também sai mascarado", async () => {
  await comPainelFalso(async () => {
    semSegredos(await chamar("get_project", { projectName: "loja" }));
  });
});

test("handleTool: get_env_vars sem include_values mascara; com true devolve tudo", async () => {
  await comPainelFalso(async () => {
    const mascarado = await chamar("get_env_vars", { projectName: "loja", serviceName: "api" });
    semSegredos(mascarado);
    const corpo = JSON.parse(mascarado.slice(mascarado.indexOf("\n\n") + 2));
    assert.equal(corpo.env_vars.PAT_PEPPER, MASCARA);
    assert.equal(corpo.env_vars.DATABASE_URL, "postgres://***@db.interno:5432/loja");
    assert.equal(corpo.env_vars.NODE_ENV, "production");
    assert.equal(corpo.masked_vars, 2);

    // string "true" não conta como pedido explícito
    semSegredos(
      await chamar("get_env_vars", { projectName: "loja", serviceName: "api", include_values: "true" })
    );

    const revelado = await chamar("get_env_vars", {
      projectName: "loja",
      serviceName: "api",
      include_values: true,
    });
    assert.ok(revelado.includes(SEGREDOS.pepper));
    assert.ok(revelado.includes(SEGREDOS.senhaBanco));
  });
});

test("handleTool: easypanel_raw mascara por padrão", async () => {
  await comPainelFalso(async () => {
    const texto = await chamar("easypanel_raw", {
      procedure: "services.app.inspectService",
      input: { projectName: "loja", serviceName: "api" },
    });
    semSegredos(texto);
    assert.ok(texto.includes("ghcr.io/acme/api:1.2.3"));
  });
});

test("handleTool: inspect_database mascara senha e connection string, salvo include_secrets", async () => {
  await comPainelFalso(async () => {
    const args = { projectName: "loja", serviceName: "db", type: "postgres" };
    const mascarado = await chamar("inspect_database", args);
    semSegredos(mascarado, [SEGREDOS.senhaPostgres]);
    assert.ok(mascarado.includes('"connection_string": "postgresql://***@loja_db:5432/loja"'));
    assert.ok(mascarado.includes('"username": "loja"'));

    const revelado = await chamar("inspect_database", { ...args, include_secrets: true });
    assert.ok(revelado.includes(SEGREDOS.senhaPostgres));
  });
});
