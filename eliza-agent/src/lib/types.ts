/** Output shape of `p-token-migrator --output-plan`. */
export interface MigrationPlan {
  source_protocol: string;
  target_protocol: string;
  token: string;
  amount: string;
  network: string;
  source_address: string;
  recipient_address: string;
  threshold: string;
  min_expected_target_amount: string;
  slippage_bps: number;
}

/**
 * Real KeeperHub workflow node shape, confirmed against live templates
 * (search_templates) -- NOT the {id, name, type, params} shape a first
 * reading of create_workflow's loose {"additionalProperties": {}} schema
 * suggests. create_workflow accepts arbitrary objects there without
 * complaint, but silently drops anything that doesn't match this exact
 * shape (config end up empty, edges end up {}), which is what caused a
 * real workflow to run only its trigger node and nothing else.
 */
export interface WorkflowNode {
  id: string;
  /** Generic role: "trigger" or "action" (Condition nodes are `type: "action"` too). */
  type: "trigger" | "action";
  position: { x: number; y: number };
  data: {
    type: "trigger" | "action";
    /** For trigger nodes: { triggerType }. For action nodes: { actionType, ...flat action-specific fields }. */
    config: Record<string, unknown>;
  };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  /** Required on edges leaving a Condition node ("true" | "false"); Condition is a BRANCH action. */
  sourceHandle?: "true" | "false";
}

export interface KeeperHubWorkflow {
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface ValidateWorkflowResult {
  valid: boolean;
  nodeCount: number;
  errors?: Array<{ code: string; message: string; parameterPath?: string }>;
  warnings?: Array<{ code: string; message: string; parameterPath?: string }>;
}

/** Terminal execution statuses per list_executions' documented enum. */
export type TerminalExecutionStatus = "success" | "error" | "system_error" | "external_error" | "cancelled";
export type ExecutionStatusValue = "pending" | "running" | TerminalExecutionStatus;

export interface TransactionReceipt {
  hash: string;
  verified?: boolean;
  receiptStatus?: "success" | "reverted";
  blockNumber?: number;
  gasUsed?: string;
}

export interface NodeStatusEntry {
  nodeId: string;
  status: string;
}

/**
 * Real get_execution response shape, confirmed empirically -- `status` is
 * an OBJECT (not a bare string as its own field name misleadingly
 * suggests), and `logs` is a single execution summary object, not an
 * array of per-node entries.
 */
export interface ExecutionResult {
  status: {
    status: ExecutionStatusValue;
    nodeStatuses: NodeStatusEntry[];
    progress: {
      totalSteps: number;
      completedSteps: number;
      runningSteps: number;
      currentNodeId: string | null;
      currentNodeName: string | null;
      percentage: number;
    };
    errorContext: unknown | null;
    transactionHashes: TransactionReceipt[];
  };
  logs: {
    execution: {
      id: string;
      workflowId: string;
      status: ExecutionStatusValue;
      error: unknown | null;
      errorCategory: string | null;
      errorType: string | null;
      errorCode: string | null;
      startedAt: string;
      completedAt: string | null;
      duration: string;
      totalSteps: string;
      completedSteps: string;
      lastSuccessfulNodeId: string | null;
      lastSuccessfulNodeName: string | null;
      executionTrace: string[];
      transactionHashes: TransactionReceipt[];
      gasUsedWei: string | null;
      [key: string]: unknown;
    };
  } | null;
}
