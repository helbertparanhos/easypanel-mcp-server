/**
 * Tradução dos nomes de procedure entre as gerações da API do Easypanel.
 *
 * As tools deste MCP sempre falaram o nome INTERNO em notação de pontos
 * (`services.app.inspectService`) — a forma usada pelo tRPC (≤ 2.30) e pela
 * camada RPC (2.31–2.32). O Easypanel 2.33 publicou uma API pública documentada
 * onde cada procedure vira um path achatado (`/api/inspectAppService`), com
 * nomes desambiguados por tipo de serviço em vez de namespace.
 *
 * A conversão NÃO é mecânica — o namespace vira parte do nome, e algumas
 * procedures foram renomeadas de vez:
 *   services.app.inspectService  → inspectAppService
 *   services.common.rename       → renameService
 *   monitorOld.getSystemStats    → getLegacyMonitorSystemStats
 *
 * Por isso a tabela é explícita. Cada entrada é verificada contra um snapshot do
 * OpenAPI real do painel em `test/fixtures/easypanel-2.33-ops.json` (veja
 * `test/procedures.test.ts`): o teste falha se um nome deixar de existir no spec,
 * o que transforma uma futura renomeação do Easypanel em erro de CI em vez de 404
 * em produção.
 */
export const PUBLIC_PROCEDURES: Record<string, string> = {
  // ---------- projects ----------
  "projects.listProjects": "listProjects",
  "projects.listProjectsAndServices": "listProjectsAndServices",
  "projects.inspectProject": "inspectProject",
  "projects.createProject": "createProject",
  "projects.destroyProject": "destroyProject",
  "projects.getDockerContainers": "getDockerContainers",

  // ---------- services.app ----------
  "services.app.inspectService": "inspectAppService",
  "services.app.createService": "createAppService",
  "services.app.destroyService": "destroyAppService",
  "services.app.deployService": "deployAppService",
  "services.app.startService": "startAppService",
  "services.app.stopService": "stopAppService",
  "services.app.restartService": "restartAppService",
  "services.app.getExposedPorts": "getAppExposedPorts",
  "services.app.updateEnv": "updateAppEnv",
  "services.app.updateResources": "updateAppResources",
  "services.app.updateSourceGithub": "updateAppSourceGithub",
  "services.app.updateSourceImage": "updateAppSourceImage",
  "services.app.enableGithubDeploy": "enableAppGithubDeploy",
  "services.app.disableGithubDeploy": "disableAppGithubDeploy",

  // ---------- services.common ----------
  "services.common.getNotes": "getServiceNotes",
  "services.common.setNotes": "setServiceNotes",
  "services.common.getServiceError": "getServiceError",
  "services.common.rename": "renameService",

  // ---------- services.compose ----------
  // start/stop/restart existem na API pública 2.33 (confirmado no spec). Nas
  // gerações antigas não havia procedure confirmada — daí o gate por flavor em
  // `supportsComposeLifecycle()`.
  "services.compose.createService": "createComposeService",
  "services.compose.inspectService": "inspectComposeService",
  "services.compose.deployService": "deployComposeService",
  "services.compose.destroyService": "destroyComposeService",
  "services.compose.startService": "startComposeService",
  "services.compose.stopService": "stopComposeService",
  "services.compose.restartService": "restartComposeService",
  "services.compose.updateEnv": "updateComposeEnv",

  // ---------- bancos de dados ----------
  "services.postgres.createService": "createPostgresService",
  "services.postgres.inspectService": "inspectPostgresService",
  "services.postgres.destroyService": "destroyPostgresService",
  "services.mysql.createService": "createMySQLService",
  "services.mysql.inspectService": "inspectMySQLService",
  "services.mysql.destroyService": "destroyMySQLService",
  "services.mariadb.createService": "createMariaDBService",
  "services.mariadb.inspectService": "inspectMariaDBService",
  "services.mariadb.destroyService": "destroyMariaDBService",
  "services.mongo.createService": "createMongoDBService",
  "services.mongo.inspectService": "inspectMongoDBService",
  "services.mongo.destroyService": "destroyMongoDBService",
  "services.redis.createService": "createRedisService",
  "services.redis.inspectService": "inspectRedisService",
  "services.redis.destroyService": "destroyRedisService",

  // ---------- domínios / mounts / portas ----------
  "domains.listDomains": "listDomains",
  "domains.createDomain": "createDomain",
  "domains.deleteDomain": "deleteDomain",
  "domains.setPrimaryDomain": "setPrimaryDomain",
  "mounts.listMounts": "listMounts",
  "mounts.createMount": "createMount",
  "ports.listPorts": "listPorts",
  "ports.createPort": "createPort",

  // ---------- ações ----------
  "actions.listActions": "listActions",
  "actions.getAction": "getAction",

  // ---------- monitoramento legado ----------
  // O painel renomeou o namespace `monitorOld` para "Legacy Monitoring" e
  // prefixou as procedures que colidiam com o sistema de métricas novo.
  "monitorOld.getSystemStats": "getLegacyMonitorSystemStats",
  "monitorOld.getServiceStats": "getLegacyMonitorServiceStats",
  "monitorOld.getDockerTaskStats": "getDockerTaskStats",
  "monitorOld.getStorageStats": "getStorageStats",

  // ---------- infraestrutura / servidor ----------
  "certificates.listCertificates": "listCertificates",
  "cluster.listNodes": "listNodes",
  "users.listUsers": "listUsers",
  "settings.systemPrune": "systemPrune",
  "settings.cleanupDockerImages": "cleanupDockerImages",
  "settings.restartEasypanel": "restartEasypanel",
  "server.reboot": "reboot",
  "update.getStatus": "getUpdateStatus",
};

/** Reverso: nome público achatado → nome interno em notação de pontos. */
const INTERNAL_PROCEDURES: Record<string, string> = Object.fromEntries(
  Object.entries(PUBLIC_PROCEDURES).map(([internal, pub]) => [pub, internal])
);

/**
 * Nome público (achatado) de uma procedure. Aceita as duas formas:
 *  - interna (`services.app.inspectService`) → traduz pela tabela;
 *  - já achatada (`inspectAppService`) → devolve como veio.
 * Retorna `null` quando o nome tem ponto mas não está mapeado — o chamador
 * decide entre recusar (easypanel_raw) ou cair no transporte interno (tools curadas).
 */
export function publicNameFor(procedure: string): string | null {
  if (!procedure.includes(".")) return procedure;
  return PUBLIC_PROCEDURES[procedure] ?? null;
}

/**
 * Nome interno de uma procedure, para quando a chamada precisa voltar ao
 * transporte RPC (`/api/rpc/ns/proc`) — caso dos reads com parâmetro não-string,
 * que a query string da API pública não consegue carregar.
 */
export function internalNameFor(procedure: string): string | null {
  if (procedure.includes(".")) return procedure;
  return INTERNAL_PROCEDURES[procedure] ?? null;
}
