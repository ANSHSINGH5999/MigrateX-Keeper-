// Copy of orchestrator/src/audit.ts -- Turbopack won't resolve imports outside ui/'s project root, so this is duplicated rather than shared.
import type { KeeperHubClient } from "./keeperhub";
import type { ExecutionResult, TransactionReceipt } from "./types";

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  onTick?: (result: ExecutionResult) => void;
}

/** Real terminal statuses, from list_executions' documented status enum. */
const TERMINAL_STATUSES = new Set(["success", "error", "system_error", "external_error", "cancelled"]);

/**
 * Polls get_execution until the workflow reaches a terminal status,
 * building the audit trail (transaction hashes, logs) as it goes.
 *
 * get_execution's `status` field is an OBJECT (`{ status, nodeStatuses,
 * progress, transactionHashes, ... }`), not a bare string -- comparing
 * the object itself against a string Set never matches, which is exactly
 * what caused a real execution to "time out" while it had actually
 * already finished successfully. Always read `result.status.status`.
 */
export async function pollUntilTerminal(
  client: KeeperHubClient,
  executionId: string,
  options: PollOptions = {}
): Promise<ExecutionResult> {
  const intervalMs = options.intervalMs ?? 3000;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const result = await client.getExecution(executionId);
    options.onTick?.(result);

    if (TERMINAL_STATUSES.has(result.status.status)) {
      return result;
    }

    if (Date.now() > deadline) {
      const final = await client.getExecution(executionId);
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for execution ${executionId} to reach a terminal status. ` +
          `Final status: ${JSON.stringify(final.status)}`
      );
    }

    await sleep(intervalMs);
  }
}

/** transactionHashes is duplicated at both `status.transactionHashes` and `logs.execution.transactionHashes`. */
export function extractTransactionHashes(result: ExecutionResult): TransactionReceipt[] {
  return result.status.transactionHashes ?? result.logs?.execution.transactionHashes ?? [];
}

export function summarizeAuditTrail(result: ExecutionResult): string {
  const s = result.status;
  const lines = [
    `Execution status: ${s.status} (${s.progress.completedSteps}/${s.progress.totalSteps} steps, ${s.progress.percentage}%)`,
  ];
  for (const ns of s.nodeStatuses) {
    lines.push(`  [${ns.nodeId}] ${ns.status}`);
  }
  for (const tx of extractTransactionHashes(result)) {
    lines.push(`  tx ${tx.hash}${tx.receiptStatus ? ` [${tx.receiptStatus}]` : ""}`);
  }
  if (s.errorContext) {
    lines.push(`  errorContext: ${JSON.stringify(s.errorContext)}`);
  }
  const execLog = result.logs?.execution;
  if (execLog?.error) {
    lines.push(`  error: ${JSON.stringify(execLog.error)}`);
  }
  if (execLog && execLog.completedSteps !== execLog.totalSteps) {
    lines.push(
      `  warning: only ${execLog.completedSteps}/${execLog.totalSteps} steps ran (stopped at ${execLog.lastSuccessfulNodeId ?? "?"})`
    );
  }
  return lines.join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
