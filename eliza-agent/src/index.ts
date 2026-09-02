import { AgentRuntime, DefaultMessageService, stringToUuid, ChannelType, type Memory } from "@elizaos/core";
import sqlPlugin from "@elizaos/plugin-sql";
import ollamaPlugin from "@elizaos/plugin-ollama";
import bootstrapPlugin from "@elizaos/plugin-bootstrap";

import { migratexPlugin } from "./plugin";
import { migratexCharacter } from "./character";
import { runKeeperHubWorkflowAction } from "./keeperhub-action";

/**
 * Real event this agent reacts to. In production this would be a webhook
 * route (see @elizaos/core's `Route`/`routes` plugin hook) or a chat
 * message from Discord/Telegram; for this demo it's a CLI argument so the
 * exact same code path is exercised without needing a live chat platform.
 */
const eventText = process.argv.slice(2).join(" ") || "MigrateX: Aave V3 health factor check requested via KeeperHub. Run health-factor-monitor.";

async function main() {
  console.log(`Event: "${eventText}"\n`);

  const runtime = new AgentRuntime({
    character: migratexCharacter,
    plugins: [sqlPlugin, ollamaPlugin, bootstrapPlugin, migratexPlugin],
    settings: {
      OLLAMA_API_ENDPOINT: process.env.OLLAMA_API_ENDPOINT ?? "http://localhost:11434",
      OLLAMA_SMALL_MODEL: process.env.OLLAMA_MODEL ?? "qwen3:8b",
      OLLAMA_LARGE_MODEL: process.env.OLLAMA_MODEL ?? "qwen3:8b",
      OLLAMA_EMBEDDING_MODEL: process.env.OLLAMA_EMBEDDING_MODEL ?? "qwen3:8b",
    },
  });

  console.log("Initializing runtime (embedded PGLite database, no external server)...");
  // @elizaos/core 1.7.2's own AgentRuntime.initialize() has a real ordering
  // bug: it calls ensureAgentExists() (a SELECT against the "agents"
  // table) BEFORE runPluginMigrations() has created that table, so a
  // fresh PGLite database always fails on first boot. Worked around by
  // registering plugins and running migrations ourselves first, then
  // calling initialize({ skipMigrations: true }) -- registerPlugin's own
  // "already registered, skipping" guard makes this safe to call twice.
  for (const plugin of [sqlPlugin, ollamaPlugin, bootstrapPlugin, migratexPlugin]) {
    await runtime.registerPlugin(plugin);
  }
  await runtime.runPluginMigrations();
  await runtime.initialize({ skipMigrations: true });
  runtime.messageService = new DefaultMessageService();
  console.log(`Runtime ready. agentId=${runtime.agentId}\n`);

  const worldId = stringToUuid("migratex-demo-world");
  const roomId = stringToUuid("migratex-demo-room");
  const entityId = stringToUuid("migratex-demo-user");

  await runtime.ensureWorldExists({ id: worldId, name: "MigrateX Demo", agentId: runtime.agentId });
  await runtime.ensureRoomExists({ id: roomId, name: "migratex-demo", source: "cli", type: ChannelType.API, worldId });
  await runtime.ensureConnection({
    entityId,
    roomId,
    worldId,
    userName: "operator",
    name: "Operator",
    source: "cli",
    type: ChannelType.API,
  });

  const message: Memory = {
    entityId,
    agentId: runtime.agentId,
    roomId,
    worldId,
    content: { text: eventText, source: "cli", channelType: ChannelType.API },
  };

  console.log("=== Full agent pipeline (LLM decides whether/which action to run) ===");
  try {
    const result = await runtime.messageService!.handleMessage(runtime, message, async (content) => {
      console.log(`[agent response] ${content.text ?? ""}`);
      return [];
    });
    console.log(`didRespond=${result.didRespond} mode=${result.mode}`);
    if (result.responseContent?.actions) {
      console.log(`actions selected by the LLM: ${result.responseContent.actions.join(", ")}`);
    }
  } catch (err) {
    console.log(`Full pipeline did not complete cleanly: ${err instanceof Error ? err.message : err}`);
    console.log("Falling through to direct action invocation below -- same Action object, called directly.");
  }

  console.log("\n=== Direct invocation of the real registered Action (guaranteed real KeeperHub call) ===");
  const isValid = await runKeeperHubWorkflowAction.validate(runtime, message);
  console.log(`validate() -> ${isValid}`);
  if (isValid) {
    const state = await runtime.composeState(message);
    const result = await runKeeperHubWorkflowAction.handler(runtime, message, state, {}, async (content) => {
      console.log(`[action response] ${content.text ?? ""}`);
      return [];
    });
    console.log("\nActionResult:", JSON.stringify(result, null, 2));
  }

  await runtime.stop();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exitCode = 1;
});
