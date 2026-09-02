import type { Plugin } from "@elizaos/core";
import { runKeeperHubWorkflowAction } from "./keeperhub-action";

/**
 * The MigrateX/KeeperHub integration surface: one real action, backed by
 * the same KeeperHubClient (src/lib/keeperhub.ts) the orchestrator CLI and
 * the Next.js UI both use -- not a reimplementation, a copy of the exact
 * client that has executed real Sepolia transactions this whole project
 * long.
 */
export const migratexPlugin: Plugin = {
  name: "migratex-keeperhub",
  description: "Runs pre-built MigrateX Aave V3 workflows on the real KeeperHub MCP server.",
  actions: [runKeeperHubWorkflowAction],
};
