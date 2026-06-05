import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { projectTools, handleProjectTool } from "./projects.js";
import { serviceTools, handleServiceTool } from "./services.js";
import { deployTools, handleDeployTool } from "./deploy.js";
import { envTools, handleEnvTool } from "./env.js";
import { logTools, handleLogTool } from "./logs.js";
import { domainTools, handleDomainTool } from "./domains.js";
import { databaseTools, handleDatabaseTool } from "./databases.js";
import { monitoringTools, handleMonitoringTool } from "./monitoring.js";
import { containerTools, handleContainerTool } from "./containers.js";

export const allTools: Tool[] = [
  ...projectTools,
  ...serviceTools,
  ...deployTools,
  ...envTools,
  ...logTools,
  ...domainTools,
  ...databaseTools,
  ...monitoringTools,
  ...containerTools,
];

const projectToolNames = new Set(projectTools.map((t) => t.name));
const serviceToolNames = new Set(serviceTools.map((t) => t.name));
const deployToolNames = new Set(deployTools.map((t) => t.name));
const envToolNames = new Set(envTools.map((t) => t.name));
const logToolNames = new Set(logTools.map((t) => t.name));
const domainToolNames = new Set(domainTools.map((t) => t.name));
const databaseToolNames = new Set(databaseTools.map((t) => t.name));
const monitoringToolNames = new Set(monitoringTools.map((t) => t.name));
const containerToolNames = new Set(containerTools.map((t) => t.name));

export async function handleTool(name: string, args: Record<string, unknown>) {
  if (projectToolNames.has(name)) return handleProjectTool(name, args);
  if (serviceToolNames.has(name)) return handleServiceTool(name, args);
  if (deployToolNames.has(name)) return handleDeployTool(name, args);
  if (envToolNames.has(name)) return handleEnvTool(name, args);
  if (logToolNames.has(name)) return handleLogTool(name, args);
  if (domainToolNames.has(name)) return handleDomainTool(name, args);
  if (databaseToolNames.has(name)) return handleDatabaseTool(name, args);
  if (monitoringToolNames.has(name)) return handleMonitoringTool(name, args);
  if (containerToolNames.has(name)) return handleContainerTool(name, args);
  throw new Error(`Tool não encontrada: ${name}`);
}
