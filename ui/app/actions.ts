"use server";

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

import { KeeperHubClient } from "../lib/keeperhub";
import { buildMigrationWorkflow } from "../lib/workflow-builder";
import { dryRun, explainDryRunFailure } from "../lib/dry-run";
import { pollUntilTerminal, summarizeAuditTrail, extractTransactionHashes } from "../lib/audit";
import type { MigrationPlan } from "../lib/types";

const execFileAsync = promisify(execFile);

// Aave V3's real Sepolia WETH reserve, confirmed live via getReservesList()/
// getReserveData() against the Pool at 0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951
// (~12,209 WETH liquidity, 49/50 of its most recent txs succeeding).
// Morpho and Aave V4 were both ruled out by live on-chain verification --
// see rust-core/src/main.rs and orchestrator/src/workflow-builder.ts.

export interface PlanInput {
  amount: string;
  sourceAddress: string;
  recipientAddress: string;
}

export type PlanResult = { ok: true; plan: MigrationPlan } | { ok: false; error: string };

export async function generatePlan(input: PlanInput): Promise<PlanResult> {
  try {
    const bin = path.join(process.cwd(), "..", "rust-core", "target", "debug", "p-token-migrator");
    const { stdout } = await execFileAsync(bin, [
      "--source-protocol", "aave-v3",
      "--target-protocol", "aave-v3",
      "--token", "WETH",
      "--amount", input.amount,
      "--network", "11155111",
      "--source-address", input.sourceAddress,
      "--recipient-address", input.recipientAddress,
      "--output-plan",
    ]);
    return { ok: true, plan: JSON.parse(stdout) as MigrationPlan };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

let cachedClient: KeeperHubClient | null = null;
function getClient(): KeeperHubClient {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey) {
    throw new Error("KEEPERHUB_API_KEY is not set on the server. Add it to ui/.env.local and restart the dev server.");
  }
  if (!cachedClient) {
    cachedClient = new KeeperHubClient({ apiKey, mcpUrl: process.env.KEEPERHUB_MCP_URL });
  }
  return cachedClient;
}

export type DryRunResult =
  | { ok: true; workflowId: string; safeToExecute: boolean; message: string; validation: unknown }
  | { ok: false; error: string };

export async function runDryRun(plan: MigrationPlan): Promise<DryRunResult> {
  try {
    const workflow = buildMigrationWorkflow(plan);
    const report = await dryRun(getClient(), workflow);
    return {
      ok: true,
      workflowId: report.workflowId,
      safeToExecute: report.safeToExecute,
      message: explainDryRunFailure(report),
      validation: report.validation,
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

export type ExecutionUiResult =
  | { ok: true; executionId: string; status: string; summary: string; transactions: { hash: string }[] }
  | { ok: false; error: string };

export async function runExecution(workflowId: string): Promise<ExecutionUiResult> {
  try {
    const client = getClient();
    const { executionId } = await client.executeWorkflow(workflowId);
    const result = await pollUntilTerminal(client, executionId, { timeoutMs: 60_000 });
    return {
      ok: true,
      executionId,
      status: result.status.status,
      summary: summarizeAuditTrail(result),
      transactions: extractTransactionHashes(result),
    };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

interface WorkflowRegistryFile {
  basic: string;
  scheduled: string;
  guardian: string;
  advanced: string;
  emergency: string;
  features: Record<string, string>;
  leverage: Record<string, string>;
  integrations: Record<string, string>;
}

export interface CatalogEntry {
  key: string;
  category: "core" | "feature" | "leverage" | "integration";
  workflowId: string;
}

/**
 * Reads the same orchestrator/workflows.json the CLI's --workflow/--feature
 * flags read -- one registry, two front ends (CLI and this catalog), never
 * duplicated. "basic" is intentionally excluded: it's built fresh per plan
 * (see generatePlan/runDryRun above), not a fixed pre-created id like the
 * other 37.
 */
export async function listWorkflowCatalog(): Promise<CatalogEntry[]> {
  const registryPath = path.join(process.cwd(), "..", "orchestrator", "workflows.json");
  const raw = await readFile(registryPath, "utf8");
  const registry = JSON.parse(raw) as WorkflowRegistryFile;

  const entries: CatalogEntry[] = [
    { key: "scheduled", category: "core", workflowId: registry.scheduled },
    { key: "guardian", category: "core", workflowId: registry.guardian },
    { key: "advanced", category: "core", workflowId: registry.advanced },
    { key: "emergency", category: "core", workflowId: registry.emergency },
  ];
  for (const [key, workflowId] of Object.entries(registry.features)) entries.push({ key, category: "feature", workflowId });
  for (const [key, workflowId] of Object.entries(registry.leverage)) entries.push({ key, category: "leverage", workflowId });
  for (const [key, workflowId] of Object.entries(registry.integrations)) entries.push({ key, category: "integration", workflowId });
  return entries;
}

export type ValidateResult =
  | { ok: true; valid: boolean; nodeCount: number; errors: unknown; warnings: unknown }
  | { ok: false; error: string };

/** Validates any workflow by id -- deepCheck against the live server, same as `node dist/index.js --feature <name>` without --execute. */
export async function validateWorkflowById(workflowId: string): Promise<ValidateResult> {
  try {
    const validation = await getClient().validateWorkflow(workflowId, { deepCheck: true });
    return { ok: true, valid: validation.valid, nodeCount: validation.nodeCount, errors: validation.errors ?? null, warnings: validation.warnings ?? null };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
