# MigrateX

Deterministic token migration orchestrator, built for the KeeperHub Hackathon (Sep 6–18, 2026).

MigrateX makes **KeeperHub the only execution layer** for DeFi position management. A Rust
policy core computes a deterministic plan, a TypeScript orchestrator turns it into a KeeperHub
workflow, validates it (`validate_workflow` with `deepCheck: true`), and only then executes it
via the real KeeperHub MCP server. No agent improvises at execution time — every workflow is a
fixed, inspectable node graph, and every claim in this repo is backed by a live transaction hash
you can independently verify on Sepolia.

The project targets Aave V3 on Sepolia specifically because it was the only lending market found,
via live on-chain verification (not documentation), to actually work end to end on this testnet:

- Aave V4 is registered mainnet-only in KeeperHub's plugin (live `INVALID_FIELD_TYPE` error on
  Sepolia).
- The one Sepolia Morpho Blue market this project found had never had a market successfully
  created on it — every historical `createMarket`/`supply`/`borrow` call on that deployment
  reverted, and its owner never enabled an IRM or LLTV.
- Aave V3's Sepolia Pool (`0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951`) was verified live: real
  bytecode, a real WETH reserve with liquidity, and KeeperHub's `aave-v3` plugin accepting
  network `11155111` on a real call.

This "verify on-chain, don't trust the docs" discipline is why the schemas used throughout this
repo were pulled from a live `list_action_schemas` call against the production MCP server, not
guessed from field names that sound right — see [Node config reference](#node-config-reference)
for two cases where the obvious field name was wrong.

## Table of contents

- [Architecture](#architecture)
- [The 5 workflows](#the-5-workflows)
- [Verified execution](#verified-execution)
- [Setup](#setup)
- [Running](#running)
- [Environment variables](#environment-variables)
- [Node config reference](#node-config-reference)
- [Unhappy paths handled](#unhappy-paths-handled)
- [20 additional feature workflows](#20-additional-feature-workflows)
- [Tech stack](#tech-stack)
- [Status](#status)
- [Bounty track](#bounty-track)

## Architecture

```
rust-core/           p-token-migrator (Rust, clap + serde). Validates the migration pair,
                      computes amounts and a slippage-adjusted verification threshold, and
                      emits a MigrationPlan as JSON. Pure policy logic — it never touches the
                      network; that's KeeperHub's job.

orchestrator/         TypeScript. Talks JSON-RPC 2.0 directly to the KeeperHub MCP
                       streamable-HTTP endpoint (no SDK — the protocol was reverse-engineered
                       by hand against the live server: session handshake via an
                       `Mcp-Session-Id` response header, tool results wrapped as
                       `{content:[{type:"text",text:"<json>"}]}`).
  src/workflow-builder.ts   builds all 5 workflow graphs below (agent-authored, not templates)
  src/keeperhub.ts           MCP client — session handshake, tools/call, response unwrapping
  src/dry-run.ts             create_workflow (disabled) + validate_workflow before any real run
  src/audit.ts               polls get_execution until terminal, extracts transaction hashes
  src/index.ts                CLI entry: --workflow {basic|scheduled|guardian|advanced|emergency} [--execute]
  workflows.json              registry of the 5 live, pre-created workflow IDs (below)

ui/                  Next.js 16 (App Router, Turbopack) app. Real Server Actions call the same
                      compiled Rust binary and the same KeeperHubClient the CLI uses — there is
                      no simulated or mocked data path between the browser and the live chain.
  app/actions.ts             Server Actions: generatePlan / runDryRun / runExecution
  app/MigrationConsole.tsx    client console wired to the actions above via useTransition
  app/components/            editorial landing page (hero, how-it-works, architecture, canvas
                              particle animations) + the live 6-step execution monitor (ExecPanel)
  lib/                        copies of orchestrator/src, .js import extensions stripped —
                              Turbopack can't resolve either relative imports outside its own
                              project root or TypeScript's NodeNext .js→.ts extension trick, so
                              this directory exists purely as a build-tool workaround, not a
                              second implementation. Keep it in sync with orchestrator/src by
                              hand after any change there.
```

## The 5 workflows

All 5 are real, created via `create_workflow` against the live KeeperHub MCP server and
confirmed `valid: true` via `validate_workflow(deepCheck: true)` — zero errors, zero warnings.

| Kind | Workflow ID | Nodes | What it does |
|---|---|---|---|
| `basic` | [`umty7wmwpsak9cztndvt3`](https://app.keeperhub.com) | 6 | Manual trigger. Withdraw → verify → approve → supply → verify, within Aave V3 Sepolia. **Executed live** — see [Verified execution](#verified-execution) below. |
| `scheduled` | `6mfi90pptg2qtv5crmmf1` | 6 | Every 6h (`0 */6 * * *`), reads the live Aave V3 supply APY (`aave-v3/get-user-reserve-data.liquidityRate`, in ray units); if it's below 3%, withdraws and re-supplies 0.005 WETH, then logs the final balance either way. |
| `guardian` | `awiys098yh7v2b9i5f8m1` | 5 | Hourly poll of the aWETH balance; if it drops below 0.004 (possible liquidation or an out-of-band withdrawal), runs a full Aave V3 health check and verifies the remaining gas balance. |
| `advanced` | `ma6epf75fjdsonscq8roc` | 11 | Flagship. Pre-flight position check → balance gate → withdraw → receipt gate → supply → final verify, with dedicated `abort-log` and `alert-hold` off-ramps if either verification gate fails. |
| `emergency` | `fbhmewqjmkiwlrwcsn1fi` | 5 | Panic button. Manual trigger only (no schedule) — withdraws the **entire** supplied position via Aave's `uint256`-max "withdraw all" sentinel, verifies it landed in the wallet, and confirms the position is fully closed. |

Run any of them:

```bash
cd orchestrator
node dist/index.js --workflow scheduled           # validates the pre-created workflow (dry run)
node dist/index.js --workflow advanced --execute   # validates, then actually executes it
node dist/index.js --workflow basic --plan ../plan.json --execute   # basic needs a plan
node dist/index.js --workflow emergency --execute  # drains the entire position — use with intent
```

`--workflow` defaults to `advanced`. `scheduled`/`guardian`/`advanced`/`emergency` reference the
fixed IDs in `workflows.json` rather than creating a new workflow per run; `basic` is the only
kind still built per-invocation from a `MigrationPlan` (via `--plan` or `--rust-bin`), since it's
the one that actually moves a specific user's specific position rather than monitoring or fully
exiting a fixed one.

### `basic` workflow graph (the one that has actually executed on-chain)

```
trigger-1 (manual)
  -> withdraw-source   (aave-v3/withdraw)
    -> verify-withdraw (web3/check-token-balance)
      -> approve-aave   (web3/approve-token, amount "max")
        -> supply-target (aave-v3/supply)
          -> verify-supply (web3/check-token-balance)
```

`approve-aave` exists because `aave-v3/supply` calls `Pool.supply()`, which needs an ERC20
`transferFrom` — without a standing allowance to the Pool it reverts with an opaque `Error(32)`
/ "missing revert data". `web3/approve-token` can't be direct-executed as a one-off call
(KeeperHub returns "Use workflow execution instead"), so it has to live inside the workflow
itself — making every run self-sufficient instead of depending on an approval done out of band.

### `advanced` workflow graph (the flagship)

```
trigger-1 (manual)
  -> preflight        (aave-v3/get-user-reserve-data)
    -> check-aweth     (web3/check-token-balance)
      -> cond-balance  (Condition: aWETH balance >= amount)
        --true--> withdraw        (aave-v3/withdraw)
          -> check-weth            (web3/check-token-balance)
            -> cond-weth           (Condition: WETH received >= amount)
              --true--> supply     (aave-v3/supply)
                -> final-verify     (web3/check-token-balance)
              --false-> alert-hold (web3/check-token-balance — funds held as WETH, flagged)
        --false-> abort-log (web3/check-token-balance — logged, nothing executed)
```

### `emergency` workflow graph (the panic button)

```
trigger-1 (manual)
  -> preflight       (aave-v3/get-user-reserve-data)
    -> withdraw-all   (aave-v3/withdraw, amount = uint256 max)
      -> verify-exit   (web3/check-token-balance)
        -> confirm-closed (aave-v3/get-user-reserve-data)
```

No schedule, no threshold — this one is meant to be triggered by a person the moment something
looks wrong, not by a cron. `amount` on `withdraw-all` is Aave's own `type(uint256).max`
sentinel: the Pool contract itself special-cases that value as "withdraw the caller's entire
balance," so this needs no dynamic balance lookup beforehand — one call closes the whole
position regardless of its exact size.

## Verified execution

Real Sepolia testnet run of the current 6-node `basic` workflow (with the `approve-aave` gate),
independently confirmed via direct `eth_getTransactionReceipt` calls for all three write
transactions — not just KeeperHub's own "success" response:

- **Execution ID:** `0iv7xhyx26yp262li06au`
- **Withdraw tx:** [`0xb90edae1d535382a843437f646a875e05dda30a50b6a713946be89bdc90a7f2a`](https://sepolia.etherscan.io/tx/0xb90edae1d535382a843437f646a875e05dda30a50b6a713946be89bdc90a7f2a) — `status: 0x1`, block 11,611,755.
- **Approve tx:** [`0x4ce3be7bb871dd919876fdc39e79cbea19bc4f06b457fdea2da31de350d93ba8`](https://sepolia.etherscan.io/tx/0x4ce3be7bb871dd919876fdc39e79cbea19bc4f06b457fdea2da31de350d93ba8) — `status: 0x1`, block 11,611,756, real ERC20 `Approval` event for unlimited allowance to the Pool.
- **Supply tx:** [`0xbdbdb5ef54e9dedd71b69ba5a3b1fcf0886cfac2c6d0de97bb6822bf9f8988a9`](https://sepolia.etherscan.io/tx/0xbdbdb5ef54e9dedd71b69ba5a3b1fcf0886cfac2c6d0de97bb6822bf9f8988a9) — `status: 0x1`, block 11,611,757, real Aave Pool `Supply` event + aWETH mint `Transfer` event.
- 6/6 workflow steps succeeded (100%).

An earlier run of the pre-`approve-aave` (5-node) version of this workflow really did fail live
with `Contract call failed: missing revert data` on `supply-target` once a prior out-of-band
approval had been fully consumed — that failure is what the `approve-aave` node exists to fix
permanently. A second failure mode was caught the same way while re-testing the fix: `withdraw-source`
reverted with `Error(32)` (Aave's `NOT_ENOUGH_AVAILABLE_USER_BALANCE`) because the wallet had no
supplied aWETH position left to withdraw — the workflow was never broken, there was just nothing
to migrate. Re-supplying WETH to recreate a position, then re-running the workflow, is what
produced the transactions above.

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

# 3. Dry run any of the 5 workflows (no state mutated on-chain)
node dist/index.js --workflow advanced

# 4. Execute for real
node dist/index.js --workflow advanced --execute

# 5. Or drive the UI
cd ../ui && npm install && npm run dev -- -p 3200
```

You can also hand the CLI a pre-computed plan instead of shelling out to Rust — useful for the
`basic` workflow with a specific amount/address pair:

```bash
./rust-core/target/release/p-token-migrator \
  --source-protocol aave-v3 --target-protocol aave-v3 --token WETH --amount 0.005 \
  --network 11155111 \
  --source-address 0xYourAddress --recipient-address 0xYourAddress \
  --output-plan > plan.json

cd orchestrator && node dist/index.js --workflow basic --plan ../plan.json --execute
```

## Environment variables

| Variable | Where | Required | Notes |
|---|---|---|---|
| `KEEPERHUB_API_KEY` | `orchestrator/.env`, `ui/.env.local` | yes | Bearer token from `kh auth login`. Never commit this — both `.env` files are gitignored. |
| `KEEPERHUB_MCP_URL` | same | no | Defaults to `https://app.keeperhub.com/mcp`. Override only for local KeeperHub dev servers. |

`orchestrator/.env.example` documents both with empty values — copy it to `.env` and fill in the
real key.

## Node config reference

Every field below was confirmed against a live `list_action_schemas` call, not assumed from a
plausible-sounding name — this table exists because several of the obvious names are wrong:

| Node | actionType / triggerType | Gotcha |
|---|---|---|
| Scheduled trigger | `Schedule` | Cron goes in **`scheduleCron`**, not `cron`. `validate_cron` (a separate tool) uses a third name, `cronExpression`, for the same concept. |
| Condition | `Condition` (capital C) | The field is **`condition`** (a JS-like expression string, e.g. `"{{@node:Label.field}} < 5"`), not `expression`. `conditionConfig` is a *different*, optional visual-builder shape — don't use it for a plain expression. |
| `aave-v3/get-user-reserve-data` | — | Supply APY output field is **`liquidityRate`** (ray units, 1e27 = 100%), not `currentLiquidityRate` — that field doesn't exist. |
| `web3/check-token-balance` | — | Raw balance lives at **`balance.balanceRaw`** (a nested object), not a flat `balance` field. `tokenConfig` must be the JSON string `{"mode":"custom","customToken":{"address":"0x...","symbol":"..."}}` — a flat `{address,symbol,decimals}` object is silently wrong. |
| `aave-v3/supply` | — | `referralCode` is marked *optional* in the schema but is required in practice — omitting it fails with `Invalid function arguments: referralCode: uint16 is missing`. Always send `"0"`. |
| Any node | — | `network` (chain ID as a string) is a deprecated-but-still-accepted alias for the canonical `chainId` field. Both work; this repo uses `network` throughout for consistency with the Rust plan's own field name. |

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

## Tech stack

- **rust-core** — Rust, `clap` (derive), `serde`/`serde_json`.
- **orchestrator** — Node.js ≥20, TypeScript, zero runtime dependencies (built-in `fetch` for
  the MCP client; no MCP SDK).
- **ui** — Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS v4, Server Actions,
  Canvas 2D for the particle/animation layer, `next/font/google` (Instrument Serif, Great Vibes,
  Space Mono, DM Sans).
- **Execution layer** — KeeperHub MCP (streamable-HTTP JSON-RPC), Sepolia testnet, Aave V3.

## 20 additional feature workflows

Beyond the 5 core workflows, this repo also exercises the rest of KeeperHub's real Aave V3
action surface (`borrow`, `repay`, `set-collateral`, `get-user-account-data`) and every real
trigger type (`Manual`/`Schedule`/`Webhook`/`Event`/`Block`) as 20 more workflows. All 20 are
real: created via `create_workflow` and confirmed `valid: true` via `validate_workflow(deepCheck:
true)` against the live server, zero errors, zero warnings. Unlike `basic` and `emergency`, none
of these 20 have been executed — several would open real debt or move real funds, and that isn't
implied by building the feature. Run any one with `node dist/index.js --feature <name>
[--execute]`; IDs live in `orchestrator/workflows.json`'s `features` map.

| Feature | Trigger | What it does |
|---|---|---|
| `health-factor-monitor` | Schedule (1h) | Reads overall account health factor (not just one reserve); logs a warning if below 1.5. |
| `enable-collateral` | Manual | Marks the WETH reserve as usable collateral. |
| `disable-collateral` | Manual | Marks WETH as NOT usable collateral, without withdrawing it. |
| `auto-repay-on-low-health` | Schedule (30min) | Repays 0.001 WETH of debt if health factor drops below 1.2. |
| `borrow-against-collateral` | Manual | Only borrows 0.001 WETH if the account actually has available borrowing power. |
| `debt-position-monitor` | Schedule (1h) | Checks for outstanding variable debt on WETH; logs wallet balance if any exists. |
| `webhook-rebalance-trigger` | Webhook | External signal triggers a 0.001 WETH withdraw if a position exists. |
| `block-interval-sync` | Block (every 50) | Logs aWETH balance on a block-native cadence instead of wall-clock time. |
| `event-triggered-supply-watch` | Event (`Supply` on the Pool) | Fires on ANY Supply event market-wide; logs this wallet's own aWETH balance in response. |
| `allowance-auditor` | Schedule (1h) | Checks the Pool's WETH allowance; re-approves unlimited if it's dropped below 0.005 — guards against the exact failure `basic` hit live (see [Verified execution](#verified-execution)). |
| `multi-asset-balance-snapshot` | Manual | Logs both WETH and aWETH balances in one run. |
| `collateral-safety-check` | Manual | Only disables WETH collateral if health factor is comfortably above 2.0; aborts and logs otherwise. |
| `repay-full-debt` | Manual | Reads the exact live debt balance via a template reference and repays precisely that, not a guessed amount. |
| `borrow-then-track` | Manual | Borrows 0.001 WETH, verifies the balance, then confirms the resulting health factor. |
| `position-health-dashboard-feed` | Schedule (15min) | Account health + both balances in one run — a dashboard feed. |
| `pre-migration-safety-gate` | Manual | Only withdraws if health factor is above 1.1 first — a check `basic` itself doesn't have. |
| `gas-buffer-guardian` | Schedule (1h) | Flags it if native ETH balance drops below 0.001 — every workflow here needs gas to run at all. |
| `full-position-report` | Manual | The complete readable position: account health, per-reserve detail, both balances. |
| `re-enable-collateral-after-repay` | Manual | Repays 0.001 WETH of debt, then re-enables WETH as collateral in the same run. |
| `emergency-debt-clear` | Manual | Panic button for debt: repays it in full if any exists, otherwise logs that there was nothing to clear. |

## Status

- [x] Rust policy core (`p-token-migrator --output-plan`) with pair/address/amount validation
      and unit tests.
- [x] TypeScript workflow builder producing all 5 core graphs, plus 20 feature workflows, from
      real, schema-verified node configs.
- [x] KeeperHub MCP client, dry-run flow, audit polling, all exercised against the live
      production MCP server.
- [x] All 25 workflows created and `validate_workflow(deepCheck: true)`-passing on KeeperHub.
- [x] Real Sepolia execution of the `basic` and `emergency` workflows, independently verified
      on-chain (see [Verified execution](#verified-execution)).
- [x] `ui/` Next.js app — real Server Actions, no mocked data.
- [ ] Demo video, bounty PR (`web3/batch-token-check` using multicall3).

## Bounty track

Planned PR to `keeperhub/keeperhub`: new node `web3/batch-token-check`, batching multiple
balance reads into one multicall3 call. Every workflow above checks a balance more than once
per run (e.g. `verify-withdraw` + `verify-supply` in `basic`) — one batched node replaces
multiple `web3/check-token-balance` nodes, cutting RPC round trips per execution.
