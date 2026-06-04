/**
 * Confirmação obrigatória para ações destrutivas.
 * O usuário deve passar confirm: "CONFIRMO" explicitamente.
 */
export const CONFIRM_KEYWORD = "CONFIRMO";

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
