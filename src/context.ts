import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

/**
 * Confirmação obrigatória para ações destrutivas.
 * O usuário deve passar confirm: "CONFIRMO" explicitamente.
 */
export const CONFIRM_KEYWORD = "CONFIRMO";

/**
 * Modo somente-leitura global. Com `MCP_ACCESS_MODE=readonly`, toda mutation é
 * bloqueada em `EasyPanelClient.mutate` — útil para conectar o MCP a um painel de
 * produção permitindo apenas inspeção/diagnóstico, sem risco de escrita acidental.
 * Lido a cada chamada (e não no boot) para refletir mudanças de env em runtime/testes.
 */
export function isReadOnly(): boolean {
  return (process.env.MCP_ACCESS_MODE || "").toLowerCase() === "readonly";
}

/**
 * Valida nomes de projeto/serviço antes de usá-los na construção do nome do
 * serviço Docker (`${projectName}_${serviceName}`) e na query string de
 * WebSockets. O Easypanel só aceita minúsculas, números, hífens e underscores —
 * rejeitar aqui evita confusão de alvo e injeção de parâmetros na query do WS
 * (defense-in-depth; o SDK do MCP não valida o inputSchema em runtime).
 */
export function assertValidName(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]*$/.test(value)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `${field} inválido. Use apenas letras minúsculas, números, hífens e underscores (sem espaços, barras, ".." ou caracteres de controle).`
    );
  }
  return value;
}

/**
 * Heurística para detectar comandos shell claramente destrutivos, usada por
 * exec_in_container para exigir confirmação explícita apenas nesses casos
 * (preservando a UX de debug para comandos de leitura como ls/cat/env).
 */
export function looksDestructiveCommand(command: string): boolean {
  const c = String(command);
  return (
    /\brm\s+(-\S*\s+)*-?\S*[rf]/i.test(c) || // rm com -r/-f
    /\b(rmdir|shred|dd|mkfs\w*|fdisk|wipefs|truncate)\b/i.test(c) ||
    /\b(shutdown|reboot|halt|poweroff|init\s+0|init\s+6)\b/i.test(c) ||
    /\b(kill|killall|pkill)\b/i.test(c) ||
    /\bchmod\s+-R\b/i.test(c) ||
    /\bchown\s+-R\b/i.test(c) ||
    /:\s*\(\s*\)\s*\{/.test(c) || // fork bomb :(){
    /\bmv\s+\/\S/.test(c) || // mover a partir da raiz
    />\s*\/(etc|usr|bin|sbin|var|root|boot|lib|opt|app)\b/i.test(c) || // sobrescrever paths de sistema
    /\b(curl|wget)\b[^\n|]*\|\s*(sh|bash)\b/i.test(c) // pipe de download para shell
  );
}

/**
 * Banner exibido no início de toda resposta que toca um projeto/serviço específico.
 * Garante que o Claude e o usuário sempre saibam o que está sendo modificado.
 */
export function contextHeader(projectName: string, serviceName?: string): string {
  if (serviceName) {
    return `[Contexto ativo: projeto="${projectName}" | serviço="${serviceName}"]\n\n`;
  }
  return `[Contexto ativo: projeto="${projectName}"]\n\n`;
}

/**
 * Guard para ações destrutivas.
 * Retorna null se a confirmação está correta (pode prosseguir).
 * Retorna uma string de bloqueio caso contrário (retorne ela como resposta da tool).
 */
export function guardDestructive(
  confirm: string | undefined,
  action: string,
  target: string
): string | null {
  if (confirm === CONFIRM_KEYWORD) return null;

  return JSON.stringify(
    {
      status: "BLOQUEADO",
      acao: action,
      alvo: target,
      motivo: "Ação destrutiva ou crítica requer confirmação explícita do usuário",
      instrucao: `Para confirmar, passe o parâmetro: confirm: "${CONFIRM_KEYWORD}"`,
      aviso: "⚠️  Esta ação pode ser IRREVERSÍVEL. Confirme apenas se tiver certeza.",
    },
    null,
    2
  );
}

export function ok(ctx: string, body: unknown): string {
  return ctx + JSON.stringify(body, null, 2);
}
