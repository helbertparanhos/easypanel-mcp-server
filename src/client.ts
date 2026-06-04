import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

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

  async fetchRaw(path: string): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
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
