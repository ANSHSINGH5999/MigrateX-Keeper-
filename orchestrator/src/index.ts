#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { KeeperHubClient } from "./keeperhub.js";
import { buildMigrationWorkflow } from "./workflow-builder.js";
import { dryRun, explainDryRunFailure } from "./dry-run.js";
import { pollUntilTerminal, summarizeAuditTrail, extractTransactionHashes } from "./audit.js";
import type { MigrationPlan } from "./types.js";

type WorkflowKind = "basic" | "scheduled" | "guardian" | "advanced" | "emergency";
const WORKFLOW_KINDS: WorkflowKind[] = ["basic", "scheduled", "guardian", "advanced", "emergency"];

interface Cli {
  planFile?: string;
  rustBin?: string;
  execute: boolean;
  workflowKind: WorkflowKind;
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = { execute: false, workflowKind: "advanced" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--plan") cli.planFile = argv[++i];
    else if (arg === "--rust-bin") cli.rustBin = argv[++i];
    else if (arg === "--execute") cli.execute = true;
    else if (arg === "--workflow") {
      const kind = argv[++i] as WorkflowKind;
      if (!WORKFLOW_KINDS.includes(kind)) {
        throw new Error(`--workflow must be one of ${WORKFLOW_KINDS.join(", ")}; got '${kind}'`);
      }
      cli.workflowKind = kind;
    }
  }
  return cli;
}

/**
 * scheduled/guardian/advanced are pre-created, persistent automations
 * (built once via workflow-builder.ts and registered in workflows.json) --
 * unlike "basic" they don't come from a per-run MigrationPlan, so running
 * the CLI against them validates + optionally executes the SAME workflow
 * every time rather than creating a new one.
 */
function loadWorkflowId(kind: Exclude<WorkflowKind, "basic">): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const registryPath = path.join(here, "..", "workflows.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Record<string, string>;
  const id = registry[kind];
  if (!id) {
    throw new Error(`No workflow id for '${kind}' in ${registryPath}`);
  }
  return id;
}

/** Loads a plan either from a pre-computed JSON file or by shelling out to the Rust policy core. */
function loadPlan(cli: Cli): MigrationPlan {
  if (cli.planFile) {
    return JSON.parse(readFileSync(cli.planFile, "utf8")) as MigrationPlan;
  }
  if (cli.rustBin) {
    const out = execFileSync(cli.rustBin, ["--output-plan"], { encoding: "utf8" });
    return JSON.parse(out) as MigrationPlan;
  }
  throw new Error("Pass --plan <file.json> or --rust-bin <path to p-token-migrator invocation>");
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));

  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey) {
    throw new Error(
      "KEEPERHUB_API_KEY is not set. Run `kh auth login`, then export the token (see README) before running the orchestrator."
    );
  }
  const client = new KeeperHubClient({
    apiKey,
    mcpUrl: process.env.KEEPERHUB_MCP_URL,
  });

  console.log(`Workflow: ${cli.workflowKind}`);

  let workflowId: string;

  if (cli.workflowKind === "basic") {
    const plan = loadPlan(cli);
    console.log(`Plan: migrate ${plan.amount} ${plan.token} ${plan.source_protocol} -> ${plan.target_protocol} (chain ${plan.network})`);

    const workflow = buildMigrationWorkflow(plan);
    console.log(`Built workflow '${workflow.name}' with ${workflow.nodes.length} nodes.`);

    console.log("Running dry-run (create_workflow disabled + validate_workflow deepCheck)...");
    const report = await dryRun(client, workflow);
    console.log(`Workflow created: ${report.workflowId}`);
    console.log(explainDryRunFailure(report));

    if (!report.safeToExecute) {
      console.error("Dry run failed — refusing to execute. See message above.");
      process.exitCode = 1;
      return;
    }
    workflowId = report.workflowId;
  } else {
    workflowId = loadWorkflowId(cli.workflowKind);
    console.log(`Validating pre-created workflow ${workflowId} (deepCheck)...`);
    const validation = await client.validateWorkflow(workflowId, { deepCheck: true });
    console.log(JSON.stringify(validation, null, 2));
    if (!validation.valid) {
      console.error("Validation failed — refusing to execute. See errors above.");
      process.exitCode = 1;
      return;
    }
  }

  if (!cli.execute) {
    console.log("Dry run / validation passed. Re-run with --execute to run this workflow on KeeperHub.");
    return;
  }

  const idempotencyKey = randomUUID();
  const { executionId } = await executeWithColdStartRetry(client, workflowId, idempotencyKey);
  console.log(`Execution started: ${executionId}`);

  const result = await pollUntilTerminal(client, executionId, {
    onTick: (r) => console.log(`  ...status: ${r.status}`),
  });

  console.log("\nAudit trail:");
  console.log(summarizeAuditTrail(result));

  const txs = extractTransactionHashes(result);
  if (txs.length > 0) {
    console.log(`\nTransaction hash(es): ${txs.map((t) => t.hash).join(", ")}`);
  }

  const finalStatus = result.status.status;
  if (finalStatus !== "success") {
    console.error(`Execution did not complete successfully (status: ${finalStatus}) — see logs above.`);
    process.exitCode = 1;
  }
}

/**
 * KeeperHub's upstream execution layer can cold-start; on that specific
 * error we retry the same call with the same idempotency key after the
 * server-suggested delay, rather than surfacing a spurious failure.
 * NOTE: the exact cold-start error shape hasn't been observed against the
 * live server yet (this session's key is read-scoped) -- this is a
 * best-effort match on the documented `upstream_cold_start` code pending
 * a real write-scoped test.
 */
async function executeWithColdStartRetry(
  client: KeeperHubClient,
  workflowId: string,
  idempotencyKey: string,
  attemptsLeft = 3
): Promise<{ executionId: string }> {
  try {
    return await client.executeWorkflow(workflowId, idempotencyKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (attemptsLeft > 0 && message.includes("upstream_cold_start")) {
      const retryAfterMatch = message.match(/retryAfterSeconds[":\s]+(\d+)/);
      const retryAfterSeconds = retryAfterMatch ? Number(retryAfterMatch[1]) : 5;
      console.log(`Upstream cold start; retrying execute_workflow in ${retryAfterSeconds}s (idempotencyKey=${idempotencyKey})...`);
      await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
      return executeWithColdStartRetry(client, workflowId, idempotencyKey, attemptsLeft - 1);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
