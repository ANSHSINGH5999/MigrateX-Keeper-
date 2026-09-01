import type {
  ExecutionResult,
  KeeperHubWorkflow,
  ValidateWorkflowResult,
} from "./types.js";

export interface KeeperHubClientConfig {
  /** MCP endpoint. Defaults to the hosted KeeperHub MCP server. */
  mcpUrl?: string;
  /** Bearer token from `kh auth login` / KEEPERHUB_API_KEY. */
  apiKey: string;
}

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolCallResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

/**
 * MCP client for the KeeperHub tools this orchestrator needs.
 * Talks JSON-RPC 2.0 over the MCP streamable-HTTP transport directly.
 *
 * The real server (confirmed by hand against https://app.keeperhub.com/mcp)
 * requires a stateful handshake before any tools/call:
 *   1. POST "initialize"            -> response carries an Mcp-Session-Id header
 *   2. POST "notifications/initialized", with that Mcp-Session-Id header
 *   3. every subsequent POST must carry the same Mcp-Session-Id header
 * Tool results are not raw JSON -- they arrive as
 * { content: [{ type: "text", text: "<json-or-prose string>" }] }, so every
 * typed call below JSON.parses content[0].text rather than trusting `result`
 * directly.
 */
export class KeeperHubClient {
  private readonly mcpUrl: string;
  private readonly apiKey: string;
  private nextId = 1;
  private sessionId: string | null = null;
  private sessionReady: Promise<void> | null = null;

  constructor(config: KeeperHubClientConfig) {
    this.mcpUrl = config.mcpUrl ?? "https://app.keeperhub.com/mcp";
    this.apiKey = config.apiKey;
  }

  private async ensureSession(): Promise<void> {
    if (this.sessionId) return;
    if (!this.sessionReady) {
      this.sessionReady = this.initSession();
    }
    await this.sessionReady;
  }

  private async initSession(): Promise<void> {
    const initRes = await fetch(this.mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.nextId++,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "migratex-orchestrator", version: "0.1.0" },
        },
      }),
    });

    if (!initRes.ok) {
      throw new Error(`KeeperHub MCP initialize failed: HTTP ${initRes.status}: ${await initRes.text()}`);
    }

    const sessionId = initRes.headers.get("mcp-session-id");
    if (!sessionId) {
      throw new Error("KeeperHub MCP initialize response did not include an Mcp-Session-Id header");
    }
    this.sessionId = sessionId;

    const notifyRes = await fetch(this.mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${this.apiKey}`,
        "Mcp-Session-Id": sessionId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
    });

    if (!notifyRes.ok && notifyRes.status !== 202) {
      throw new Error(
        `KeeperHub MCP notifications/initialized failed: HTTP ${notifyRes.status}: ${await notifyRes.text()}`
      );
    }
  }

  private async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    await this.ensureSession();

    const id = this.nextId++;
    const res = await fetch(this.mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${this.apiKey}`,
        "Mcp-Session-Id": this.sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });

    if (!res.ok) {
      throw new Error(`KeeperHub MCP HTTP ${res.status} calling '${name}': ${await res.text()}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    const payload = contentType.includes("text/event-stream")
      ? parseSseJsonRpc<ToolCallResult>(raw)
      : (JSON.parse(raw) as JsonRpcResponse<ToolCallResult>);

    if (payload.error) {
      throw new Error(`KeeperHub MCP error ${payload.error.code} calling '${name}': ${payload.error.message}`);
    }
    if (!payload.result) {
      throw new Error(`KeeperHub MCP returned no result for tool '${name}'`);
    }

    return unwrapToolResult<T>(name, payload.result);
  }

  /** create_workflow -> disabled by default; caller decides enabled. */
  async createWorkflow(
    workflow: KeeperHubWorkflow,
    options: { enabled: boolean }
  ): Promise<{ workflowId: string }> {
    const raw = await this.callTool<Record<string, unknown>>("create_workflow", {
      name: workflow.name,
      description: workflow.description,
      nodes: workflow.nodes,
      edges: workflow.edges,
      enabled: options.enabled,
    });
    const workflowId = (raw.workflowId ?? raw.id) as string | undefined;
    if (!workflowId) {
      throw new Error(`create_workflow response had neither 'workflowId' nor 'id': ${JSON.stringify(raw)}`);
    }
    return { workflowId };
  }

  /**
   * validate_workflow operates on an ALREADY-CREATED workflow, by id -- there
   * is no draft-JSON validation. Its result is double-wrapped as
   * `{ ok: true, result: { valid, nodeCount, errors?, warnings? } }`
   * (documented in the tool's own schema, unlike every other tool used
   * here) -- confirmed empirically: an unwrapped read silently saw
   * `valid: undefined` (falsy) on a workflow that was actually valid.
   */
  async validateWorkflow(workflowId: string, options: { deepCheck?: boolean } = {}): Promise<ValidateWorkflowResult> {
    const envelope = await this.callTool<{ ok: boolean; result: ValidateWorkflowResult }>("validate_workflow", {
      workflowId,
      deepCheck: options.deepCheck ?? false,
    });
    return envelope.result;
  }

  async executeWorkflow(
    workflowId: string,
    idempotencyKey?: string
  ): Promise<{ executionId: string; status: string }> {
    return this.callTool("execute_workflow", {
      workflowId,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    });
  }

  async getExecution(executionId: string): Promise<ExecutionResult> {
    return this.callTool("get_execution", { executionId });
  }
}

/** Streamable-HTTP MCP responses may arrive as SSE frames; take the last `data:` JSON-RPC message. */
function parseSseJsonRpc<T>(raw: string): JsonRpcResponse<T> {
  const dataLines = raw
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter(Boolean);

  if (dataLines.length === 0) {
    throw new Error(`No SSE data frames in KeeperHub MCP response: ${raw.slice(0, 200)}`);
  }
  return JSON.parse(dataLines[dataLines.length - 1]!) as JsonRpcResponse<T>;
}

/** Every observed tools/call result is `{ content: [{ type: "text", text: "<json>" }] }`. */
function unwrapToolResult<T>(toolName: string, result: ToolCallResult): T {
  const text = result.content.find((c) => c.type === "text")?.text;
  if (text === undefined) {
    throw new Error(`KeeperHub MCP tool '${toolName}' returned no text content: ${JSON.stringify(result)}`);
  }
  if (result.isError) {
    throw new Error(`KeeperHub MCP tool '${toolName}' returned an error: ${text}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    // A handful of tools (e.g. tools_documentation) return prose, not JSON.
    return text as unknown as T;
  }
}
