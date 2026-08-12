import { Tool, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import { guardDestructive, CONFIRM_KEYWORD } from "../context.js";

/**
 * Escape hatch genérico: chama qualquer procedure da API do Easypanel que não tenha
 * uma tool curada dedicada. O Easypanel expõe ~375 operações; cobrir todas com
 * tools tipadas seria inviável, então este atalho dá acesso ao restante (ex.:
 * traefik.*, branding.*, cloudflareTunnel.*, box.*, wordpress.*, backups.*).
 *
 * Aceita as DUAS formas de nome, e o client traduz para o transporte certo:
 *  - achatada, como na API pública 2.33+ ("listCertificates", "getDashboard");
 *  - em notação de pontos, como nas gerações antigas ("certificates.listCertificates").
 *
 * Diferenças de segurança vs. o raw "cru" de outros MCPs:
 *  - O nome da procedure é validado antes de ir para a URL.
 *  - Mutations exigem isMutation=true E confirm:"CONFIRMO" — como elas pulam os
 *    guards específicos das tools curadas, a confirmação explícita é a rede de
 *    segurança mínima. Reads (isMutation=false) seguem livres.
 *  - A natureza (leitura vs escrita) é conferida contra o OpenAPI do painel, e
 *    em 2.33+ essa checagem é exata (método HTTP declarado no spec).
 *  - Em MCP_ACCESS_MODE=readonly, qualquer mutation é bloqueada no client.
 */

// "listCertificates" ou "certificates.listCertificates" — segmentos alfanuméricos
// separados por ponto, com ou sem namespace.
const PROCEDURE_RE = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)*$/;

/**
 * Valida o nome de uma procedure, nas duas formas (achatada da API pública 2.33+
 * ou `namespace.procedure` das gerações antigas). Exportada p/ teste.
 */
export function isValidProcedureName(procedure: unknown): boolean {
  return typeof procedure === "string" && PROCEDURE_RE.test(procedure);
}

// Habilita o escape hatch. Em ambientes onde o MCP é exposto a conteúdo não
// confiável (risco de prompt injection), defina EASYPANEL_RAW_DISABLED=1 para
// desligar o easypanel_raw por completo — readonly NÃO protege contra leituras, e o
// easypanel_raw pode ler qualquer procedure (ex.: inspectService de outro projeto
// devolve env vars com secrets). Lido a cada chamada para refletir runtime/testes.
function isRawDisabled(): boolean {
  const v = (process.env.EASYPANEL_RAW_DISABLED || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export const rawTools: Tool[] = [
  {
    name: "easypanel_raw",
    description: `Chama diretamente qualquer operação da API do Easypanel (~375) não coberta pelas tools dedicadas. Use para recursos avançados: Traefik, branding, Cloudflare Tunnel, Box, WordPress, backups de volume/banco, notificações, storage providers, etc. Leitura (isMutation=false) é o padrão. ⚠️ Reads podem retornar dados sensíveis (env vars/secrets de qualquer projeto). Para escrita, passe isMutation:true E confirm:"${CONFIRM_KEYWORD}" — escritas arbitrárias pulam as proteções das tools curadas. Para descobrir os nomes disponíveis, leia GET <painel>/api/openapi.json.`,
    inputSchema: {
      type: "object",
      properties: {
        procedure: {
          type: "string",
          description:
            'Nome da operação. Em painéis 2.33+ use o nome achatado da API pública, ex: "listCertificates", "getDashboard", "listVolumeBackups". A notação antiga com namespace ("certificates.listCertificates") também é aceita e traduzida.',
        },
        input: {
          type: "object",
          description: "Objeto de parâmetros da procedure (opcional). Ex: { projectName: \"meu-app\" }.",
          additionalProperties: true,
        },
        isMutation: {
          type: "boolean",
          description:
            "true para operações de escrita, false para leitura (padrão). Escritas exigem confirm. O client valida contra o OpenAPI do painel e recusa escrita chamada como leitura (e vice-versa).",
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
  // `trpc_raw` era o nome até a v2 e some da lista de tools na v3 — seguimos
  // aceitando a chamada para não quebrar skills/prompts salvos que usam o antigo.
  if (name !== "easypanel_raw" && name !== "trpc_raw") {
    throw new Error(`Tool desconhecida: ${name}`);
  }

  if (isRawDisabled()) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "easypanel_raw está desabilitado (EASYPANEL_RAW_DISABLED). Use as tools dedicadas."
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
      'procedure inválida. Use o nome da operação (apenas letras, números e pontos), ex: "listUsers" ' +
        'na API pública 2.33+ ou "users.listUsers" na notação antiga.'
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

  // Em painéis ≤ 2.30 o input de reads vai serializado na query string da URL —
  // limitamos o tamanho para não estourar limites de URL (e DoS leve com payloads
  // enormes). Em 2.31+ vai no body, mas o teto continua valendo como sanidade.
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
      "easypanel_raw (escrita)",
      `escrita arbitrária na API: ${procedure}`
    );
    if (blocked) return { content: [{ type: "text" as const, text: blocked }] };
    const result = await client.mutate(procedure, input ?? {});
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }

  // requireDocumentedQuery: em painéis 2.31+ (onde tudo é POST), a leitura
  // arbitrária só prossegue se o OpenAPI do painel classificar a procedure como
  // query — fail-closed contra mutation disfarçada de leitura.
  const result = await client.query(procedure, input, { requireDocumentedQuery: true });
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}
