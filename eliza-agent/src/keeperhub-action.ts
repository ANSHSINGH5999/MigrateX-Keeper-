import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Action, ActionResult, Handler, Validator } from "@elizaos/core";

import { KeeperHubClient } from "./lib/keeperhub";
import { pollUntilTerminal, summarizeAuditTrail, extractTransactionHashes } from "./lib/audit";

const here = path.dirname(fileURLToPath(import.meta.url));

interface WorkflowRegistry {
  basic: string;
  scheduled: string;
  guardian: string;
  advanced: string;
  emergency: string;
  features: Record<string, string>;
  leverage: Record<string, string>;
  integrations: Record<string, string>;
}

function loadRegistry(): WorkflowRegistry {
  const registryPath = path.join(here, "..", "..", "orchestrator", "workflows.json");
  return JSON.parse(readFileSync(registryPath, "utf8")) as WorkflowRegistry;
}

function resolveWorkflowId(registry: WorkflowRegistry, name: string): string | null {
  if (name === "scheduled" || name === "guardian" || name === "advanced" || name === "emergency") {
    return registry[name];
  }
  return registry.features[name] ?? registry.leverage[name] ?? registry.integrations[name] ?? null;
}

/**
 * Every workflow name this action will accept, and which ones are safe to
 * run unattended (pure reads, zero fund risk) vs. ones that move real
 * funds or open real debt and should only run when explicitly named.
 */
const READ_ONLY_WORKFLOWS = new Set([
  "health-factor-monitor",
  "debt-position-monitor",
  "multi-asset-balance-snapshot",
  "gas-buffer-guardian",
  "full-position-report",
  "chainlink-eth-price-monitor",
  "oracle-cross-check",
  "canonical-weth-balance-check",
  "lido-position-check",
  "uniswap-lp-position-count",
  "morpho-authorization-check",
  "position-value-aggregator",
]);

let cachedClient: KeeperHubClient | null = null;
function getClient(): KeeperHubClient {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey) {
    throw new Error("KEEPERHUB_API_KEY is not set. Add it to eliza-agent/.env before running the agent.");
  }
  if (!cachedClient) {
    cachedClient = new KeeperHubClient({ apiKey, mcpUrl: process.env.KEEPERHUB_MCP_URL });
  }
  return cachedClient;
}

/** Pulls a known workflow name out of free text, e.g. "run health-factor-monitor" or "check my Aave health". */
function extractWorkflowName(text: string, registry: WorkflowRegistry): string | null {
  const lower = text.toLowerCase();
  const known = [
    "scheduled", "guardian", "advanced", "emergency",
    ...Object.keys(registry.features), ...Object.keys(registry.leverage), ...Object.keys(registry.integrations),
  ];
  for (const name of known) {
    if (lower.includes(name)) return name;
  }
  if (lower.includes("health") || lower.includes("position")) return "health-factor-monitor";
  return null;
}

const validate: Validator = async (_runtime, message) => {
  const text = message.content.text ?? "";
  return /keeperhub|migratex|aave|workflow/i.test(text);
};

const handler: Handler = async (_runtime, message, _state, _options, callback) => {
  const text = message.content.text ?? "";
  const registry = loadRegistry();
  const name = extractWorkflowName(text, registry);

  if (!name) {
    const result: ActionResult = { success: false, error: "Could not identify a known MigrateX/KeeperHub workflow name in the message." };
    if (callback) await callback({ text: result.error as string });
    return result;
  }

  const workflowId = resolveWorkflowId(registry, name);
  if (!workflowId) {
    const result: ActionResult = { success: false, error: `Unknown workflow '${name}'.` };
    if (callback) await callback({ text: result.error as string });
    return result;
  }

  const client = getClient();
  const validation = await client.validateWorkflow(workflowId, { deepCheck: true });
  if (!validation.valid) {
    const result: ActionResult = {
      success: false,
      error: `Workflow '${name}' (${workflowId}) failed validation: ${JSON.stringify(validation.errors)}`,
    };
    if (callback) await callback({ text: result.error as string });
    return result;
  }

  // Real funds/debt-moving workflows only run when the message names them
  // explicitly -- extractWorkflowName already requires an exact name match
  // for anything outside the read-only set, so this is a second, explicit
  // gate rather than a silent default.
  if (!READ_ONLY_WORKFLOWS.has(name) && !text.toLowerCase().includes(name)) {
    const result: ActionResult = {
      success: false,
      error: `'${name}' moves real funds or opens real debt -- refusing to run it without the exact workflow name in the message.`,
    };
    if (callback) await callback({ text: result.error as string });
    return result;
  }

  const { executionId } = await client.executeWorkflow(workflowId, `eliza-${name}-${Date.now()}`);
  const execResult = await pollUntilTerminal(client, executionId, { timeoutMs: 60_000 });
  const summary = summarizeAuditTrail(execResult);
  const txs = extractTransactionHashes(execResult);

  const responseText = [
    `Ran KeeperHub workflow '${name}' (${workflowId}).`,
    `Execution ${executionId}: ${execResult.status.status}`,
    summary,
    txs.length > 0 ? `Transaction hash(es): ${txs.map((t) => t.hash).join(", ")}` : null,
  ].filter(Boolean).join("\n");

  const result: ActionResult = {
    success: execResult.status.status === "success",
    text: responseText,
    data: { workflowId, executionId, status: execResult.status.status, transactions: txs },
  };
  if (callback) await callback({ text: responseText });
  return result;
};

export const runKeeperHubWorkflowAction: Action = {
  name: "RUN_KEEPERHUB_WORKFLOW",
  similes: ["EXECUTE_KEEPERHUB_WORKFLOW", "RUN_MIGRATEX_WORKFLOW", "TRIGGER_KEEPERHUB", "CHECK_AAVE_POSITION"],
  description:
    "Runs a pre-built, already-validated MigrateX workflow on the real KeeperHub MCP server, by name (from orchestrator/workflows.json). Use when asked to check, monitor, or act on an Aave V3 position via KeeperHub -- e.g. 'run health-factor-monitor' or 'check my Aave health via keeperhub'.",
  validate,
  handler,
  examples: [
    [
      { name: "user", content: { text: "Check my Aave position health via KeeperHub." } },
      { name: "agent", content: { text: "Running health-factor-monitor on KeeperHub...", actions: ["RUN_KEEPERHUB_WORKFLOW"] } },
    ],
  ],
};
