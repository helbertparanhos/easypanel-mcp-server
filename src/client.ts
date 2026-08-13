import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import WebSocket from "ws";
import { isReadOnly } from "./context.js";
import { publicNameFor, internalNameFor } from "./procedures.js";

/**
 * Geração da API do painel:
 *  - "trpc"   — Easypanel ≤ 2.30: tRPC clássico. Queries via GET `?input={"json":...}`,
 *    mutations via POST; resposta embrulhada em `{ result: { data: { json } } }`.
 *  - "rpc"    — Easypanel 2.31–2.32: camada RPC (estilo oRPC) em `/api/rpc/*`. O GET
 *    documentado com query params não aceita input na prática (400) — o caminho
 *    confiável é POST `{"json": input}` para QUALQUER procedure (leitura e escrita);
 *    resposta vem como `{ "json": dado }`.
 *  - "public" — Easypanel ≥ 2.33: API pública documentada. Cada procedure é um path
 *    achatado em `/api/<nome>`, com GET para leitura e POST (body JSON puro) para
 *    escrita, e a resposta é o dado CRU, sem envelope. É a superfície que o
 *    Easypanel se comprometeu a manter estável — a interna segue viva, mas o
 *    changelog do 2.33 avisa que "may change without notice".
 */
export type ApiFlavor = "trpc" | "rpc" | "public";

/** Override manual da geração da API via env (pula a auto-detecção). */
export function flavorFromEnv(): ApiFlavor | null {
  const v = (process.env.EASYPANEL_API_FLAVOR || "").toLowerCase();
  if (v === "trpc" || v === "legacy") return "trpc";
  if (v === "rpc" || v === "modern") return "rpc";
  if (v === "public") return "public";
  return null;
}

/**
 * Identifica a geração da API pela forma do corpo de resposta. Cada geração
 * responde com a própria forma até em erros de auth, então a detecção funciona
 * mesmo com token inválido (e o erro real aparece na primeira chamada de verdade).
 *
 * ⚠️ Só distingue trpc de rpc. O 2.33 responde `{"json":...}` em `/api/trpc/*`
 * também (as rotas antigas continuam vivas) — por isso a detecção do "public"
 * acontece ANTES, por rota exclusiva, e não por forma de corpo.
 */
export function flavorFromBody(data: unknown): ApiFlavor | null {
  if (!data || typeof data !== "object") return null;
  if ("result" in data || "error" in data) return "trpc";
  if ("json" in data) return "rpc";
  return null;
}

/**
 * Converte `services.app.inspectService` → `/api/rpc/services/app/inspectService`.
 * Assume nome JÁ validado (`isValidProcedureName` em raw.ts ou literal hardcoded
 * nas tools curadas) — não defende contra path traversal por conta própria.
 */
export function rpcPath(procedure: string): string {
  return "/api/rpc/" + procedure.split(".").join("/");
}

/** Natureza da procedure: leitura (`query`) ou escrita (`mutation`). */
export type ProcKind = "query" | "mutation";

/**
 * Verbos iniciais que marcam leitura na convenção de nomes do Easypanel.
 * Fechado de propósito: qualquer verbo fora daqui vira `mutation` (fail-closed).
 * Confere com as 374 procedures do 2.32.2 e com as 19 leituras das tools curadas.
 */
const READ_VERBS = new Set(["get", "list", "inspect", "check", "query", "search"]);

/**
 * Classifica pela convenção de nomes (`services.app.inspectService` → query).
 * Só é usada no flavor "rpc" (2.32), onde o OpenAPI do painel deixou de carregar a
 * distinção; o chamador restringe o uso a procedures que existem no spec.
 * No flavor "public" ela não é necessária — o método HTTP do spec é exato.
 */
export function procKindFromName(procedure: string): ProcKind {
  const leaf = procedure.split(".").pop() ?? "";
  const verb = /^[a-z]+/.exec(leaf)?.[0];
  return verb && READ_VERBS.has(verb) ? "query" : "mutation";
}

/**
 * Monta o mapa procedure (minúscula) → natureza a partir do OpenAPI de painéis
 * 2.31–2.32. Duas formas de spec no mundo real:
 *  - 2.31: paths já em `/api/rpc/*`, queries documentadas em GET → o método HTTP
 *    dá a distinção (GET = query, só-POST = mutation).
 *  - 2.32: prefixo migrou para `servers[].url` e os paths ficaram nus
 *    (`/projects/listProjects`); TUDO virou POST e o spec deixou de carregar
 *    qualquer marca de leitura/escrita → cai na convenção de nomes, ainda
 *    restrita às procedures presentes no spec.
 * O nome sai do `operationId` (já é `ns.proc`), com o path como reserva.
 */
export function kindMapFromSpec(spec: any): Map<string, ProcKind> | null {
  const paths = spec?.paths;
  if (!paths || typeof paths !== "object") return null;
  const base =
    typeof spec?.servers?.[0]?.url === "string" ? spec.servers[0].url.replace(/\/+$/, "") : "";
  const HTTP = ["get", "post", "put", "patch", "delete"];

  const entries: { proc: string; methods: string[] }[] = [];
  for (const [p, ops] of Object.entries<any>(paths)) {
    if (!ops || typeof ops !== "object") continue;
    const methods = HTTP.filter((m) => m in ops);
    if (methods.length === 0) continue;
    const opId = methods.map((m) => ops[m]?.operationId).find((v) => typeof v === "string");
    let proc: string;
    if (opId && /^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$/.test(opId)) {
      proc = opId;
    } else {
      // Reserva: reconstrói do path. O prefixo pode já estar no path (2.31) ou
      // vir de `servers` (2.32) — normaliza as duas antes de exigir /api/rpc/.
      const full = p.startsWith("/api/rpc/") ? p : base + p;
      if (!full.startsWith("/api/rpc/")) continue;
      proc = full.slice("/api/rpc/".length).split("/").join(".");
    }
    entries.push({ proc, methods });
  }
  if (entries.length === 0) return null;

  // Um GET em qualquer lugar = spec ainda distingue leitura de escrita (2.31).
  const specSeparatesByMethod = entries.some((e) => e.methods.includes("get"));
  const map = new Map<string, ProcKind>();
  for (const { proc, methods } of entries) {
    const kind: ProcKind = specSeparatesByMethod
      ? methods.includes("get")
        ? "query"
        : "mutation"
      : procKindFromName(proc);
    // Chave em minúsculas: o lookup também normaliza, para o guard não ser
    // contornável por variação de caixa (a regex do raw aceita A-Z).
    map.set(proc.toLowerCase(), kind);
  }
  return map;
}

/** Uma operação da API pública (2.33+): método HTTP e, em GET, os tipos dos params. */
export interface PublicOp {
  method: "get" | "post";
  /** Nome do query param → tipo declarado no schema (só para GET). */
  params: Record<string, string>;
}

/**
 * Indexa o OpenAPI da API pública (2.33+): `/api/<nome>` → método e params.
 *
 * Reconhece o formato pelo que ele é: paths de UM segmento, sem o prefixo
 * `/api/rpc/` das gerações anteriores. Devolve `null` se o spec não tiver essa
 * cara — assim um painel 2.31/2.32 nunca é lido como público por engano.
 */
export function publicIndexFromSpec(spec: any): Map<string, PublicOp> | null {
  const paths = spec?.paths;
  if (!paths || typeof paths !== "object") return null;

  const index = new Map<string, PublicOp>();
  for (const [p, ops] of Object.entries<any>(paths)) {
    if (!ops || typeof ops !== "object") continue;
    // Path achatado de um segmento só: "/inspectAppService".
    const m = /^\/([a-zA-Z][a-zA-Z0-9_]*)$/.exec(p);
    if (!m) continue;
    const method = ops.get ? "get" : ops.post ? "post" : null;
    if (!method) continue;
    const params: Record<string, string> = {};
    if (method === "get") {
      for (const pa of ops.get.parameters ?? []) {
        if (pa?.name) params[pa.name] = pa.schema?.type ?? "unknown";
      }
    }
    index.set(m[1], { method, params });
  }
  return index.size > 0 ? index : null;
}

/**
 * Serializa o input como query string da API pública. Devolve `null` quando
 * algum valor NÃO é string.
 *
 * Não é preciosismo: o painel 2.33 valida os query params com zod SEM coerção —
 * `?limit=5` chega como `"5"` e é rejeitado com "Expected number, received
 * string". Não há codificação que resolva (testado com `limit=5` e `limit[]=5`).
 * Quando isso acontece o chamador cai no transporte RPC interno, que carrega o
 * input como JSON no body e preserva os tipos.
 */
export function toQueryParams(input: unknown): URLSearchParams | null {
  if (input === undefined || input === null) return new URLSearchParams();
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (v === undefined) continue; // campo opcional não informado
    if (typeof v !== "string") return null;
    params.set(k, v);
  }
  return params;
}

/**
 * Prepara uma mensagem de erro estruturada do servidor para ir ao contexto do
 * LLM: colapsa whitespace e trunca. O campo é controlado pelo servidor — sem
 * teto, um painel comprometido poderia injetar texto arbitrário/enorme no
 * contexto via mensagens de erro.
 */
export function safeServerMessage(msg: unknown): string | null {
  if (typeof msg !== "string") return null;
  const oneLine = msg.replace(/\s+/g, " ").trim();
  if (!oneLine) return null;
  return oneLine.length > 300 ? oneLine.slice(0, 300) + "…" : oneLine;
}

/**
 * Extrai a mensagem de erro das três gerações, incluindo os `zodErrors` de
 * validação que a API pública devolve por campo:
 *   { code:"BAD_REQUEST", message:"Input validation failed",
 *     data:{ zodErrors:{ projectName:"Required" } } }
 * Sem isso o agente só vê "Input validation failed" e não sabe o que corrigir.
 */
export function errorMessageFromBody(data: any): string | null {
  const base = safeServerMessage(
    data?.message ?? data?.json?.message ?? data?.error?.json?.message ?? data?.error?.message
  );
  const zod = data?.data?.zodErrors;
  if (zod && typeof zod === "object" && !Array.isArray(zod)) {
    const fields = Object.entries(zod)
      .slice(0, 8)
      .map(([field, msg]) => `${field}: ${safeServerMessage(msg) ?? "inválido"}`)
      .join("; ");
    if (fields) return base ? `${base} (${fields})` : fields;
  }
  return base;
}

/** Desembrulha o payload das gerações com envelope (tRPC legado e RPC 2.31–2.32). */
export function unwrapBody(data: any): unknown {
  if (data && typeof data === "object") {
    if ("result" in data) return data.result?.data?.json ?? data.result?.data ?? data.result;
    if ("json" in data) return data.json;
  }
  return data;
}

export class EasyPanelClient {
  private baseUrl: string;
  private token: string;
  private flavorCache: ApiFlavor | null = null;
  private kindMap: Map<string, ProcKind> | null = null;
  private kindMapInFlight: Promise<Map<string, ProcKind> | null> | null = null;
  private publicIndex: Map<string, PublicOp> | null = null;
  private publicIndexInFlight: Promise<Map<string, PublicOp> | null> | null = null;
  private flavorInFlight: Promise<ApiFlavor> | null = null;
  /** Versão do painel, capturada na detecção — só para diagnóstico/log. */
  private panelVersion: string | null = null;

  constructor() {
    const url = process.env.EASYPANEL_URL;
    const token = process.env.EASYPANEL_TOKEN;
    if (!url) throw new Error("EASYPANEL_URL não definida. Configure seu .env");
    if (!token) throw new Error("EASYPANEL_TOKEN não definida. Configure seu .env");
    this.baseUrl = url.replace(/\/$/, "");
    this.token = token;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  /** Geração da API em uso: override por env > cache > auto-detecção. */
  private async getFlavor(): Promise<ApiFlavor> {
    const forced = flavorFromEnv();
    if (forced) return forced;
    if (this.flavorCache) return this.flavorCache;
    if (!this.flavorInFlight) {
      this.flavorInFlight = this.detectFlavor()
        .then(({ flavor, cacheable }) => {
          // Só memoriza uma detecção confiável. Se a sonda da API pública falhou
          // por motivo transitório (rede, 5xx), o resultado abaixo dela é um
          // palpite — cachear prenderia o processo inteiro na API interna, que o
          // Easypanel declarou instável. Sem cache, a próxima chamada re-detecta.
          if (cacheable) this.flavorCache = flavor;
          return flavor;
        })
        .finally(() => {
          this.flavorInFlight = null;
        });
    }
    return this.flavorInFlight;
  }

  private async detectFlavor(): Promise<{ flavor: ApiFlavor; cacheable: boolean }> {
    // ORDEM IMPORTA. O 2.33 mantém `/api/trpc/*` e `/api/rpc/*` vivos respondendo
    // `{"json":...}` — sondar a rota antiga primeiro classificaria um painel 2.33
    // como "rpc". `GET /api/getUpdateStatus` só existe na API pública (2.33+),
    // é leitura sem input e ainda entrega a versão do painel de brinde.
    //
    // `conclusiva` separa "o painel respondeu que essa rota não existe" (404/401 →
    // é mesmo um painel antigo) de "não deu para saber" (rede caiu, 502 do proxy).
    let sondaPublicaConclusiva = true;
    try {
      const res = await fetch(`${this.baseUrl}/api/getUpdateStatus`, { headers: this.headers() });
      if (res.ok) {
        const data = JSON.parse(await res.text());
        if (data && typeof data === "object" && !("json" in data) && "version" in data) {
          this.panelVersion = typeof data.version === "string" ? data.version : null;
          process.stderr.write(
            `[easypanel-mcp] painel ${this.panelVersion ?? "?"} — usando a API pública (/api/<procedure>).\n`
          );
          return { flavor: "public", cacheable: true };
        }
        // 200 com corpo inesperado: não dá para afirmar que não é público.
        sondaPublicaConclusiva = false;
      } else if (res.status >= 500) {
        sondaPublicaConclusiva = false; // proxy/painel com problema momentâneo
      }
      // 404/401/403 → a rota realmente não existe: painel ≤ 2.32. Conclusivo.
    } catch {
      // Falha de rede/corpo não-JSON: pode ser um painel antigo OU um soluço.
      sondaPublicaConclusiva = false;
    }
    if (!sondaPublicaConclusiva) {
      process.stderr.write(
        `[easypanel-mcp] aviso: a sonda da API pública não foi conclusiva; ` +
          `a geração detectada abaixo não será cacheada e a próxima chamada tenta de novo.\n`
      );
    }
    // `update.getStatus` é uma query sem input que existe nas gerações antigas —
    // a forma do corpo entrega qual delas o painel fala.
    try {
      const res = await fetch(`${this.baseUrl}/api/trpc/update.getStatus`, {
        headers: this.headers(),
      });
      const f = flavorFromBody(JSON.parse(await res.text()));
      if (f) return { flavor: f, cacheable: sondaPublicaConclusiva };
    } catch {
      /* corpo não-JSON (SPA/proxy) — tenta a rota nova abaixo */
    }
    try {
      const res = await fetch(`${this.baseUrl}/api/rpc/update/getStatus`, {
        headers: this.headers(),
      });
      if (res.ok && flavorFromBody(JSON.parse(await res.text())) === "rpc") {
        return { flavor: "rpc", cacheable: sondaPublicaConclusiva };
      }
    } catch {
      /* segue para o erro acionável */
    }
    throw new McpError(
      ErrorCode.InternalError,
      "Não foi possível detectar a geração da API do Easypanel (tRPC ≤ 2.30, RPC 2.31–2.32, pública ≥ 2.33). " +
        "Verifique EASYPANEL_URL/EASYPANEL_TOKEN ou force com EASYPANEL_API_FLAVOR=trpc|rpc|public."
    );
  }

  /**
   * O painel fala a API pública (≥ 2.33)? Além do transporte, isso decide o que
   * as tools podem oferecer: só ali o ciclo de vida de compose
   * (start/stop/restart) e as procedures de banco por nome achatado existem
   * documentados. Nos painéis antigos as tools orientam em vez de chutar.
   */
  async isPublicApi(): Promise<boolean> {
    return (await this.getFlavor()) === "public";
  }

  /**
   * Índice do OpenAPI da API pública (2.33+). É ele que classifica leitura vs
   * escrita de forma EXATA (método HTTP declarado), substituindo a heurística de
   * nomes que o flavor "rpc" ainda precisa. Falhas não são cacheadas e chamadas
   * concorrentes compartilham o fetch em voo.
   */
  private async getPublicIndex(): Promise<Map<string, PublicOp> | null> {
    if (this.publicIndex) return this.publicIndex;
    if (!this.publicIndexInFlight) {
      this.publicIndexInFlight = this.loadPublicIndex().finally(() => {
        this.publicIndexInFlight = null;
      });
    }
    return this.publicIndexInFlight;
  }

  private async loadPublicIndex(): Promise<Map<string, PublicOp> | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/openapi.json`, { headers: this.headers() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const index = publicIndexFromSpec(JSON.parse(await res.text()));
      if (!index) throw new Error("spec sem operações reconhecíveis");
      this.publicIndex = index;
      return index;
    } catch (err) {
      process.stderr.write(
        `[easypanel-mcp] aviso: falha ao carregar /api/openapi.json (${(err as Error).message}); ` +
          `leituras arbitrárias (easypanel_raw) ficam recusadas até o spec carregar.\n`
      );
      return null;
    }
  }

  /**
   * Mapa procedure → leitura/escrita para painéis 2.31–2.32, construído do
   * OpenAPI do próprio painel. Nessas versões TODAS as chamadas vão por POST,
   * então o método HTTP não separa mais leitura de escrita — este mapa devolve
   * essa separação.
   */
  private async getKindMap(): Promise<Map<string, ProcKind> | null> {
    if (this.kindMap) return this.kindMap;
    if (!this.kindMapInFlight) {
      this.kindMapInFlight = this.loadKindMap().finally(() => {
        this.kindMapInFlight = null;
      });
    }
    return this.kindMapInFlight;
  }

  private async loadKindMap(): Promise<Map<string, ProcKind> | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/openapi.json`, { headers: this.headers() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const map = kindMapFromSpec(JSON.parse(await res.text()));
      if (!map) throw new Error("spec sem procedures reconhecíveis");
      this.kindMap = map;
      return map;
    } catch (err) {
      process.stderr.write(
        `[easypanel-mcp] aviso: falha ao carregar /api/openapi.json (${(err as Error).message}); ` +
          `leituras arbitrárias (easypanel_raw) ficam recusadas até o spec carregar.\n`
      );
      return null;
    }
  }

  /** Chamada de leitura pela API pública (2.33+), com fallback ao RPC interno. */
  private async publicQuery<T>(
    procedure: string,
    input: unknown,
    requireDocumentedQuery: boolean
  ): Promise<T> {
    const flat = publicNameFor(procedure);
    const index = await this.getPublicIndex();
    const op = flat ? index?.get(flat) : undefined;

    if (op?.method === "post") {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `A procedure "${procedure}" é uma escrita na API do Easypanel — ` +
          `chame-a como escrita (no easypanel_raw: isMutation:true + confirm).`
      );
    }
    if (requireDocumentedQuery && op?.method !== "get") {
      throw new McpError(
        ErrorCode.InvalidRequest,
        index
          ? `A procedure "${procedure}" não consta como leitura no OpenAPI do painel — ` +
            `recusada por segurança (fail-closed). Se for uma escrita, use isMutation:true + confirm; ` +
            `se acredita que é leitura, confira o nome em GET ${this.baseUrl}/api/openapi.json.`
          : `Não foi possível carregar o OpenAPI do painel para classificar "${procedure}" — ` +
            `leitura arbitrária recusada por segurança (fail-closed). Tente novamente ou use as tools dedicadas.`
      );
    }

    // Procedure fora do spec público (ex.: o painel renomeou algo): as tools
    // curadas ainda funcionam pelo transporte interno, que segue vivo no 2.33.
    if (!flat || !op) {
      const internal = internalNameFor(procedure);
      if (!internal) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `A operação "${procedure}" não está no OpenAPI público do painel e não tem equivalente ` +
            `interno conhecido. Confira o nome em GET ${this.baseUrl}/api/openapi.json.`
        );
      }
      return this.internalRpcCall<T>(internal, input, "leitura fora do spec público");
    }

    const params = toQueryParams(input);
    // Input com valor não-string não cabe na query string deste painel (zod sem
    // coerção). A classificação já foi feita pelo spec acima, então cair no
    // transporte interno aqui é seguro: sabemos que é leitura.
    if (!params) {
      const internal = internalNameFor(flat);
      if (!internal) {
        // A operação existe e é leitura, mas não há como chamá-la: o painel
        // recusa número/array na query string e não conhecemos o nome interno
        // para rotear pelo /api/rpc. Dizer isso é melhor que alegar (falsamente)
        // que a operação não existe.
        throw new McpError(
          ErrorCode.InvalidRequest,
          `A leitura "${procedure}" recebeu um parâmetro não-string, e este painel valida query ` +
            `params sem coerção de tipo (número/array são recusados). O desvio para o transporte ` +
            `interno precisa do nome com namespace — chame-a como "namespace.${flat}" ou passe ` +
            `apenas parâmetros string.`
        );
      }
      return this.internalRpcCall<T>(internal, input, "input com valor não-string");
    }

    const qs = params.toString();
    const res = await fetch(`${this.baseUrl}/api/${flat}${qs ? `?${qs}` : ""}`, {
      headers: this.headers(),
    });
    return this.parse<T>(res, flat, false);
  }

  /**
   * Transporte RPC interno (`/api/rpc/ns/proc`). No flavor "public" é a rota de
   * escape para o que a API pública não consegue expressar; nos painéis
   * 2.31–2.32 é o transporte principal.
   */
  private async internalRpcCall<T>(internal: string, input: unknown, motivo: string): Promise<T> {
    process.stderr.write(
      `[easypanel-mcp] ${internal}: usando o transporte interno /api/rpc (motivo: ${motivo}).\n`
    );
    const res = await fetch(`${this.baseUrl}${rpcPath(internal)}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ json: input ?? {} }),
    });
    return this.parse<T>(res, internal, true);
  }

  /**
   * @param opts.requireDocumentedQuery Exigido pelo easypanel_raw (procedures
   *   arbitrárias): a chamada só prossegue se o OpenAPI do painel classificar a
   *   procedure como leitura (fail-closed). Sem isso, uma falha ao carregar o
   *   spec — ou uma procedure fora dele — permitiria executar escrita
   *   "disfarçada" de leitura, contornando readonly e CONFIRMO. Tools curadas
   *   não passam a flag: suas procedures de leitura são literais verificados, e
   *   o guard fica como defense-in-depth.
   */
  async query<T>(
    procedure: string,
    input?: unknown,
    opts: { requireDocumentedQuery?: boolean } = {}
  ): Promise<T> {
    const flavor = await this.getFlavor();
    if (flavor === "public") {
      return this.publicQuery<T>(procedure, input, Boolean(opts.requireDocumentedQuery));
    }
    // Gerações antigas só entendem o nome com namespace. A doc do 2.33 e o
    // easypanel_raw usam o achatado, então traduzimos quando conhecido — sem
    // isso, `listCertificates` num painel 2.32 viraria /api/rpc/listCertificates (404).
    const legacy = internalNameFor(procedure) ?? procedure;

    if (flavor === "rpc") {
      // 2.31–2.32: queries com input só funcionam via POST {"json": ...} (o GET
      // documentado responde 400). Como POST executa qualquer procedure, o guard
      // abaixo impede que uma mutation passe por aqui "disfarçada" de leitura.
      const map = await this.getKindMap();
      const kind = map?.get(legacy.toLowerCase());
      if (kind === "mutation") {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `A procedure "${procedure}" é uma mutation (escrita) na API do Easypanel — ` +
            `chame-a como escrita (no easypanel_raw: isMutation:true + confirm).`
        );
      }
      if (opts.requireDocumentedQuery && kind !== "query") {
        throw new McpError(
          ErrorCode.InvalidRequest,
          map
            ? `A procedure "${procedure}" não consta como leitura no OpenAPI do painel — ` +
              `recusada por segurança (fail-closed). Se for uma escrita, use isMutation:true + confirm; ` +
              `se acredita que é leitura, confira o nome em GET ${this.baseUrl}/api/openapi.json.`
            : `Não foi possível carregar o OpenAPI do painel para classificar "${procedure}" — ` +
              `leitura arbitrária recusada por segurança (fail-closed). Tente novamente ou use as tools dedicadas.`
        );
      }
      const res = await fetch(`${this.baseUrl}${rpcPath(legacy)}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ json: input ?? {} }),
      });
      return this.parse<T>(res, legacy, true);
    }
    // ≤ 2.30 (tRPC): GET com ?input={"json":...}
    let url = `${this.baseUrl}/api/trpc/${legacy}`;
    if (input !== undefined) {
      url += `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    }
    const res = await fetch(url, { headers: this.headers() });
    return this.parse<T>(res, legacy, true);
  }

  async mutate<T>(procedure: string, input?: unknown): Promise<T> {
    // Kill-switch global de escrita. Com MCP_ACCESS_MODE=readonly toda mutation é
    // bloqueada na origem — cobre as tools curadas E o easypanel_raw, sem depender
    // de cada handler lembrar de checar. Reads (query) continuam liberados.
    if (isReadOnly()) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Modo somente-leitura ativo (MCP_ACCESS_MODE=readonly): a operação de escrita "${procedure}" foi bloqueada.`
      );
    }
    const flavor = await this.getFlavor();

    if (flavor === "public") {
      const flat = publicNameFor(procedure);
      const index = await this.getPublicIndex();
      const op = flat ? index?.get(flat) : undefined;
      if (op?.method === "get") {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `A procedure "${procedure}" é uma leitura na API do Easypanel — ` +
            `chame-a como leitura (no easypanel_raw: sem isMutation).`
        );
      }
      if (!flat || !op) {
        const internal = internalNameFor(procedure);
        if (!internal) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `A operação "${procedure}" não está no OpenAPI público do painel e não tem equivalente ` +
              `interno conhecido. Confira o nome em GET ${this.baseUrl}/api/openapi.json.`
          );
        }
        return this.internalRpcCall<T>(internal, input, "escrita fora do spec público");
      }
      const res = await fetch(`${this.baseUrl}/api/${flat}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(input ?? {}),
      });
      return this.parse<T>(res, flat, false);
    }

    // Gerações antigas só entendem o nome com namespace (ver `query`).
    const legacy = internalNameFor(procedure) ?? procedure;
    const url =
      flavor === "rpc"
        ? `${this.baseUrl}${rpcPath(legacy)}`
        : `${this.baseUrl}/api/trpc/${legacy}`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ json: input ?? {} }),
    });
    return this.parse<T>(res, legacy, true);
  }

  /**
   * Helper genérico para os endpoints WebSocket do Easypanel (`/ws/*`).
   * Abre a conexão (token sempre em query string), coleta as mensagens cruas
   * (texto) até o stream ficar ocioso (`idleMs`), atingir `maxMessages` ou o teto
   * de tempo (`timeoutMs`), então fecha e resolve com a lista de mensagens.
   *
   * Como uma tool MCP é request/response, esse padrão "coleta-e-fecha" transforma
   * um stream contínuo em um snapshot determinístico.
   */
  private collectWs(
    path: string,
    params: Record<string, string>,
    opts: {
      timeoutMs?: number;
      idleMs?: number;
      maxMessages?: number;
      failIfEmpty?: boolean;
    } = {}
  ): Promise<string[]> {
    const {
      timeoutMs = 6000,
      idleMs = 800,
      maxMessages = Number.POSITIVE_INFINITY,
      failIfEmpty = false,
    } = opts;

    const wsBase = this.baseUrl.replace(/^http/, "ws");
    const url = new URL(`${wsBase}${path}`);
    url.searchParams.set("token", this.token);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    return new Promise<string[]>((resolve, reject) => {
      // A URL do WebSocket contém o token na query string (exigência do Easypanel:
      // o endpoint não aceita header Authorization). Por isso NUNCA propagamos o
      // erro cru (que pode conter a URL) ao chamador/LLM — logamos só o `path` em
      // stderr e rejeitamos com uma mensagem genérica, espelhando o cuidado de parse().
      const rejectSafe = (err: Error) => {
        process.stderr.write(`[easypanel-mcp] WebSocket ${path} falhou: ${err.message}\n`);
        reject(new McpError(ErrorCode.InternalError, `Falha na conexão WebSocket em ${path}`));
      };

      let ws: WebSocket;
      try {
        ws = new WebSocket(url.toString(), { handshakeTimeout: Math.min(timeoutMs, 5000) });
      } catch (err) {
        rejectSafe(err as Error);
        return;
      }

      const messages: string[] = [];
      let done = false;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;

      const settle = () => {
        if (done) return;
        done = true;
        clearTimeout(hardTimer);
        if (idleTimer) clearTimeout(idleTimer);
        try {
          ws.close();
        } catch {
          /* já fechado */
        }
        if (messages.length === 0 && failIfEmpty) {
          rejectSafe(new Error("stream abriu mas não enviou dados dentro do tempo limite"));
        } else {
          resolve(messages);
        }
      };

      const fail = (err: Error) => {
        if (done) return;
        if (messages.length) {
          // Há dados parciais úteis — entrega o que chegou em vez de falhar.
          settle();
          return;
        }
        done = true;
        clearTimeout(hardTimer);
        if (idleTimer) clearTimeout(idleTimer);
        rejectSafe(err);
      };

      const hardTimer = setTimeout(settle, timeoutMs);
      const bumpIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(settle, idleMs);
      };

      ws.on("message", (data: WebSocket.RawData) => {
        messages.push(data.toString("utf8"));
        if (messages.length >= maxMessages) {
          settle();
          return;
        }
        bumpIdle();
      });
      ws.on("error", (err: Error) => fail(err));
      ws.on("close", () => {
        if (messages.length) settle();
        else fail(new Error("WebSocket fechou sem dados"));
      });
    });
  }

  /** Concatena mensagens `{ "output": "..." }` (serviceLogs / containerShell) em texto. */
  private joinOutput(messages: string[]): string {
    let buf = "";
    for (const m of messages) {
      try {
        const parsed = JSON.parse(m);
        buf += typeof parsed?.output === "string" ? parsed.output : m;
      } catch {
        buf += m;
      }
    }
    return buf;
  }

  /** Retorna as últimas `maxLines` linhas de um texto, normalizando CRLF. */
  private tailLines(text: string, maxLines: number): string {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines.slice(-maxLines).join("\n");
  }

  /**
   * Lê os logs de runtime do container via WebSocket `/ws/serviceLogs` — o mesmo
   * canal usado pelo painel de Logs da UI do Easypanel. Não depende do
   * "Advanced Logs" (Loki), que requer licença. A 1ª mensagem já traz o histórico.
   *
   * @param service Nome do serviço Docker no formato `${projectName}_${serviceName}`.
   */
  async streamServiceLogs(
    service: string,
    opts: {
      compose?: boolean;
      composeInternalService?: string;
      maxLines?: number;
      timeoutMs?: number;
      idleMs?: number;
    } = {}
  ): Promise<string> {
    const { compose = false, composeInternalService, maxLines = 100, ...rest } = opts;
    const params: Record<string, string> = {
      service,
      compose: compose ? "true" : "false",
    };
    if (composeInternalService) params.composeInternalService = composeInternalService;
    // failIfEmpty: se o stream abrir mas não trouxer nada (serviço parado/sem
    // permissão), rejeita para o get_service_logs cair no fallback de getServiceError.
    const messages = await this.collectWs("/ws/serviceLogs", params, { ...rest, failIfEmpty: true });
    return this.tailLines(this.joinOutput(messages), maxLines);
  }

  /**
   * Executa um comando dentro do container via WebSocket `/ws/containerShell`.
   * O comando vai base64-encodado na query (como faz a UI) e a saída volta em
   * mensagens `{ "output": "..." }`. Coleta até o comando ficar ocioso e retorna o texto.
   *
   * @param containerId ID do container (de `projects.getDockerContainers`).
   */
  async execInContainer(
    containerId: string,
    command: string,
    opts: { maxLines?: number; timeoutMs?: number; idleMs?: number } = {}
  ): Promise<string> {
    const { maxLines = 500, timeoutMs = 15000, idleMs = 1200 } = opts;
    const b64 = Buffer.from(command, "utf8").toString("base64");
    const messages = await this.collectWs(
      "/ws/containerShell",
      { container: containerId, command: b64 },
      { timeoutMs, idleMs }
    );
    return this.tailLines(this.joinOutput(messages), maxLines);
  }

  /**
   * Coleta os eventos Docker recentes via WebSocket `/ws/dockerEvents`.
   * Cada mensagem é um objeto de evento Docker em JSON. Retorna até `maxEvents`.
   */
  async streamDockerEvents(
    opts: { maxEvents?: number; timeoutMs?: number; idleMs?: number } = {}
  ): Promise<unknown[]> {
    // Eventos Docker são apenas em tempo real (sem histórico). Janela mais larga
    // aumenta a chance de capturar atividade (healthchecks, starts, etc).
    const { maxEvents = 50, timeoutMs = 8000, idleMs = 2500 } = opts;
    const messages = await this.collectWs("/ws/dockerEvents", {}, {
      timeoutMs,
      idleMs,
      maxMessages: maxEvents,
    });
    return messages.map((m) => {
      try {
        return JSON.parse(m);
      } catch {
        return m;
      }
    });
  }

  /**
   * @param wrapped `true` para as gerações com envelope (`{result:{data:{json}}}`
   *   no tRPC, `{json}` no RPC). A API pública devolve o dado CRU — desembrulhar
   *   ali corromperia qualquer resposta que por acaso tenha um campo `json` ou
   *   `result`, e trataria um campo `error` de negócio como falha.
   */
  private async parse<T>(res: Response, procedure: string, wrapped: boolean): Promise<T> {
    const text = await res.text();

    // Procedures que não retornam nada respondem 200 com corpo vazio (confirmado
    // em `listNodes` no 2.33.1). JSON.parse("") lançaria — devolvemos null.
    if (res.ok && text.trim() === "") return null as T;

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      // Log full body to stderr for debugging — never surface raw body to LLM context
      process.stderr.write(`[easypanel-mcp] ${res.status} non-JSON from [${procedure}]: ${text}\n`);
      throw new McpError(
        ErrorCode.InternalError,
        res.ok
          ? `Resposta inválida de [${procedure}]`
          : `Easypanel API error ${res.status} on [${procedure}]`
      );
    }
    if (!res.ok) {
      process.stderr.write(`[easypanel-mcp] ${res.status} [${procedure}]: ${text}\n`);
      // Só a mensagem estruturada (campo controlado pelo servidor, ex. "Service
      // not found." ou os zodErrors por campo) vai ao contexto do LLM, truncada —
      // nunca o corpo cru.
      const msg = errorMessageFromBody(data);
      throw new McpError(
        ErrorCode.InternalError,
        `Easypanel API error ${res.status} on [${procedure}]` + (msg ? `: ${msg}` : "")
      );
    }
    // Erro-em-200 do tRPC legado. Só vale para as gerações com envelope, e só
    // quando não há `result` — evita falso positivo quando o dado de negócio
    // tem um campo "error".
    if (wrapped && data?.error && !data?.result) {
      const msg = errorMessageFromBody(data) ?? "Erro desconhecido";
      throw new McpError(ErrorCode.InternalError, `Easypanel [${procedure}]: ${msg}`);
    }
    return (wrapped ? unwrapBody(data) : data) as T;
  }
}

let _client: EasyPanelClient | null = null;

export function getClient(): EasyPanelClient {
  if (!_client) _client = new EasyPanelClient();
  return _client;
}
