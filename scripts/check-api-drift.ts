/**
 * Detecta mudanças na API do Easypanel antes que elas virem 404 em produção.
 *
 * Este projeto já foi quebrado três vezes pelo mesmo motivo: o painel mexeu na
 * API (2.31 trocou tRPC por RPC, 2.32 reorganizou o OpenAPI, 2.33 publicou a API
 * pública achatada) e a descoberta veio pelo usuário. Os testes normais comparam
 * o código com um snapshot commitado — pegam regressão NOSSA, não mudança DELES.
 * Este script compara o snapshot com o painel de verdade.
 *
 * Uso:
 *   EASYPANEL_URL=... EASYPANEL_TOKEN=... npx tsx scripts/check-api-drift.ts
 *   ... --update     reescreve o snapshot com o spec atual (para revisar no diff)
 *   ... --optional   sem as env vars, avisa e sai 0 em vez de falhar
 *
 * Sai com código 1 se houver divergência que afete as procedures mapeadas.
 *
 * `--optional` é o que permite plugar isto no `prepublishOnly`: na máquina de
 * quem publica as variáveis existem (é a mesma config do MCP), então o publish
 * confere a API de verdade antes de subir o pacote; em qualquer outro lugar
 * (CI de fork, clone sem painel) o passo simplesmente não roda.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PUBLIC_PROCEDURES } from "../src/procedures.js";
import { publicIndexFromSpec } from "../src/client.js";

const FIXTURE = new URL("../test/fixtures/easypanel-2.33-ops.json", import.meta.url);

interface Fixture {
  panelVersion: string;
  openapi: string;
  servers: unknown;
  totalOps: number;
  ops: Record<string, { method: "get" | "post"; params?: Record<string, string> }>;
}

const opcional = process.argv.includes("--optional");
const url = process.env.EASYPANEL_URL?.replace(/\/$/, "");
const token = process.env.EASYPANEL_TOKEN;

if (process.env.SKIP_API_CHECK) {
  console.log("SKIP_API_CHECK definido — verificação de drift pulada.");
  process.exit(0);
}
if (!url || !token) {
  if (opcional) {
    console.log(
      "EASYPANEL_URL/EASYPANEL_TOKEN não definidos — verificação de drift pulada.\n" +
        "(Defina-os para conferir a API do painel de verdade antes de publicar.)"
    );
    process.exit(0);
  }
  console.error("EASYPANEL_URL e EASYPANEL_TOKEN são obrigatórios.");
  process.exit(2);
}

// Painel fora do ar não é drift. Em modo opcional isso não pode barrar um
// publish — só drift de verdade barra.
let res: Response;
try {
  res = await fetch(`${url}/api/openapi.json`, { headers: { Authorization: `Bearer ${token}` } });
} catch (err) {
  const msg = `Não foi possível falar com o painel: ${(err as Error).message}`;
  if (opcional) {
    console.log(`${msg} — verificação de drift pulada.`);
    process.exit(0);
  }
  console.error(msg);
  process.exit(2);
}
if (!res.ok) {
  const msg = `Falha ao ler /api/openapi.json: HTTP ${res.status}`;
  if (opcional) {
    console.log(`${msg} — verificação de drift pulada.`);
    process.exit(0);
  }
  console.error(msg);
  process.exit(2);
}
const spec = JSON.parse(await res.text());
const live = publicIndexFromSpec(spec);
if (!live) {
  console.error(
    "O /api/openapi.json do painel não tem mais o formato achatado da API pública.\n" +
      "Isso é exatamente o tipo de mudança que este script existe para pegar — o cliente\n" +
      "precisa de um novo flavor ou de um parser atualizado."
  );
  process.exit(1);
}

const fixture: Fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
const panelVersion: string = spec?.info?.version ?? "?";

const sumiram: string[] = [];
const trocaramMetodo: string[] = [];
for (const [interno, publico] of Object.entries(PUBLIC_PROCEDURES)) {
  const op = live.get(publico);
  if (!op) {
    sumiram.push(`${interno} -> ${publico}`);
    continue;
  }
  const esperado = fixture.ops[publico]?.method;
  if (esperado && op.method !== esperado) {
    trocaramMetodo.push(`${publico}: ${esperado} -> ${op.method}`);
  }
}

// Mudanças fora do que mapeamos não quebram nada hoje, mas sinalizam que o
// painel mexeu na API — vale olhar.
const nomesLive = new Set(live.keys());
const nomesFixture = new Set(Object.keys(fixture.ops));
const novas = [...nomesLive].filter((n) => !nomesFixture.has(n));
const removidas = [...nomesFixture].filter((n) => !nomesLive.has(n));

console.log(`painel: ${panelVersion} (snapshot: ${fixture.panelVersion})`);
console.log(`operações: ${live.size} (snapshot: ${fixture.totalOps})`);

if (process.argv.includes("--update")) {
  const ops: Fixture["ops"] = {};
  for (const [nome, op] of [...live.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    ops[nome] = Object.keys(op.params).length ? { method: op.method, params: op.params } : { method: op.method };
  }
  writeFileSync(
    FIXTURE,
    JSON.stringify(
      { panelVersion, openapi: spec.openapi, servers: spec.servers, totalOps: live.size, ops },
      null,
      1
    ) + "\n"
  );
  console.log(`snapshot reescrito com o spec do painel ${panelVersion} — revise o diff.`);
}

const quebrou = sumiram.length > 0 || trocaramMetodo.length > 0;

if (sumiram.length) {
  console.error(`\n❌ ${sumiram.length} procedure(s) mapeada(s) NÃO existem mais no painel:`);
  for (const s of sumiram) console.error(`   ${s}`);
  console.error("   → as tools que dependem delas vão dar 404. Atualize src/procedures.ts.");
}
if (trocaramMetodo.length) {
  console.error(`\n❌ ${trocaramMetodo.length} procedure(s) trocaram de método HTTP:`);
  for (const s of trocaramMetodo) console.error(`   ${s}`);
  console.error("   → leitura virou escrita (ou vice-versa): o guard e o roteamento mudam.");
}
if (novas.length) {
  console.log(`\nℹ ${novas.length} operação(ões) nova(s) no painel (não usamos ainda):`);
  console.log(`   ${novas.slice(0, 25).join(", ")}${novas.length > 25 ? ", …" : ""}`);
}
if (removidas.length && !sumiram.length) {
  console.log(`\nℹ ${removidas.length} operação(ões) sumiram do painel (nenhuma delas usada):`);
  console.log(`   ${removidas.slice(0, 25).join(", ")}${removidas.length > 25 ? ", …" : ""}`);
}
if (!quebrou) console.log("\n✅ nenhuma procedure mapeada divergiu do painel.");

process.exit(quebrou ? 1 : 0);
