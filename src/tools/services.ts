import { Tool, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import { contextHeader, guardDestructive, ok, CONFIRM_KEYWORD } from "../context.js";

export const serviceTools: Tool[] = [
  {
    name: "inspect_service",
    description:
      "Retorna configuração completa de um serviço: source, env vars, deploy config, mounts, ports, domínios, recursos. Use SEMPRE antes de qualquer update para preservar o estado.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
      },
      required: ["projectName", "serviceName"],
    },
  },
  {
    name: "create_service",
    description:
      "Cria um novo serviço de app em um projeto. Após criar, configure a source com set_source_github ou set_source_image.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: {
          type: "string",
          description: "Nome do serviço — apenas letras minúsculas, números, hífens e underscores",
        },
      },
      required: ["projectName", "serviceName"],
    },
  },
  {
    name: "rename_service",
    description: `⚠️ Renomeia ou move um serviço. Webhooks, DNS e referências internas que usam o nome antigo deixarão de funcionar. Requer confirm: "${CONFIRM_KEYWORD}".`,
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Projeto atual do serviço" },
        serviceName: { type: "string", description: "Nome atual do serviço" },
        newProjectName: { type: "string", description: "Novo projeto (pode ser o mesmo)" },
        newServiceName: { type: "string", description: "Novo nome do serviço" },
        confirm: {
          type: "string",
          description: `Confirmação obrigatória. Deve ser exatamente "${CONFIRM_KEYWORD}"`,
        },
      },
      required: ["projectName", "serviceName", "newProjectName", "newServiceName", "confirm"],
    },
  },
  {
    name: "destroy_service",
    description: `⚠️ DESTRUTIVO — Remove permanentemente o serviço e seus dados. Irreversível. Requer confirm: "${CONFIRM_KEYWORD}".`,
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço a destruir" },
        confirm: {
          type: "string",
          description: `Confirmação obrigatória. Deve ser exatamente "${CONFIRM_KEYWORD}"`,
        },
      },
      required: ["projectName", "serviceName", "confirm"],
    },
  },
  {
    name: "deploy_service",
    description:
      "Dispara o deploy do serviço com a configuração atual. Usa o source configurado (GitHub, image, dockerfile). Funciona para serviços app E compose — detecta o tipo e roteia para o namespace certo (não precisa saber de antemão se é compose).",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
      },
      required: ["projectName", "serviceName"],
    },
  },
  {
    name: "start_service",
    description: "Inicia um serviço que está parado. Funciona para app e compose (em compose, equivale a um redeploy/compose up).",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
      },
      required: ["projectName", "serviceName"],
    },
  },
  {
    name: "stop_service",
    description: `⚠️ PARA o serviço em produção. Usuários não conseguirão acessar enquanto parado. Requer confirm: "${CONFIRM_KEYWORD}".`,
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
        confirm: {
          type: "string",
          description: `Confirmação obrigatória. Deve ser exatamente "${CONFIRM_KEYWORD}"`,
        },
      },
      required: ["projectName", "serviceName", "confirm"],
    },
  },
  {
    name: "restart_service",
    description: "Reinicia o serviço. Causa breve indisponibilidade. Funciona para app E compose — em compose, reinicia via redeploy (docker compose up recria os containers).",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
      },
      required: ["projectName", "serviceName"],
    },
  },
  {
    name: "get_service_error",
    description:
      "Retorna o último erro registrado do serviço. Use para debugar falhas de deploy ou runtime.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
      },
      required: ["projectName", "serviceName"],
    },
  },
  {
    name: "get_exposed_ports",
    description:
      "Lista as portas expostas (publicadas no host) de um serviço. Use para descobrir em quais portas o serviço está acessível externamente.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
      },
      required: ["projectName", "serviceName"],
    },
  },
  {
    name: "get_service_notes",
    description: "Lê as notas/anotações salvas no serviço.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
      },
      required: ["projectName", "serviceName"],
    },
  },
  {
    name: "set_service_notes",
    description: "Salva notas/anotações no serviço (markdown suportado).",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
        notes: { type: "string", description: "Conteúdo das notas (markdown)" },
      },
      required: ["projectName", "serviceName", "notes"],
    },
  },
  {
    name: "set_service_resources",
    description:
      "Define limites e reservas de CPU e memória do serviço. Envie só os campos que quer alterar — os omitidos mantêm o valor atual (0 = sem limite). Memória em MB, CPU em núcleos (0.5 = meio núcleo). Aplica no próximo deploy/restart.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
        memoryLimit: { type: "number", description: "Limite de memória em MB (hard cap)" },
        memoryReservation: { type: "number", description: "Reserva de memória em MB (soft)" },
        cpuLimit: { type: "number", description: "Limite de CPU (1 = 1 núcleo)" },
        cpuReservation: { type: "number", description: "Reserva de CPU (1 = 1 núcleo)" },
      },
      required: ["projectName", "serviceName"],
    },
  },
];

type Args = Record<string, unknown>;

export const SERVICE_TYPES = ["app", "compose", "postgres", "mysql", "mariadb", "mongo", "redis"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

/**
 * Extrai o tipo de um serviço a partir da resposta de
 * `projects.listProjectsAndServices`. Função PURA (sem rede) — separada de
 * `resolveServiceType` para ser testável de forma determinística.
 *
 * @remarks Forma confirmada ao vivo (Easypanel v2.30.1):
 *   `{ projects: [...], services: [{ projectName, name, type, ... }] }`,
 *   onde `type` ∈ app|compose|postgres|mysql|mariadb|mongo|redis. O parsing aceita
 *   também formas alternativas (aninhada/agrupada por tipo) para resistir a
 *   mudanças entre versões.
 */
export function extractServiceType(
  data: unknown,
  projectName: string,
  serviceName: string
): ServiceType | null {
  const d = data as any;
  const isType = (t: unknown): t is ServiceType =>
    typeof t === "string" && (SERVICE_TYPES as readonly string[]).includes(t);

  // Coleta entradas de serviço de várias formas conhecidas:
  //   { services: [{ type, name, projectName }] }            ← forma confirmada
  //   { projects: [{ name, services: [{ type, name }] }] }
  //   { app: [...], compose: [...], postgres: [...] }          (agrupado por tipo)
  const candidates: Array<{ type?: unknown; name?: unknown; project?: unknown }> = [];

  if (Array.isArray(d?.services)) {
    for (const s of d.services) {
      candidates.push({ type: s?.type, name: s?.name ?? s?.serviceName, project: s?.projectName ?? s?.project });
    }
  }
  if (Array.isArray(d?.projects)) {
    for (const p of d.projects) {
      const proj = p?.name ?? p?.projectName;
      if (Array.isArray(p?.services)) {
        for (const s of p.services) {
          candidates.push({ type: s?.type, name: s?.name ?? s?.serviceName, project: proj });
        }
      }
    }
  }
  for (const t of SERVICE_TYPES) {
    if (Array.isArray(d?.[t])) {
      for (const s of d[t]) {
        candidates.push({ type: t, name: s?.name ?? s?.serviceName, project: s?.projectName ?? s?.project });
      }
    }
  }

  for (const c of candidates) {
    const matchesProject = c.project === undefined || c.project === projectName;
    if (c.name === serviceName && matchesProject && isType(c.type)) return c.type;
  }
  return null;
}

/**
 * Descobre o tipo de um serviço consultando `projects.listProjectsAndServices`.
 *
 * Necessário porque as procedures de ciclo de vida (deploy/start/stop/restart)
 * vivem em namespaces diferentes por tipo — `services.app.*` vs `services.compose.*`.
 * Chamar o namespace errado retorna 404/500 (foi o que quebrou o redeploy de um
 * serviço compose: o agente chamava `deploy_service`, que só fala com `services.app.*`).
 *
 * Retorna `null` se não conseguir determinar — nesse caso o chamador mantém o
 * comportamento padrão (`app`), preservando a compatibilidade.
 */
export async function resolveServiceType(
  client: ReturnType<typeof getClient>,
  projectName: string,
  serviceName: string
): Promise<ServiceType | null> {
  try {
    const data = await client.query<unknown>("projects.listProjectsAndServices");
    return extractServiceType(data, projectName, serviceName);
  } catch {
    return null; // detecção é best-effort; falha → chamador usa o default
  }
}

/** Tipos que são banco de dados — não têm deploy/start/stop/restart próprios. */
const DB_TYPES: readonly ServiceType[] = ["postgres", "mysql", "mariadb", "mongo", "redis"];

/** Grafia do tipo na API pública (`enableMongoDBService`, `enableMySQLService`, …). */
const DB_LABELS: Record<string, string> = {
  postgres: "Postgres",
  mysql: "MySQL",
  mariadb: "MariaDB",
  mongo: "MongoDB",
  redis: "Redis",
};
function dbLabel(type: ServiceType): string {
  return DB_LABELS[type] ?? type;
}

/**
 * Como ligar/desligar um banco, na forma que funciona no painel em uso.
 * O nome achatado (`enablePostgresService`) só existe na API pública 2.33+; num
 * painel antigo ele viraria `/api/rpc/enablePostgresService` e daria 404, então
 * ali apontamos para a UI em vez de mandar o usuário para uma chamada quebrada.
 */
async function dbPowerHint(
  client: ReturnType<typeof getClient>,
  type: ServiceType,
  verbo: "enable" | "disable"
): Promise<string> {
  const flat = `${verbo}${dbLabel(type)}Service`;
  return (await client.isPublicApi())
    ? `Use easypanel_raw com isMutation:true e procedure "${flat}".`
    : `Use o painel do Easypanel (botão ${verbo === "enable" ? "Start" : "Stop"} do serviço) — ` +
      `este painel é anterior ao 2.33 e não documenta "${flat}".`;
}

/**
 * Resposta padrão para uma ação de ciclo de vida que o tipo do serviço não
 * expõe. Melhor que disparar no namespace errado (era o que acontecia até a v2:
 * `destroy_service`/`inspect_service` chamavam `services.app.*` mesmo em compose
 * e bancos, resultando em 404 opaco).
 */
function unsupportedForType(
  ctx: string,
  action: string,
  type: ServiceType,
  motivo: string,
  alternativa: string
) {
  return {
    content: [
      {
        type: "text" as const,
        text: ok(ctx, { status: "nao_suportado", acao: action, tipo: type, motivo, alternativa }),
      },
    ],
  };
}

export async function handleServiceTool(name: string, args: Args) {
  const client = getClient();
  const { projectName, serviceName } = args as { projectName: string; serviceName: string };
  const ctx = contextHeader(projectName, serviceName);

  if (name === "inspect_service") {
    // Cada tipo tem seu próprio inspectService. Até a v2 esta tool sempre chamava
    // o namespace `app`, então inspecionar um compose ou um banco dava 404.
    const type = (await resolveServiceType(client, projectName, serviceName)) ?? "app";
    const result = await client.query(`services.${type}.inspectService`, {
      projectName,
      serviceName,
    });
    return { content: [{ type: "text" as const, text: ok(ctx, result) }] };
  }

  if (name === "create_service") {
    await client.mutate("services.app.createService", { projectName, serviceName });
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            status: "criado",
            projectName,
            serviceName,
            proximo_passo: "Configure a source com set_source_github ou set_source_image",
          }),
        },
      ],
    };
  }

  if (name === "rename_service") {
    const { newProjectName, newServiceName, confirm } = args as {
      newProjectName: string;
      newServiceName: string;
      confirm: string;
    };
    const blocked = guardDestructive(
      confirm,
      "rename_service",
      `serviço "${serviceName}" → "${newProjectName}/${newServiceName}" (webhooks e referências ao nome antigo irão quebrar)`
    );
    if (blocked) return { content: [{ type: "text" as const, text: ctx + blocked }] };
    await client.mutate("services.common.rename", {
      oldProjectName: projectName,
      oldServiceName: serviceName,
      newProjectName,
      newServiceName,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            status: "renomeado",
            de: `${projectName}/${serviceName}`,
            para: `${newProjectName}/${newServiceName}`,
          }),
        },
      ],
    };
  }

  if (name === "destroy_service") {
    const { confirm } = args as { confirm: string };
    const blocked = guardDestructive(
      confirm,
      "destroy_service",
      `serviço "${serviceName}" no projeto "${projectName}"`
    );
    if (blocked) return { content: [{ type: "text" as const, text: ctx + blocked }] };
    // Cada tipo tem seu próprio destroyService — chamar o do `app` num compose ou
    // banco falhava com 404 (bug até a v2).
    const type = (await resolveServiceType(client, projectName, serviceName)) ?? "app";
    await client.mutate(`services.${type}.destroyService`, { projectName, serviceName });
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, { status: "destruido", tipo: type, projectName, serviceName }),
        },
      ],
    };
  }

  if (name === "deploy_service") {
    // Compose vive em outro namespace: services.app.deployService dá 404/500 num
    // serviço compose. Detecta o tipo e roteia para services.compose.deployService.
    const type = await resolveServiceType(client, projectName, serviceName);
    if (type && DB_TYPES.includes(type)) {
      return unsupportedForType(
        ctx,
        "deploy_service",
        type,
        "Serviços de banco de dados não têm deploy — a imagem sobe na criação e é gerenciada pelo painel.",
        "Use inspect_database para ver o estado, ou restart_service não se aplica a bancos."
      );
    }
    const procedure = type === "compose" ? "services.compose.deployService" : "services.app.deployService";
    const result = await client.mutate(procedure, { projectName, serviceName });
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            status: "deploy_iniciado",
            projectName,
            serviceName,
            tipo: type ?? "app (assumido — tipo não detectado)",
            resultado: result,
            dica: "Use list_actions para acompanhar o progresso do deploy",
          }),
        },
      ],
    };
  }

  if (name === "start_service") {
    const type = await resolveServiceType(client, projectName, serviceName);
    if (type && DB_TYPES.includes(type)) {
      return unsupportedForType(
        ctx,
        "start_service",
        type,
        "Bancos de dados são ligados/desligados por procedures próprias (enable/disable), não por start.",
        await dbPowerHint(client, type, "enable")
      );
    }
    if (type === "compose") {
      // O 2.33 documenta startComposeService na API pública. Em painéis antigos
      // não havia procedure confirmada — ali subir um stack parado = redeploy.
      if (await client.isPublicApi()) {
        await client.mutate("services.compose.startService", { projectName, serviceName });
        return {
          content: [
            {
              type: "text" as const,
              text: ok(ctx, { status: "iniciado", tipo: "compose", projectName, serviceName }),
            },
          ],
        };
      }
      const result = await client.mutate("services.compose.deployService", { projectName, serviceName });
      return {
        content: [
          {
            type: "text" as const,
            text: ok(ctx, {
              status: "iniciado",
              tipo: "compose",
              via: "services.compose.deployService (compose up — painel sem start dedicado)",
              projectName,
              serviceName,
              resultado: result,
            }),
          },
        ],
      };
    }
    await client.mutate("services.app.startService", { projectName, serviceName });
    return { content: [{ type: "text" as const, text: ok(ctx, { status: "iniciado", projectName, serviceName }) }] };
  }

  if (name === "stop_service") {
    const { confirm } = args as { confirm: string };
    const blocked = guardDestructive(
      confirm,
      "stop_service",
      `serviço "${serviceName}" (usuários perderão acesso)`
    );
    if (blocked) return { content: [{ type: "text" as const, text: ctx + blocked }] };
    const type = await resolveServiceType(client, projectName, serviceName);
    if (type && DB_TYPES.includes(type)) {
      return unsupportedForType(
        ctx,
        "stop_service",
        type,
        "Bancos de dados são ligados/desligados por procedures próprias (enable/disable), não por stop.",
        await dbPowerHint(client, type, "disable")
      );
    }
    if (type === "compose") {
      // O 2.33 documenta stopComposeService na API pública. Em painéis antigos não
      // havia procedure confirmada, e parar ≠ redeploy — ali seguimos orientando
      // em vez de disparar uma escrita no escuro.
      if (await client.isPublicApi()) {
        await client.mutate("services.compose.stopService", { projectName, serviceName });
        return {
          content: [
            {
              type: "text" as const,
              text: ok(ctx, { status: "parado", tipo: "compose", projectName, serviceName }),
            },
          ],
        };
      }
      return unsupportedForType(
        ctx,
        "stop_service",
        "compose",
        "Parar um serviço compose só tem procedure documentada a partir do Easypanel 2.33; este painel é mais antigo.",
        "Use o botão 'Stop' do serviço no painel, ou atualize o Easypanel."
      );
    }
    await client.mutate("services.app.stopService", { projectName, serviceName });
    return { content: [{ type: "text" as const, text: ok(ctx, { status: "parado", projectName, serviceName }) }] };
  }

  if (name === "restart_service") {
    const type = await resolveServiceType(client, projectName, serviceName);
    if (type && DB_TYPES.includes(type)) {
      return unsupportedForType(
        ctx,
        "restart_service",
        type,
        "Bancos de dados não expõem restart; o ciclo é desligar e ligar (disable/enable).",
        `${await dbPowerHint(client, type, "disable")} Depois, o equivalente para religar.`
      );
    }
    if (type === "compose") {
      // O 2.33 documenta restartComposeService. Em painéis antigos, "restart" de
      // compose = redeploy (docker compose up recria os containers).
      if (await client.isPublicApi()) {
        await client.mutate("services.compose.restartService", { projectName, serviceName });
        return {
          content: [
            {
              type: "text" as const,
              text: ok(ctx, { status: "reiniciado", tipo: "compose", projectName, serviceName }),
            },
          ],
        };
      }
      const result = await client.mutate("services.compose.deployService", { projectName, serviceName });
      return {
        content: [
          {
            type: "text" as const,
            text: ok(ctx, {
              status: "reiniciado",
              tipo: "compose",
              via: "services.compose.deployService (redeploy — painel sem restart dedicado)",
              projectName,
              serviceName,
              resultado: result,
              dica: "Use list_actions para acompanhar o progresso.",
            }),
          },
        ],
      };
    }
    await client.mutate("services.app.restartService", { projectName, serviceName });
    return { content: [{ type: "text" as const, text: ok(ctx, { status: "reiniciado", projectName, serviceName }) }] };
  }

  if (name === "get_service_error") {
    const result = await client.query("services.common.getServiceError", { projectName, serviceName });
    return { content: [{ type: "text" as const, text: ok(ctx, result) }] };
  }

  if (name === "get_exposed_ports") {
    const result = await client.query("services.app.getExposedPorts", { projectName, serviceName });
    return { content: [{ type: "text" as const, text: ok(ctx, result) }] };
  }

  if (name === "get_service_notes") {
    const result = await client.query("services.common.getNotes", { projectName, serviceName });
    return { content: [{ type: "text" as const, text: ok(ctx, result) }] };
  }

  if (name === "set_service_notes") {
    const { notes } = args as { notes: string };
    await client.mutate("services.common.setNotes", { projectName, serviceName, notes });
    return { content: [{ type: "text" as const, text: ok(ctx, { status: "notas_salvas", projectName, serviceName }) }] };
  }

  if (name === "set_service_resources") {
    const { memoryLimit, memoryReservation, cpuLimit, cpuReservation } = args as {
      memoryLimit?: number;
      memoryReservation?: number;
      cpuLimit?: number;
      cpuReservation?: number;
    };
    // Valida cada campo informado: o SDK não valida inputSchema em runtime, então
    // garantimos número finito e positivo antes de mandar à API.
    const assertPositive = (v: unknown, field: string) => {
      if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v <= 0)) {
        throw new McpError(ErrorCode.InvalidParams, `${field} inválido. Use um número positivo.`);
      }
    };
    assertPositive(memoryLimit, "memoryLimit");
    assertPositive(memoryReservation, "memoryReservation");
    assertPositive(cpuLimit, "cpuLimit");
    assertPositive(cpuReservation, "cpuReservation");

    if (
      memoryLimit === undefined &&
      memoryReservation === undefined &&
      cpuLimit === undefined &&
      cpuReservation === undefined
    ) {
      return {
        content: [
          {
            type: "text" as const,
            text: ok(ctx, {
              erro: "Informe ao menos um limite/reserva (memoryLimit, memoryReservation, cpuLimit ou cpuReservation).",
            }),
          },
        ],
      };
    }

    // A API exige o objeto `resources` COMPLETO (os 4 campos, descoberto em teste
    // real) — um update parcial sem os outros campos é rejeitado. Para preservar a
    // UX de "altere só o que quiser", lemos os valores atuais e mesclamos por cima.
    // 0 = sem limite/reserva no Easypanel (default quando nunca foi configurado).
    const current = await client.query<{ resources?: Record<string, number> | null }>(
      "services.app.inspectService",
      { projectName, serviceName }
    );
    const base = current?.resources ?? {};
    const resources = {
      memoryReservation: memoryReservation ?? base.memoryReservation ?? 0,
      memoryLimit: memoryLimit ?? base.memoryLimit ?? 0,
      cpuReservation: cpuReservation ?? base.cpuReservation ?? 0,
      cpuLimit: cpuLimit ?? base.cpuLimit ?? 0,
    };
    await client.mutate("services.app.updateResources", { projectName, serviceName, resources });
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            status: "recursos_atualizados",
            aplicado: resources,
            dica: "Faça deploy_service ou restart_service para aplicar.",
          }),
        },
      ],
    };
  }

  throw new Error(`Tool desconhecida: ${name}`);
}
