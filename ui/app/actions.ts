"use server";

import { execFile } from "node:child_process";
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

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
