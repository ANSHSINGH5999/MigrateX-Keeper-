# MigrateX

Deterministic token migration orchestrator for the KeeperHub Hackathon (Sep 6–18, 2026).

MigrateX makes **KeeperHub the only execution layer** for DeFi position management: a Rust
policy core computes a deterministic plan, a TypeScript orchestrator turns it into a KeeperHub
workflow, validates it (`validate_workflow` with `deepCheck: true`), and only then executes it
via the real KeeperHub MCP server. No agent improvises at execution time — every workflow is a
fixed, inspectable node graph, and every claim in this repo is backed by a live transaction hash
you can independently verify on Sepolia.

The project targets Aave V3 on Sepolia specifically because it was the only lending market found,
via live on-chain verification (not documentation), to actually work end to end on this testnet —
Aave V4 is mainnet-only in KeeperHub's plugin, and the one Sepolia Morpho Blue market this project
found had never had a market successfully created on it (every historical call reverted).

## Architecture

```
rust-core/         p-token-migrator: validates the migration pair, computes amounts and
                    slippage-adjusted verification thresholds, emits a MigrationPlan as JSON.

orchestrator/       TypeScript. Talks JSON-RPC directly to the KeeperHub MCP streamable-HTTP
                     endpoint (no SDK) and:
  workflow-builder.ts   builds all 4 workflow graphs below (agent-authored, not templates)
  keeperhub.ts           MCP client — session handshake, tools/call, response unwrapping
  dry-run.ts             create_workflow (disabled) + validate_workflow before any real run
  audit.ts               polls get_execution until terminal, extracts transaction hashes
  index.ts                CLI entry: --workflow {basic|scheduled|guardian|advanced} [--execute]
  workflows.json          registry of the 4 live, pre-created workflow IDs (below)

ui/                 Next.js app. Real Server Actions call the same Rust binary and
                     KeeperHubClient the CLI uses — no simulated/mocked data path.
```

## The 4 workflows

All 4 are real, created via `create_workflow` against the live KeeperHub MCP server and
confirmed `valid: true` via `validate_workflow(deepCheck: true)`.

| Kind | Workflow ID | Nodes | What it does |
|---|---|---|---|
| `basic` | `92r20hpg5rba6yp2s6j76` | 5 | Manual trigger. Withdraw → verify → supply → verify, within Aave V3 Sepolia. **Executed live** — see [Verified execution](#verified-execution) below. |
| `scheduled` | `6mfi90pptg2qtv5crmmf1` | 6 | Every 6h (`0 */6 * * *`), reads the live Aave V3 supply APY (`aave-v3/get-user-reserve-data.liquidityRate`); if it's below 3%, withdraws and re-supplies 0.005 WETH, then logs the final balance either way. |
| `guardian` | `awiys098yh7v2b9i5f8m1` | 5 | Hourly poll of the aWETH balance; if it drops below 0.004 (possible liquidation or an out-of-band withdrawal), runs a full Aave V3 health check and verifies the remaining gas balance. |
| `advanced` | `ma6epf75fjdsonscq8roc` | 11 | Flagship. Pre-flight position check → balance gate → withdraw → receipt gate → supply → final verify, with dedicated `abort-log` and `alert-hold` off-ramps if either gate fails. |

Run any of them:

```bash
cd orchestrator
node dist/index.js --workflow scheduled          # validates the pre-created workflow (dry run)
node dist/index.js --workflow advanced --execute  # validates, then actually executes it
node dist/index.js --workflow basic --plan ../plan.json --execute   # basic needs a plan
```

`--workflow` defaults to `advanced`. `scheduled`/`guardian`/`advanced` reference the fixed IDs in
`workflows.json` rather than creating a new workflow per run; `basic` is the only kind still built
per-invocation from a `MigrationPlan` (via `--plan` or `--rust-bin`).

### `basic` workflow graph (the one that has actually executed on-chain)

```
trigger-1 (manual)
  -> withdraw-source   (aave-v3/withdraw)
    -> verify-withdraw (web3/check-token-balance)
      -> supply-target (aave-v3/supply)
        -> verify-supply (web3/check-token-balance)
```

## Verified execution

Real Sepolia testnet run of the `basic` workflow, independently confirmed via a direct
`eth_getTransactionReceipt` call (not just KeeperHub's own "success" response):

- **Execution ID:** `wuns98j4lffgq015izlfw`
- **Execution tx:** [`0x72eff34a543a05ba8855f80549a55272cac044b2c55669ec105813732ae5d587`](https://sepolia.etherscan.io/tx/0x72eff34a543a05ba8855f80549a55272cac044b2c55669ec105813732ae5d587) — receipt `status: 0x1`, real Aave Pool `Supply` event + aWETH mint `Transfer` event.
- 5/5 workflow steps succeeded (100%).

## Setup

```bash
npm install -g @keeperhub/cli
kh auth login
kh wallet info   # confirm wallet is configured
kh chain list    # confirm Sepolia (11155111)

export KEEPERHUB_API_KEY=<token from kh auth login>
# export KEEPERHUB_MCP_URL=https://app.keeperhub.com/mcp   # default, override for local dev
```

## Running

```bash
# 1. Build the Rust policy core
cd rust-core && cargo build --release

# 2. Build the orchestrator
cd ../orchestrator && npm install && npm run build

# 3. Dry run any of the 4 workflows (no state mutated on-chain)
node dist/index.js --workflow advanced

# 4. Execute for real
node dist/index.js --workflow advanced --execute

# 5. Or drive the UI
cd ../ui && npm install && npm run dev -- -p 3200
```

## Unhappy paths handled

- `insufficient_balance` from the source protocol read — surfaced with the required minimum.
- `wouldRevert: true` on either simulated leg (withdraw or supply) — halts before any
  `create_workflow`/`execute_workflow` call, with the revert reason printed.
- `upstream_cold_start` on `execute_workflow` — retried with the same idempotency key after
  the server-suggested delay (see `executeWithColdStartRetry` in `orchestrator/src/index.ts`).
- Execution reaching a non-`success` terminal status — logs are pulled from `get_execution` and
  surfaced alongside the partial audit trail (whatever transaction hashes did land).
- Zero ERC20 allowance on `aave-v3/supply` (needs `transferFrom`) — caught live during
  development; the workflow's own `verify-*` nodes surface a stuck position rather than a
  silent partial migration.

## Status

- [x] Rust policy core (`p-token-migrator --output-plan`) with pair/address/amount validation
      and unit tests.
- [x] TypeScript workflow builder producing all 4 graphs above from real, schema-verified node
      configs (not assumed from docs — every action/trigger/condition field was confirmed
      against a live `list_action_schemas` dump before use).
- [x] KeeperHub MCP client, dry-run flow, audit polling, all exercised against the live
      production MCP server.
- [x] All 4 workflows created and `validate_workflow(deepCheck: true)`-passing on KeeperHub.
- [x] Real Sepolia execution of the `basic` workflow, independently verified on-chain (see
      [Verified execution](#verified-execution)).
- [x] `ui/` Next.js app — real Server Actions, no mocked data.
- [ ] Demo video, bounty PR (`web3/batch-token-check` using multicall3).

## Bounty track

Planned PR to `keeperhub/keeperhub`: new node `web3/batch-token-check`, batching multiple
balance reads into one multicall3 call. Every workflow above checks a balance more than once
per run (e.g. `verify-withdraw` + `verify-supply` in `basic`) — one batched node replaces
multiple `web3/check-token-balance` nodes, cutting RPC round trips per execution.
