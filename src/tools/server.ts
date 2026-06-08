import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import { guardDestructive, CONFIRM_KEYWORD } from "../context.js";

export const serverTools: Tool[] = [
  // ---------- Leitura de infraestrutura ----------
  {
    name: "list_users",
    description: "Lista os usuários do painel Easypanel (admin, e-mails, papéis).",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_certificates",
    description:
      "Lista os certificados SSL/TLS gerenciados pelo Easypanel (domínios cobertos, emissor, validade). Use para auditar HTTPS e renovações.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_nodes",
    description:
      "Lista os nós do cluster Docker Swarm gerenciado pelo Easypanel (manager/worker, status, disponibilidade). Em servidor único retorna apenas o nó local.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  // ---------- Operações de servidor (destrutivas) ----------
  {
    name: "restart_panel",
    description: `⚠️ Reinicia o próprio Easypanel. O painel/API ficam brevemente indisponíveis; os serviços hospedados continuam rodando. Requer confirm: "${CONFIRM_KEYWORD}".`,
    inputSchema: {
      type: "object",
      properties: {
        confirm: {
          type: "string",
          description: `Obrigatório. Deve ser exatamente "${CONFIRM_KEYWORD}".`,
        },
      },
      required: [],
    },
  },
  {
    name: "reboot_server",
    description: `⚠️ CRÍTICO — Reinicia o SERVIDOR inteiro (máquina host). TODOS os serviços e o painel ficam fora do ar até o boot completar. Use apenas em manutenção planejada. Requer confirm: "${CONFIRM_KEYWORD}".`,
    inputSchema: {
      type: "object",
      properties: {
        confirm: {
          type: "string",
          description: `Obrigatório. Deve ser exatamente "${CONFIRM_KEYWORD}".`,
        },
      },
      required: [],
    },
  },
];

type Args = Record<string, unknown>;

export async function handleServerTool(name: string, args: Args) {
  const client = getClient();

  if (name === "list_users") {
    // ⚠️ users.listUsers devolve campos altamente sensíveis (apiToken em texto puro,
    // twoFactorSecret/TOTP, hash de senha). NUNCA repassamos isso ao contexto do LLM —
    // expõe credenciais que permitem reconstruir acesso admin. Whitelist de campos seguros.
    const raw = await client.query<{ users?: any[] } | any[]>("users.listUsers");
    const list = Array.isArray(raw) ? raw : raw?.users ?? [];
    const safe = (Array.isArray(list) ? list : []).map((u: any) => ({
      id: u?.id,
      email: u?.email,
      admin: u?.admin,
      twoFactorEnabled: u?.twoFactorEnabled,
      createdAt: u?.createdAt,
    }));
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { total: safe.length, usuarios: safe, nota: "Campos sensíveis (apiToken, twoFactorSecret, senha) omitidos por segurança." },
            null,
            2
          ),
        },
      ],
    };
  }

  if (name === "list_certificates") {
    const result = await client.query("certificates.listCertificates");
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }

  if (name === "list_nodes") {
    const result = await client.query("cluster.listNodes");
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }

  if (name === "restart_panel") {
    const { confirm } = args as { confirm?: string };
    const blocked = guardDestructive(confirm, "restart_panel", "reinício do painel Easypanel (API fica brevemente indisponível)");
    if (blocked) return { content: [{ type: "text" as const, text: blocked }] };
    const result = await client.mutate("settings.restartEasypanel");
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ status: "OK", acao: "painel reiniciando", resultado: result ?? "(sem retorno)" }, null, 2),
        },
      ],
    };
  }

  if (name === "reboot_server") {
    const { confirm } = args as { confirm?: string };
    const blocked = guardDestructive(confirm, "reboot_server", "reinício do SERVIDOR HOST (todos os serviços ficam offline até o boot)");
    if (blocked) return { content: [{ type: "text" as const, text: blocked }] };
    const result = await client.mutate("server.reboot");
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ status: "OK", acao: "servidor reiniciando", resultado: result ?? "(sem retorno)" }, null, 2),
        },
      ],
    };
  }

  throw new Error(`Tool desconhecida: ${name}`);
}
