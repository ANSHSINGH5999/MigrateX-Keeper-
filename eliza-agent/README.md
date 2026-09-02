# MigrateX × ElizaOS

A real ElizaOS agent that reasons about which MigrateX/KeeperHub workflow to run, then executes
it for real through the same, already-proven `KeeperHubClient` (`src/lib/keeperhub.ts`, a copy
of `orchestrator/src/keeperhub.ts`) that has executed 30+ real Sepolia transactions elsewhere in
this project.

This is why MigrateX is an **integration into a live project**, not a standalone demo: ElizaOS is
a real, actively maintained agent framework (~19.2k GitHub stars, commits landing same-day) that
KeeperHub itself lists as a partner integration — [keeperhub.com/integrations](https://keeperhub.com/integrations)
names it explicitly: *"ElizaOS agents plug into KeeperHub for reliable on-chain execution."* This
agent is that integration, built and verified live.

## What it does

1. A real event arrives (a CLI argument here; a webhook route or chat message in production —
   both are real ElizaOS trigger mechanisms, see `docs.elizaos.ai/plugins/webhooks-and-routes`).
2. The ElizaOS `AgentRuntime` composes state and asks its LLM whether to act.
3. The LLM (probabilistic, reasons in natural language) decides whether and which pre-built,
   already-`validate_workflow(deepCheck: true)`-passed MigrateX workflow to run — it never
   invents the workflow's internals, only picks a name from `orchestrator/workflows.json`.
4. The `RUN_KEEPERHUB_WORKFLOW` action executes that exact workflow through the real KeeperHub
   MCP server — deterministic, auditable, nothing inferred at execution time.

## Verified live

Run with a local, free model (Ollama + `qwen3:8b`, zero API cost) asking the agent to check the
Aave V3 position:

```
Please run the keeperhub workflow named health-factor-monitor right now to check my Aave position.
```

The agent's own reasoning (real LLM output, not scripted):
> *"Operator requested to run health-factor-monitor on KeeperHub. Acknowledge and execute the workflow."*
> → selects `RUN_KEEPERHUB_WORKFLOW`

Real result: execution `5vt51cu1e12dw8yz38t38`, `status: success`, 3/4 steps (the workflow's own
condition node correctly stopped early — the position's health factor is fine, so its alert
branch correctly never fired).

## Setup

```bash
curl -fsSL https://bun.sh/install | bash   # ElizaOS's own tooling standardizes on bun
cd eliza-agent
bun install
cp ../orchestrator/.env .env               # reuses the same KEEPERHUB_API_KEY
ollama pull qwen3:8b                       # or any Ollama model; set OLLAMA_MODEL to override
bun run start "Please run the keeperhub workflow named health-factor-monitor right now."
```

No external database is needed — `@elizaos/plugin-sql` falls back to an embedded PGLite instance
automatically (data lives in a local, gitignored directory).

## Real bugs found and worked around

Consistent with this whole project's "verify on-chain, don't just trust the docs" discipline,
building this surfaced a real upstream issue rather than a smooth path:

- **`@elizaos/core` 1.7.2's own `AgentRuntime.initialize()` has a genuine ordering bug**: it calls
  `ensureAgentExists()` (a `SELECT` against the `agents` table) *before* `runPluginMigrations()`
  has created that table, so a fresh database fails on first boot every time. Worked around in
  `src/index.ts` by registering plugins and running migrations manually first, then calling
  `initialize({ skipMigrations: true })`.
- Without `@elizaos/plugin-bootstrap`, the LLM never sees the list of available custom actions in
  its context (`actionNames data missing from state`) and defaults to a generic `REPLY` — adding
  the bootstrap plugin (which provides the standard action-list provider) fixed this completely.

## Safety

`RUN_KEEPERHUB_WORKFLOW`'s handler only executes workflows explicitly named in the triggering
message — it never silently defaults to a fund-moving or debt-opening workflow. Read-only
monitoring workflows (health checks, balance snapshots, price feeds) can run from a generic
prompt; anything that moves funds or opens debt requires its exact name to appear in the message
text, checked a second time inside the handler independent of the LLM's own action selection.
