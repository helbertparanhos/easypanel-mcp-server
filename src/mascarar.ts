/**
 * Mascaramento central de segredos nas respostas das tools.
 *
 * Por que existe: até a v3.0.0 só o `get_env_vars` mascarava, e só por nome de
 * chave. As outras tools devolviam o objeto do painel cru — e ele carrega segredo
 * em vários lugares. Incidentes reais que motivaram:
 *  - `inspect_service` devolveu o token do webhook de deploy (`.../api/deploy/<token>`);
 *  - `list_projects`/`get_project` e `get_env_vars` despejaram o env inteiro
 *    (senha de banco, pepper de token) na conversa.
 *
 * Como funciona: `handleTool` passa TODO resultado por `mascararResultado` antes
 * de devolver ao cliente MCP. O texto de cada tool é `[cabeçalho de contexto] +
 * JSON`; o JSON é desmontado e mascarado por estrutura (nome do campo, em qualquer
 * profundidade) e, dentro de cada string, por forma (token de deploy, credencial
 * em URL, linhas `CHAVE=valor`, chave privada PEM). Texto que não é JSON (logs,
 * saída de exec) passa só pelo mascaramento por forma.
 *
 * Mascarar = trocar por `***`, sem manter pedaço nenhum do valor.
 *
 * É best-effort por nome e por forma: um segredo guardado numa chave de nome
 * inocente (`FOO=abc`) e sem forma reconhecível passa. A exceção explícita é o
 * `get_env_vars` com `include_values: true` (e o `inspect_database` com
 * `include_secrets: true`), que existem justamente para revelar — ver
 * `devolveSegredos`.
 */

export const MASCARA = "***";

/**
 * Nome de campo/variável que indica segredo. Casa por substring, sem diferenciar
 * caixa (`DATABASE_PASSWORD`, `apiToken`, `PAT_PEPPER`, `deploymentUrl`...).
 * `pass` sozinho só como segmento (`DB_PASS`), para não pegar `passthrough`.
 */
export const SENSITIVE_PATTERN =
  /secret|passw|pwd|token|key|credential|private|auth|pepper|webhook|salt|cookie|(?:^|[_.-])pass(?:$|[_.-])|deploy(?:ment)?[_-]?url/i;

/**
 * Nomes que casam o padrão mas não guardam segredo. `key` é o NOME da variável
 * nas respostas de `set_env_var`/`delete_env_var` e nos pares `{ key, value }` —
 * mascará-lo esconderia qual variável foi mexida, sem proteger nada.
 */
const NOMES_ISENTOS = new Set(["key"]);

/** O nome de campo/variável indica segredo? */
export function chaveSensivel(nome: string): boolean {
  if (NOMES_ISENTOS.has(nome.toLowerCase())) return false;
  return SENSITIVE_PATTERN.test(nome);
}

// --- mascaramento por forma (dentro de qualquer string) ---------------------

// Bloco PEM de chave privada (certificados, chaves SSH/Git).
const PEM_RE = /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/g;

// Token do webhook de deploy: `https://painel/api/deploy/<token>`.
const DEPLOY_RE = /(\/api\/deploy\/)[^\s"'\/?#&<>\\]+/g;

// Credencial embutida em URL: `postgres://user:senha@host`, `https://ghp_x@github.com`.
// O userinfo pode ter `@` sem escape (senha `p@ss`) — por isso o match é guloso até
// o último `@` antes do primeiro `/`, `?` ou `#`.
const URL_CRED_RE = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s\/?#"'<>\\]+)@/gi;

// Par JSON dentro de texto: `"password": "x"`.
const JSON_PAR_RE = /"([^"\\\n]{1,200})"(\s*:\s*)"((?:[^"\\\n]|\\.)*)"/g;

// Linha de env (`CHAVE=valor`, `export CHAVE=valor`, `- CHAVE=valor` do compose) ou
// de YAML (`CHAVE: valor`). O valor vai até o fim da linha (tolerando `\r\n`).
const LINHA_RE =
  /^([ \t]*(?:-[ \t]*)?(?:export[ \t]+)?)([A-Za-z_][A-Za-z0-9_.-]*)([ \t]*=[ \t]*|[ \t]*:[ \t]+)(\S[^\r\n]*)(?=\r?$)/gm;

// Atribuição no meio da linha ou query string: `-e DB_PASSWORD=x`, `?api_key=x`.
const ATRIBUICAO_RE = /(^|[\s?&;,(])([A-Za-z_][A-Za-z0-9_.-]*)=("[^"\n]*"|'[^'\n]*'|[^\s&;,"'#<>)]+)/g;

// Cabeçalho de autorização: `Bearer <token>`.
const BEARER_RE = /\b(Bearer|Basic)[ \t]+[A-Za-z0-9._~+\/=-]{8,}/g;

// Valores que não são segredo mesmo sob chave sensível (YAML de bloco, vazio).
const VALOR_ESTRUTURAL = new Set(["|", ">", "{", "[", "|-", ">-", '""', "''", MASCARA]);

/** Mascara segredos reconhecíveis pela forma dentro de um texto livre. */
export function mascararTexto(texto: string): string {
  if (!texto) return texto;
  return texto
    .replace(PEM_RE, MASCARA)
    .replace(DEPLOY_RE, `$1${MASCARA}`)
    .replace(URL_CRED_RE, (todo, esquema: string, userinfo: string) =>
      // `ssh://git@github.com/...` não carrega segredo — `git` é o usuário fixo.
      userinfo === "git" ? todo : `${esquema}${MASCARA}@`
    )
    .replace(JSON_PAR_RE, (todo, chave: string, sep: string) =>
      chaveSensivel(chave) ? `"${chave}"${sep}"${MASCARA}"` : todo
    )
    .replace(LINHA_RE, (todo, pre: string, chave: string, sep: string, valor: string) =>
      chaveSensivel(chave) && !VALOR_ESTRUTURAL.has(valor.trim())
        ? `${pre}${chave}${sep}${MASCARA}`
        : todo
    )
    .replace(ATRIBUICAO_RE, (todo, pre: string, chave: string) =>
      chaveSensivel(chave) ? `${pre}${chave}=${MASCARA}` : todo
    )
    .replace(BEARER_RE, `$1 ${MASCARA}`);
}

// --- mascaramento por estrutura (JSON) ---------------------------------------

/**
 * Mascara um valor JSON em qualquer profundidade.
 *  - campo de nome sensível → todo valor escalar (string/número) abaixo dele vira
 *    `***`, inclusive dentro de objetos/arrays (`secrets: { FOO: "x" }` não vaza
 *    `FOO` por ele não ter nome sensível). Booleanos e null ficam — não são segredo
 *    e dizem se algo está ligado (`twoFactorEnabled`).
 *  - par `{ key|name: "SENHA_X", value: "..." }` → `value` mascarado.
 *  - toda string passa por `mascararTexto` (o `env` do Easypanel é uma string
 *    `CHAVE=valor\n...`, e URLs de source/conexão carregam credencial).
 */
export function mascarar(valor: unknown, sensivel = false): unknown {
  if (typeof valor === "string") return sensivel && valor !== "" ? MASCARA : mascararTexto(valor);
  if (typeof valor === "number" || typeof valor === "bigint") return sensivel ? MASCARA : valor;
  if (Array.isArray(valor)) return valor.map((v) => mascarar(v, sensivel));
  if (valor && typeof valor === "object") {
    const obj = valor as Record<string, unknown>;
    const nomeDoPar = typeof obj.key === "string" ? obj.key : typeof obj.name === "string" ? obj.name : null;
    const parSensivel = nomeDoPar !== null && "value" in obj && chaveSensivel(nomeDoPar);
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const s = sensivel || chaveSensivel(k) || (parSensivel && k === "value");
      saida[k] = mascarar(v, s);
    }
    return saida;
  }
  return valor;
}

// --- aplicação no resultado da tool -----------------------------------------

// Banner de `contextHeader` (context.ts) — fica fora do JSON.
const CABECALHO_RE = /^(\[Contexto ativo:[^\n]*\]\n\n)/;

/**
 * Mascara o texto de uma resposta de tool. Se o corpo (depois do cabeçalho de
 * contexto) for JSON, mascara por estrutura e re-serializa no formato de `ok()`;
 * senão, só por forma.
 */
export function mascararTextoDeTool(texto: string): string {
  const m = CABECALHO_RE.exec(texto);
  const cabecalho = m ? m[1] : "";
  const corpo = texto.slice(cabecalho.length);
  let dado: unknown;
  try {
    dado = JSON.parse(corpo);
  } catch {
    return cabecalho + mascararTexto(corpo);
  }
  if (typeof dado === "string") return cabecalho + JSON.stringify(mascararTexto(dado));
  return cabecalho + JSON.stringify(mascarar(dado), null, 2);
}

type Conteudo = { type: string; text?: string; [k: string]: unknown };

/** Mascara todos os blocos de texto de um resultado de tool (`{ content: [...] }`). */
export function mascararResultado<T>(resultado: T): T {
  const r = resultado as { content?: Conteudo[] } | null | undefined;
  if (!r || !Array.isArray(r.content)) return resultado;
  return {
    ...r,
    content: r.content.map((c) =>
      c && c.type === "text" && typeof c.text === "string"
        ? { ...c, text: mascararTextoDeTool(c.text) }
        : c
    ),
  } as T;
}

/**
 * Exceções explícitas: pedidos em que revelar o segredo É o objetivo da chamada.
 * Comparação estrita com `true` — `"true"` (string) ou qualquer outro valor não
 * revela nada.
 */
export function devolveSegredos(nomeDaTool: string, args: Record<string, unknown>): boolean {
  if (nomeDaTool === "get_env_vars") return args.include_values === true;
  if (nomeDaTool === "inspect_database") return args.include_secrets === true;
  return false;
}
