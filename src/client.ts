import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import WebSocket from "ws";

export class EasyPanelClient {
  private baseUrl: string;
  private token: string;

  constructor() {
    const url = process.env.EASYPANEL_URL;
    const token = process.env.EASYPANEL_TOKEN;
    if (!url) throw new Error("EASYPANEL_URL não definida. Configure seu .env");
    if (!token) throw new Error("EASYPANEL_TOKEN não definida. Configure seu .env");
    this.baseUrl = url.replace(/\/$/, "");
    this.token = token;
  }

  async query<T>(procedure: string, input?: unknown): Promise<T> {
    let url = `${this.baseUrl}/api/trpc/${procedure}`;
    if (input !== undefined) {
      url += `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    }
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
    });
    return this.parse<T>(res, procedure);
  }

  async mutate<T>(procedure: string, input?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/trpc/${procedure}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
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
    if (!res.ok) {
      // Log full body to stderr for debugging — never surface raw body to LLM context
      process.stderr.write(`[easypanel-mcp] ${res.status} [${procedure}]: ${text}\n`);
      throw new McpError(
        ErrorCode.InternalError,
        `Easypanel API error ${res.status} on [${procedure}]`
      );
    }
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      process.stderr.write(`[easypanel-mcp] Invalid JSON from [${procedure}]: ${text}\n`);
      throw new McpError(ErrorCode.InternalError, `Resposta inválida de [${procedure}]`);
    }
    // Only treat as error when there is no result — avoids false positives when
    // business data contains an "error" field with a null/informational value.
    if (data?.error && !data?.result) {
      const msg =
        data.error?.json?.message ??
        data.error?.message ??
        "Erro desconhecido";
      throw new McpError(ErrorCode.InternalError, `Easypanel [${procedure}]: ${msg}`);
    }
    return (data?.result?.data?.json ??
      data?.result?.data ??
      data?.result ??
      data) as T;
  }
}

let _client: EasyPanelClient | null = null;

export function getClient(): EasyPanelClient {
  if (!_client) _client = new EasyPanelClient();
  return _client;
}
