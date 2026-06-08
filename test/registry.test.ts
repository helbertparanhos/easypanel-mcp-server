/**
 * Smoke test do registry de tools — garante a integridade do que o servidor
 * anuncia em `tools/list`, sem tocar a rede:
 *  - contagem esperada e nomes únicos
 *  - todo tool tem inputSchema do tipo object
 *  - o dispatcher rejeita tool desconhecida
 *
 * Rodar: `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { allTools, handleTool } from "../src/tools/index.js";

test("registry expõe 57 tools com nomes únicos", () => {
  assert.equal(allTools.length, 57);
  const names = allTools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, "há nomes de tool duplicados");
});

test("toda tool tem name não-vazio, description e inputSchema object", () => {
  for (const t of allTools) {
    assert.equal(typeof t.name, "string");
    assert.ok(t.name.length > 0, "name vazio");
    assert.ok(typeof t.description === "string" && t.description.length > 0, `sem description: ${t.name}`);
    assert.equal((t.inputSchema as { type?: string })?.type, "object", `inputSchema inválido: ${t.name}`);
  }
});

test("tools que exigem confirmação declaram o campo confirm no schema", () => {
  // Subconjunto de tools destrutivas conhecidas que pedem confirm: "CONFIRMO".
  const mustHaveConfirm = [
    "delete_project",
    "destroy_service",
    "stop_service",
    "rename_service",
    "delete_env_var",
    "destroy_database",
    "prune_docker",
    "reboot_server",
    "restart_panel",
  ];
  for (const name of mustHaveConfirm) {
    const tool = allTools.find((t) => t.name === name);
    assert.ok(tool, `tool destrutiva ausente do registry: ${name}`);
    const props = (tool!.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {};
    assert.ok("confirm" in props, `${name} deveria declarar o parâmetro confirm`);
  }
});

test("dispatcher rejeita tool desconhecida (sem tocar a rede)", async () => {
  await assert.rejects(() => handleTool("tool_que_nao_existe", {}), /não encontrada/i);
});
