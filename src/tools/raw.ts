import { Tool, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import { guardDestructive, CONFIRM_KEYWORD } from "../context.js";

/**
 * Escape hatch genérico: chama qualquer procedure tRPC do Easypanel que não tenha
 * uma tool curada dedicada. O Easypanel expõe ~347 procedures em 43 namespaces;
 * cobrir todas com tools tipadas seria inviável, então este atalho dá acesso ao
 * restante (ex.: traefik.*, branding.*, cloudflareTunnel.*, box.*, backups.*).
 *
 * Diferenças de segurança vs. o trpc_raw "cru" de outros MCPs:
 *  - O nome da procedure é validado (namespace.procedure) antes de ir para a URL.
 *  - Mutations exigem isMutation=true E confirm:"CONFIRMO" — como elas pulam os
 *    guards específicos das tools curadas, a confirmação explícita é a rede de
 *    segurança mínima. Reads (isMutation=false) seguem livres.
 *  - Em MCP_ACCESS_MODE=readonly, qualquer mutation é bloqueada no client.
 */

// namespace(.sub)*.procedure — pelo menos um ponto; só letras/números nos segmentos.
const PROCEDURE_RE = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/;

/** Valida o nome de uma procedure tRPC (`namespace.procedure`). Exportada p/ teste. */
export function isValidProcedureName(procedure: unknown): boolean {
  return typeof procedure === "string" && PROCEDURE_RE.test(procedure);
}

// Habilita o escape hatch. Em ambientes onde o MCP é exposto a conteúdo não
// confiável (risco de prompt injection), defina EASYPANEL_RAW_DISABLED=1 para
// desligar o trpc_raw por completo — readonly NÃO protege contra leituras, e o
// trpc_raw pode ler qualquer procedure (ex.: inspectService de outro projeto
// devolve env vars com secrets). Lido a cada chamada para refletir runtime/testes.
function isRawDisabled(): boolean {
  const v = (process.env.EASYPANEL_RAW_DISABLED || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export const rawTools: Tool[] = [
  {
    name: "trpc_raw",
    description: `Chama diretamente qualquer procedure tRPC do Easypanel (~347 em 43 namespaces) não coberta pelas tools dedicadas. Use para recursos avançados: traefik.*, branding.*, cloudflareTunnel.*, box.*, mariadb.*, volumeBackups.*, databaseBackups.*, etc. Leitura (isMutation=false) é o padrão. ⚠️ Reads podem retornar dados sensíveis (env vars/secrets de qualquer projeto). Para escrita, passe isMutation:true E confirm:"${CONFIRM_KEYWORD}" — mutations arbitrárias pulam as proteções das tools curadas.`,
    inputSchema: {
      type: "object",
      properties: {
        procedure: {
          type: "string",
          description:
            'Nome completo da procedure no formato "namespace.procedure", ex: "certificates.listCertificates", "traefik.getDashboard", "users.listUsers".',
        },
        input: {
          type: "object",
          description: "Objeto de parâmetros da procedure (opcional). Ex: { projectName: \"meu-app\" }.",
          additionalProperties: true,
        },
        isMutation: {
          type: "boolean",
          description:
            "true para operações de escrita (POST), false para leitura (GET, padrão). Mutations exigem confirm.",
          default: false,
        },
        confirm: {
          type: "string",
          description: `Obrigatório quando isMutation=true. Deve ser exatamente "${CONFIRM_KEYWORD}".`,
        },
      },
      required: ["procedure"],
    },
  },
];

type Args = Record<string, unknown>;

export async function handleRawTool(name: string, args: Args) {
  if (name !== "trpc_raw") throw new Error(`Tool desconhecida: ${name}`);

  if (isRawDisabled()) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "trpc_raw está desabilitado (EASYPANEL_RAW_DISABLED). Use as tools dedicadas."
    );
  }

  const { procedure, input, isMutation = false, confirm } = args as {
    procedure: string;
    input?: Record<string, unknown>;
    isMutation?: boolean;
    confirm?: string;
  };

  if (!isValidProcedureName(procedure)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'procedure inválida. Use o formato "namespace.procedure" (apenas letras, números e pontos), ex: "users.listUsers".'
    );
  }

  // O SDK do MCP não valida inputSchema em runtime — endurecemos o input aqui,
  // como já fazemos com `procedure`. Evita payloads malformados (string/array)
  // virarem erros opacos da API.
  if (
    input !== undefined &&
    (typeof input !== "object" || input === null || Array.isArray(input))
  ) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'input deve ser um objeto de parâmetros, ex: { projectName: "meu-app" }.'
    );
  }

  // Em reads o input é serializado para a query string da URL. Limitamos o tamanho
  // para evitar estourar limites de URL do servidor (e DoS leve com payloads enormes).
  if (input !== undefined) {
    let serializedLen: number;
    try {
      serializedLen = JSON.stringify(input).length;
    } catch {
      throw new McpError(ErrorCode.InvalidParams, "input não é serializável (referência circular?).");
    }
    if (serializedLen > 50_000) {
      throw new McpError(ErrorCode.InvalidParams, "input muito grande (limite ~50KB).");
    }
  }

  const client = getClient();

  if (isMutation) {
    const blocked = guardDestructive(
      confirm,
      "trpc_raw (mutation)",
      `mutation arbitrária na API: ${procedure}`
    );
    if (blocked) return { content: [{ type: "text" as const, text: blocked }] };
    const result = await client.mutate(procedure, input ?? {});
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }

  const result = await client.query(procedure, input);
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}
