import type { KeeperHubClient } from "./keeperhub";
import type { KeeperHubWorkflow, ValidateWorkflowResult } from "./types";

export interface DryRunReport {
  workflowId: string;
  validation: ValidateWorkflowResult;
  /** True only when validate_workflow reports no structural/Web3 errors. Warnings don't block. */
  safeToExecute: boolean;
}

/**
 * Preflight, matching the real KeeperHub tool contract:
 *
 *   create_workflow(enabled: false) -> validate_workflow(workflowId, deepCheck: true)
 *
 * execute_protocol_action has no `simulate` field (unlike execute_transfer /
 * execute_contract_call), so there is no wouldRevert preflight for the
 * withdraw/supply legs themselves. validate_workflow(deepCheck) -- structural
 * checks plus best-effort ABI bytecode matching -- IS the preflight here;
 * runtime safety against a bad on-chain state falls to the check-threshold
 * and check-success condition nodes baked into the workflow graph.
 */
export async function dryRun(client: KeeperHubClient, workflow: KeeperHubWorkflow): Promise<DryRunReport> {
  const { workflowId } = await client.createWorkflow(workflow, { enabled: false });
  const validation = await client.validateWorkflow(workflowId, { deepCheck: true });

  return {
    workflowId,
    validation,
    safeToExecute: validation.valid,
  };
}

export function explainDryRunFailure(report: DryRunReport): string {
  if (report.validation.valid) {
    const warnings = report.validation.warnings ?? [];
    return warnings.length > 0
      ? `Dry run passed with ${warnings.length} warning(s): ${warnings.map((w) => w.message).join("; ")}`
      : "Dry run passed";
  }
  const errors = report.validation.errors ?? [];
  return `Workflow ${report.workflowId} failed validation: ${
    errors.map((e) => `${e.code} at ${e.parameterPath ?? "?"}: ${e.message}`).join("; ") || "unknown error"
  }`;
}
