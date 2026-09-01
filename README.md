# MigrateX

Deterministic token migration orchestrator for the KeeperHub Hackathon (Sep 6–18, 2026).

MigrateX takes a live DeFi migration scenario (Aave V3 → V4, Morpho market migration, or
Uniswap V3 → V4 LP migration) and makes **KeeperHub the only execution layer**. A Rust policy
core computes a deterministic migration plan; a TypeScript orchestrator turns that plan into a
KeeperHub workflow, dry-runs it, and only then executes it. No agent improvises at execution
time — the user reviews exactly the workflow that runs.

## Architecture

```
rust-core/        p-token-migrator: validates the migration pair, computes amounts and
                   slippage-adjusted verification thresholds, emits a MigrationPlan as JSON.

orchestrator/      TypeScript. Reads a MigrationPlan and:
  workflow-builder.ts   builds the 7-node KeeperHub workflow from the plan (agent-authored,
                         not a template)
  keeperhub.ts           minimal MCP client (JSON-RPC over the KeeperHub MCP endpoint)
  dry-run.ts             validate_workflow + simulate withdraw/supply before any real execution
  audit.ts               polls get_execution until terminal, extracts transaction hashes
  index.ts                CLI entry wiring the above end to end, plus unhappy-path handling

ui/                optional Next.js viewer (plan / dry-run / execution / tx hash)
```

## Workflow graph

```
trigger-1 (manual)
  -> read-balance (web3/read-contract)
    -> check-threshold (condition: balance >= threshold)
      --true--> withdraw-source (execute_protocol_action: <source>/withdraw)
        -> supply-target (execute_protocol_action: <target>/supply)
          -> verify-balance (web3/check-token-balance)
            -> check-success (condition: destination balance >= min_expected_target_amount)
      --false-> abort (no outgoing edge)
```

## Setup

```bash
npm install -g @keeperhub/cli
kh auth login
kh wallet info   # confirm wallet is configured
kh chain list    # confirm Sepolia (11155111) or Base Sepolia (84532)

export KEEPERHUB_API_KEY=<token from kh auth login>
# export KEEPERHUB_MCP_URL=https://app.keeperhub.com/mcp   # default, override for local dev
```

## Running

```bash
# 1. Build the Rust policy core
cd rust-core && cargo build --release

# 2. Dry run only (no state created on KeeperHub)
cd ../orchestrator
npm install && npm run build
node dist/index.js --rust-bin ../rust-core/target/release/p-token-migrator

# 3. Full run: create + execute the workflow, poll for the audit trail
node dist/index.js --rust-bin ../rust-core/target/release/p-token-migrator --execute
```

You can also hand it a pre-computed plan file instead of shelling out to Rust:

```bash
../rust-core/target/release/p-token-migrator \
  --source-protocol aave-v3 --target-protocol aave-v4 --token USDC --amount 100 \
  --network 11155111 \
  --source-address 0xYourAddress --recipient-address 0xYourAddress \
  --output-plan > plan.json

node dist/index.js --plan plan.json --execute
```

## Unhappy paths handled

- `insufficient_balance` from the source protocol read — surfaced with the required minimum.
- `wouldRevert: true` on either simulated leg (withdraw or supply) — halts before any
  `create_workflow`/`execute_workflow` call, with the revert reason printed.
- `upstream_cold_start` on `execute_workflow` — retried with the same idempotency key after
  the server-suggested delay (see `executeWithColdStartRetry` in `orchestrator/src/index.ts`).
- Execution reaching `status: failed` — logs are pulled from `get_execution` and surfaced
  alongside the partial audit trail (whatever transaction hashes did land).

## Status

- [x] Rust policy core (`p-token-migrator --output-plan`) with pair/address/amount validation
      and unit tests.
- [x] TypeScript workflow builder producing the exact 7-node graph above from a plan.
- [x] KeeperHub MCP client, dry-run flow, audit polling — implemented against the documented
      tool surface (`validate_workflow`, `execute_protocol_action` with `simulate`,
      `create_workflow`, `execute_workflow`, `get_execution`).
- [ ] KeeperHub account authenticated, wallet connected, testnet chain confirmed.
- [ ] First real dry-run / execution against the live KeeperHub MCP server (blocked on the
      above — the tool surface above has not yet been exercised against production, only
      typechecked and unit tested locally).
- [ ] `ui/` Next.js viewer.
- [ ] Demo video, bounty PR (`web3/batch-token-check` using multicall3).

## Bounty track

Planned PR to `keeperhub/keeperhub`: new node `web3/batch-token-check`, batching multiple
balance reads into one multicall3 call. Migration workflows always check source *and*
destination balance (nodes `read-balance` and `verify-balance` above) — one batched node
replaces two `web3/check-token-balance` nodes, cutting RPC round trips per execution.
