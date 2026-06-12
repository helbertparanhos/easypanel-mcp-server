import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import WebSocket from "ws";
import { isReadOnly } from "./context.js";

/**
 * Geração da API do painel:
 *  - "trpc" — Easypanel ≤ 2.30: tRPC clássico. Queries via GET `?input={"json":...}`,
 *    mutations via POST; resposta embrulhada em `{ result: { data: { json } } }`.
 *  - "rpc"  — Easypanel ≥ 2.31: camada RPC nova (estilo oRPC) em `/api/rpc/*`, com
 *    OpenAPI em `/api/openapi.json`. O GET documentado com query params não aceita
 *    input na prática (400) — o caminho confiável é POST `{"json": input}` para
 *    QUALQUER procedure (leitura e escrita); resposta vem como `{ "json": dado }`.
 */
export type ApiFlavor = "trpc" | "rpc";

/** Override manual da geração da API via env (pula a auto-detecção). */
export function flavorFromEnv(): ApiFlavor | null {
  const v = (process.env.EASYPANEL_API_FLAVOR || "").toLowerCase();
  if (v === "trpc" || v === "legacy") return "trpc";
  if (v === "rpc" || v === "modern") return "rpc";
  return null;
}

/**
 * Identifica a geração da API pela forma do corpo de resposta. Cada geração
 * responde com a própria forma até em erros de auth, então a detecção funciona
 * mesmo com token inválido (e o erro real aparece na primeira chamada de verdade).
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

/** Desembrulha o payload nas duas formas de resposta (tRPC legado e RPC 2.31+). */
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
  private flavorInFlight: Promise<ApiFlavor> | null = null;
  private methodMap: Map<string, "GET" | "POST"> | null = null;
  private methodMapInFlight: Promise<Map<string, "GET" | "POST"> | null> | null = null;

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

  /** Geração da API em uso: override por env > cache > auto-detecção (1 request). */
  private async getFlavor(): Promise<ApiFlavor> {
    const forced = flavorFromEnv();
    if (forced) return forced;
    if (this.flavorCache) return this.flavorCache;
    if (!this.flavorInFlight) {
      this.flavorInFlight = this.detectFlavor()
        .then((f) => {
          this.flavorCache = f;
          return f;
        })
        .finally(() => {
          this.flavorInFlight = null;
        });
    }
    return this.flavorInFlight;
  }

  private async detectFlavor(): Promise<ApiFlavor> {
    // `update.getStatus` é uma query sem input que existe nas duas gerações —
    // a forma do corpo de resposta entrega qual delas o painel fala.
    try {
      const res = await fetch(`${this.baseUrl}/api/trpc/update.getStatus`, {
        headers: this.headers(),
      });
      const f = flavorFromBody(JSON.parse(await res.text()));
      if (f) return f;
    } catch {
      /* corpo não-JSON (SPA/proxy) — tenta a rota nova abaixo */
    }
    try {
      const res = await fetch(`${this.baseUrl}/api/rpc/update/getStatus`, {
        headers: this.headers(),
      });
      if (res.ok && flavorFromBody(JSON.parse(await res.text())) === "rpc") return "rpc";
    } catch {
      /* segue para o erro acionável */
    }
    throw new McpError(
      ErrorCode.InternalError,
      "Não foi possível detectar a geração da API do Easypanel (tRPC ≤ 2.30 vs RPC ≥ 2.31). " +
        "Verifique EASYPANEL_URL/EASYPANEL_TOKEN ou force com EASYPANEL_API_FLAVOR=trpc|rpc."
    );
  }

  /**
   * Mapa procedure (minúscula) → método HTTP documentado, construído do OpenAPI
   * do próprio painel (`/api/openapi.json`, disponível a partir do 2.31). No modo
   * "rpc" TODAS as chamadas vão por POST, então o método HTTP deixou de separar
   * leitura de escrita — este mapa devolve essa separação: `query()` recusa
   * procedures documentadas como mutation, preservando o contrato do readonly
   * e o gate de confirmação do trpc_raw. Falhas NÃO são cacheadas (a próxima
   * chamada tenta de novo) e chamadas concorrentes compartilham o fetch em voo.
   */
  private async getMethodMap(): Promise<Map<string, "GET" | "POST"> | null> {
    if (this.methodMap) return this.methodMap;
    if (!this.methodMapInFlight) {
      this.methodMapInFlight = this.loadMethodMap().finally(() => {
        this.methodMapInFlight = null;
      });
    }
    return this.methodMapInFlight;
  }

  private async loadMethodMap(): Promise<Map<string, "GET" | "POST"> | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/openapi.json`, { headers: this.headers() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const spec = JSON.parse(await res.text());
      const map = new Map<string, "GET" | "POST">();
      for (const [p, ops] of Object.entries<Record<string, unknown>>(spec?.paths ?? {})) {
        if (!p.startsWith("/api/rpc/")) continue;
        // Chave em minúsculas: o lookup também normaliza, para o guard não ser
        // contornável por variação de caixa (a regex do trpc_raw aceita A-Z).
        const proc = p.slice("/api/rpc/".length).split("/").join(".").toLowerCase();
        // GET documentado = query; só-POST = mutation.
        map.set(proc, "get" in ops ? "GET" : "POST");
      }
      if (map.size === 0) throw new Error("spec sem paths /api/rpc/*");
      this.methodMap = map;
      return map;
    } catch (err) {
      process.stderr.write(
        `[easypanel-mcp] aviso: falha ao carregar /api/openapi.json (${(err as Error).message}); ` +
          `leituras arbitrárias (trpc_raw) ficam recusadas até o spec carregar.\n`
      );
      return null;
    }
  }

  /**
   * @param opts.requireDocumentedQuery Exigido pelo trpc_raw (procedures
   *   arbitrárias): no modo rpc a chamada só prossegue se o OpenAPI do painel
   *   classificar a procedure como query (fail-closed). Sem isso, uma falha ao
   *   carregar o spec — ou uma procedure fora dele — permitiria executar
   *   mutation "disfarçada" de leitura, contornando readonly e CONFIRMO.
   *   Tools curadas não passam a flag: suas procedures de leitura são literais
   *   verificados, e o guard fica como defense-in-depth.
   */
  async query<T>(
    procedure: string,
    input?: unknown,
    opts: { requireDocumentedQuery?: boolean } = {}
  ): Promise<T> {
    const flavor = await this.getFlavor();
    if (flavor === "rpc") {
      // 2.31+: queries com input só funcionam via POST {"json": ...} (o GET
      // documentado responde 400). Como POST executa qualquer procedure, o guard
      // abaixo impede que uma mutation passe por aqui "disfarçada" de leitura
      // (ex.: trpc_raw com isMutation=false) — readonly e CONFIRMO continuam valendo.
      const map = await this.getMethodMap();
      const documented = map?.get(procedure.toLowerCase());
      if (documented === "POST") {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `A procedure "${procedure}" é uma mutation (escrita) na API do Easypanel — ` +
            `chame-a como escrita (no trpc_raw: isMutation:true + confirm).`
        );
      }
      if (opts.requireDocumentedQuery && documented !== "GET") {
        throw new McpError(
          ErrorCode.InvalidRequest,
          map
            ? `A procedure "${procedure}" não está documentada como leitura no OpenAPI do painel — ` +
              `recusada por segurança (fail-closed). Se for uma escrita, use isMutation:true + confirm; ` +
              `se acredita que é leitura, confira o nome em GET ${this.baseUrl}/api/openapi.json.`
            : `Não foi possível carregar o OpenAPI do painel para classificar "${procedure}" — ` +
              `leitura arbitrária recusada por segurança (fail-closed). Tente novamente ou use as tools dedicadas.`
        );
      }
      const res = await fetch(`${this.baseUrl}${rpcPath(procedure)}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ json: input ?? {} }),
      });
      return this.parse<T>(res, procedure);
    }
    // ≤ 2.30 (tRPC): GET com ?input={"json":...}
    let url = `${this.baseUrl}/api/trpc/${procedure}`;
    if (input !== undefined) {
      url += `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    }
    const res = await fetch(url, { headers: this.headers() });
    return this.parse<T>(res, procedure);
  }

  async mutate<T>(procedure: string, input?: unknown): Promise<T> {
    // Kill-switch global de escrita. Com MCP_ACCESS_MODE=readonly toda mutation é
    // bloqueada na origem — cobre as tools curadas E o trpc_raw, sem depender de
    // cada handler lembrar de checar. Reads (query) continuam liberados.
    if (isReadOnly()) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Modo somente-leitura ativo (MCP_ACCESS_MODE=readonly): a operação de escrita "${procedure}" foi bloqueada.`
      );
    }
    const flavor = await this.getFlavor();
    const url =
      flavor === "rpc"
        ? `${this.baseUrl}${rpcPath(procedure)}`
        : `${this.baseUrl}/api/trpc/${procedure}`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ json: input ?? {} }),
    });
    return this.parse<T>(res, procedure);
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

  private async parse<T>(res: Response, procedure: string): Promise<T> {
    const text = await res.text();
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
      // Só a mensagem estruturada das duas gerações vai ao contexto do LLM
      // (campo controlado pelo servidor, ex. "Service not found."), truncada —
      // nunca o corpo cru.
      const msg = safeServerMessage(
        data?.json?.message ?? data?.error?.json?.message ?? data?.error?.message
      );
      throw new McpError(
        ErrorCode.InternalError,
        `Easypanel API error ${res.status} on [${procedure}]` + (msg ? `: ${msg}` : "")
      );
    }
    // Erro-em-200 do tRPC legado. Only treat as error when there is no result —
    // avoids false positives when business data contains an "error" field.
    if (data?.error && !data?.result) {
      const msg =
        safeServerMessage(data.error?.json?.message ?? data.error?.message) ??
        "Erro desconhecido";
      throw new McpError(ErrorCode.InternalError, `Easypanel [${procedure}]: ${msg}`);
    }
    return unwrapBody(data) as T;
  }
}

let _client: EasyPanelClient | null = null;

export function getClient(): EasyPanelClient {
  if (!_client) _client = new EasyPanelClient();
  return _client;
}
