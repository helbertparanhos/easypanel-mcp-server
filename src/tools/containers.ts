import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import {
  contextHeader,
  ok,
  assertValidName,
  looksDestructiveCommand,
  guardDestructive,
  CONFIRM_KEYWORD,
} from "../context.js";

export const containerTools: Tool[] = [
  {
    name: "list_containers",
    description:
      "Lista os containers Docker em execução de um serviço (ID, nome, imagem, comando, status, portas). Use para descobrir o container antes de exec_in_container ou para checar se o serviço está rodando.",
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
    name: "exec_in_container",
    description: `Executa um comando dentro do container de um serviço e retorna a saída (stdout/stderr). Use para debugar em runtime: inspecionar arquivos, checar variáveis, testar conectividade, rodar migrations, etc. Roda no primeiro container do serviço (ou no containerId informado). ⚠️ Executa comandos arbitrários — comandos potencialmente destrutivos (rm -rf, dd, mkfs, shutdown, kill, pipe para shell, etc.) exigem confirm: "${CONFIRM_KEYWORD}".`,
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
        command: {
          type: "string",
          description: "Comando shell a executar, ex: 'ls -la /app', 'cat package.json', 'env', 'node -v'",
        },
        containerId: {
          type: "string",
          description: "ID do container específico (opcional — default: primeiro container do serviço)",
        },
        confirm: {
          type: "string",
          description: `Obrigatório apenas para comandos destrutivos. Deve ser exatamente "${CONFIRM_KEYWORD}".`,
        },
      },
      required: ["projectName", "serviceName", "command"],
    },
  },
  {
    name: "get_docker_events",
    description:
      "Captura eventos Docker do servidor em tempo real durante uma janela curta (~8s) — start, stop, kill, die, exec, health_status, etc. Use para investigar reinícios e falhas. Obs: só mostra eventos que ocorrem durante a captura (não há histórico); um servidor ocioso pode retornar vazio.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Número máximo de eventos a coletar (default: 30, max: 100)",
          default: 30,
        },
      },
      required: [],
    },
  },
];

type Args = Record<string, unknown>;

export async function handleContainerTool(name: string, args: Args) {
  const client = getClient();

  if (name === "list_containers") {
    const { projectName, serviceName } = args as { projectName: string; serviceName: string };
    assertValidName(projectName, "projectName");
    assertValidName(serviceName, "serviceName");
    const ctx = contextHeader(projectName, serviceName);
    const service = `${projectName}_${serviceName}`;
    const containers = await client.query<any[]>("projects.getDockerContainers", { service });
    const simplified = Array.isArray(containers)
      ? containers.map((c: any) => ({
          id: c.Id,
          nome: Array.isArray(c.Names) ? c.Names[0] : c.Names,
          imagem: c.Image,
          comando: c.Command,
          estado: c.State,
          status: c.Status,
          portas: c.Ports,
        }))
      : containers;
    return { content: [{ type: "text" as const, text: ok(ctx, simplified) }] };
  }

  if (name === "exec_in_container") {
    const { projectName, serviceName, command, containerId, confirm } = args as {
      projectName: string;
      serviceName: string;
      command: string;
      containerId?: string;
      confirm?: string;
    };
    assertValidName(projectName, "projectName");
    assertValidName(serviceName, "serviceName");
    const ctx = contextHeader(projectName, serviceName);

    // Comandos claramente destrutivos exigem confirmação explícita — mesma proteção
    // das demais operações perigosas do servidor, sem atrapalhar comandos de leitura.
    if (looksDestructiveCommand(command)) {
      const blocked = guardDestructive(
        confirm,
        "exec_in_container",
        `comando potencialmente destrutivo no container de "${serviceName}": ${command}`
      );
      if (blocked) return { content: [{ type: "text" as const, text: ctx + blocked }] };
    }

    const service = `${projectName}_${serviceName}`;
    let targetId = containerId;
    if (!targetId) {
      const containers = await client.query<any[]>("projects.getDockerContainers", { service });
      targetId = Array.isArray(containers) && containers[0]?.Id ? containers[0].Id : undefined;
      if (!targetId) {
        return {
          content: [
            {
              type: "text" as const,
              text: ok(ctx, {
                erro: "Nenhum container em execução encontrado para este serviço. O serviço pode estar parado.",
                dica: "Use list_containers para verificar, ou start_service para iniciar.",
              }),
            },
          ],
        };
      }
    }

    const output = await client.execInContainer(targetId, command);
    const body = output.trim().length > 0 ? output : "(comando sem saída)";
    return {
      content: [{ type: "text" as const, text: `${ctx}$ ${command}\n\n${body}` }],
    };
  }

  if (name === "get_docker_events") {
    const { limit = 30 } = args as { limit?: number };
    const maxEvents = Math.min(Number(limit) || 30, 100);
    const events = await client.streamDockerEvents({ maxEvents });
    const simplified = events.map((e: any) => ({
      tipo: e?.Type,
      acao: e?.Action,
      ator: e?.Actor?.Attributes?.name ?? e?.Actor?.ID,
      servico: e?.Actor?.Attributes?.["com.docker.swarm.service.name"],
      em: e?.time ? new Date(e.time * 1000).toISOString() : undefined,
    }));
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { total: simplified.length, eventos: simplified },
            null,
            2
          ),
        },
      ],
    };
  }

  throw new Error(`Tool desconhecida: ${name}`);
}
