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
import { maintenanceTools, handleMaintenanceTool } from "./maintenance.js";
import { mountTools, handleMountTool } from "./mounts.js";
import { portTools, handlePortTool } from "./ports.js";
import { composeTools, handleComposeTool } from "./compose.js";
import { serverTools, handleServerTool } from "./server.js";
import { rawTools, handleRawTool } from "./raw.js";

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
  ...maintenanceTools,
  ...mountTools,
  ...portTools,
  ...composeTools,
  ...serverTools,
  ...rawTools,
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
const maintenanceToolNames = new Set(maintenanceTools.map((t) => t.name));
const mountToolNames = new Set(mountTools.map((t) => t.name));
const portToolNames = new Set(portTools.map((t) => t.name));
const composeToolNames = new Set(composeTools.map((t) => t.name));
const serverToolNames = new Set(serverTools.map((t) => t.name));
const rawToolNames = new Set(rawTools.map((t) => t.name));

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
  if (maintenanceToolNames.has(name)) return handleMaintenanceTool(name, args);
  if (mountToolNames.has(name)) return handleMountTool(name, args);
  if (portToolNames.has(name)) return handlePortTool(name, args);
  if (composeToolNames.has(name)) return handleComposeTool(name, args);
  if (serverToolNames.has(name)) return handleServerTool(name, args);
  if (rawToolNames.has(name)) return handleRawTool(name, args);
  throw new Error(`Tool não encontrada: ${name}`);
}
