import type { KeeperHubWorkflow, MigrationPlan, WorkflowEdge, WorkflowNode } from "./types";

/**
 * Known token metadata per chain. web3/check-token-balance needs a real
 * contract address (via tokenConfig) and aave-v3/supply|withdraw need
 * "amount" in the token's raw smallest unit, not a human amount -- the
 * plan only carries a human amount and symbol, so this is the lookup that
 * bridges both.
 *
 * IMPORTANT: this is the WETH reserve Aave V3's own Sepolia Pool actually
 * uses (confirmed via a live getReservesList()/getReserveData() call
 * against the Pool at 0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951) -- it is
 * a DIFFERENT contract from the "WETH" used by the (broken) Sepolia Morpho
 * deployment. Wrapping ETH into the wrong WETH contract silently produces
 * a balance the target protocol can never see; there is no single canonical
 * "WETH" on a testnet, only whichever contract a given protocol's reserve
 * actually points at.
 */
const TOKENS: Record<string, Record<string, { address: string; decimals: number }>> = {
  "11155111": {
    WETH: { address: "0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c", decimals: 18 },
    // aWETH: Aave V3 Sepolia's interest-bearing receipt token for the WETH
    // reserve above (1:1 backed). Confirmed live: minted to the recipient
    // on every successful aave-v3/supply this project has run.
    aWETH: { address: "0x5b071b590a59395fE4025A0Ccc1FcC931AAc1830", decimals: 18 },
  },
};

function tokenInfo(network: string, symbol: string): { address: string; decimals: number } {
  const info = TOKENS[network]?.[symbol];
  if (!info) {
    throw new Error(`No known token metadata for ${symbol} on chain ${network} -- add it to TOKENS`);
  }
  return info;
}

function tokenConfig(network: string, symbol: string): string {
  const { address } = tokenInfo(network, symbol);
  return JSON.stringify({ mode: "custom", customToken: { address, symbol } });
}

/** Converts a human decimal amount (e.g. "1", "0.005") to raw base units as a decimal string, without floating point. */
function toRawUnits(amount: string, decimals: number): string {
  const [whole, frac = ""] = amount.split(".");
  const paddedFrac = (frac + "0".repeat(decimals)).slice(0, decimals);
  const raw = `${whole}${paddedFrac}`.replace(/^0+(?=\d)/, "");
  return raw === "" ? "0" : raw;
}

function triggerNode(): WorkflowNode {
  return {
    id: "trigger-1",
    type: "trigger",
    position: { x: 0, y: 0 },
    data: { type: "trigger", config: { triggerType: "Manual" } },
  };
}

/**
 * Schedule trigger. Field name is `scheduleCron` (NOT `cron`) -- confirmed
 * against the live list_action_schemas dump; `validate_cron` also expects
 * `cronExpression`, a third, different name for the same concept.
 */
function scheduleTriggerNode(cron: string, timezone?: string): WorkflowNode {
  return {
    id: "trigger-1",
    type: "trigger",
    position: { x: 0, y: 0 },
    data: {
      type: "trigger",
      config: {
        triggerType: "Schedule",
        scheduleCron: cron,
        ...(timezone ? { scheduleTimezone: timezone } : {}),
      },
    },
  };
}

function actionNode(id: string, y: number, config: Record<string, unknown>): WorkflowNode {
  return {
    id,
    type: "action",
    position: { x: 0, y },
    data: { type: "action", config },
  };
}

/**
 * Condition node -- NOT a distinct `data.type`; it's an action node whose
 * `actionType` is exactly `"Condition"` (capital C). The required field is
 * `condition`, a JS-like expression string (e.g.
 * `"{{@node:Label.field}} < 5"`), not `expression` or `conditionConfig`
 * (that's the optional visual-builder variant) -- confirmed against the
 * live list_action_schemas dump. Edges leaving it need `sourceHandle`.
 */
function conditionNode(id: string, y: number, condition: string): WorkflowNode {
  return actionNode(id, y, { actionType: "Condition", condition });
}

function edge(source: string, target: string, sourceHandle?: "true" | "false"): WorkflowEdge {
  const suffix = sourceHandle ? `-${sourceHandle}` : "";
  return { id: `${source}-${target}${suffix}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) };
}

function webhookTriggerNode(): WorkflowNode {
  return {
    id: "trigger-1",
    type: "trigger",
    position: { x: 0, y: 0 },
    data: { type: "trigger", config: { triggerType: "Webhook" } },
  };
}

/**
 * Blockchain event trigger. `contractABI` is a required field even though
 * the platform auto-fetches ABIs for verified contracts -- confirmed
 * against the live list_action_schemas dump, so a real event fragment is
 * supplied here rather than an empty string, to not depend on that
 * auto-fetch behavior succeeding.
 */
function eventTriggerNode(network: string, contractAddress: string, eventName: string, abiFragment: Record<string, unknown>): WorkflowNode {
  return {
    id: "trigger-1",
    type: "trigger",
    position: { x: 0, y: 0 },
    data: {
      type: "trigger",
      config: {
        triggerType: "Event",
        network,
        contractAddress,
        contractABI: JSON.stringify([abiFragment]),
        eventName,
      },
    },
  };
}

function blockTriggerNode(network: string, blockInterval: string): WorkflowNode {
  return {
    id: "trigger-1",
    type: "trigger",
    position: { x: 0, y: 0 },
    data: { type: "trigger", config: { triggerType: "Block", network, blockInterval } },
  };
}

/** Aave V3's Sepolia Pool -- `aave-v3/supply` calls `Pool.supply()`, which needs an ERC20 `transferFrom`, so the Pool needs an allowance on the source token first. */
const AAVE_V3_SEPOLIA_POOL = "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951";

/**
 * Builds an Aave V3-only migration workflow. Morpho and Aave V4 were both
 * ruled out by live, on-chain verification, not by their docs:
 *   - aave-v4 is registered mainnet-only (chain "1") in KeeperHub's plugin
 *     (live INVALID_FIELD_TYPE error when Sepolia was attempted).
 *   - The one Sepolia Morpho Blue market this project found turned out,
 *     on closer on-chain inspection, to have never successfully been
 *     created (every historical createMarket/supply/borrow call on that
 *     deployment reverted; its owner never enabled any IRM or LLTV).
 * Aave V3's Sepolia Pool (0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951) was
 * verified live: real bytecode, a real WETH reserve with ~12,209 WETH of
 * liquidity, 49/50 of its most recent transactions succeeding, and
 * KeeperHub's aave-v3 plugin accepting network 11155111 on a real call.
 *
 * 7-node linear graph:
 *   trigger-1 -> withdraw-source -> verify-withdraw -> approve-aave -> supply-target -> verify-supply -> notify-telegram
 *
 * approve-aave (web3/approve-token, amount "max") exists because
 * aave-v3/supply's underlying Pool.supply() needs transferFrom, which
 * reverts with an opaque "missing revert data" if the Pool doesn't already
 * have an allowance -- confirmed live: a real execution's supply-target
 * node failed exactly this way once a prior manual approval had been
 * fully consumed. `web3/approve-token` cannot be direct-executed
 * standalone (KeeperHub returns "Use workflow execution instead"), so it
 * has to be a workflow node, not a one-off pre-flight call -- this makes
 * every run of this workflow self-sufficient rather than depending on an
 * approval done out of band.
 *
 * notify-telegram (telegram/send-message) posts the final aWETH balance
 * after every real migration. Its `chatId` below is a placeholder --
 * replace it with a real chat/channel id, and add a Telegram integration
 * in your KeeperHub account settings, before this leg can actually send
 * (confirmed live: this account currently has no messaging integration
 * configured at all, only the wallet -- the node is real and
 * schema-verified, the destination is the part only you can supply).
 *
 * Source and target are the same Aave V3 Sepolia market (a same-market
 * round trip: withdraw then re-supply), since there is only one Aave V3
 * deployment on this chain to migrate within.
 */
export function buildMigrationWorkflow(plan: MigrationPlan): KeeperHubWorkflow {
  if (plan.source_protocol !== "aave-v3" || plan.target_protocol !== "aave-v3") {
    throw new Error(`buildMigrationWorkflow only supports aave-v3<->aave-v3 now; got ${plan.source_protocol}->${plan.target_protocol}`);
  }

  const { address: asset, decimals } = tokenInfo(plan.network, plan.token);
  const amount = toRawUnits(plan.amount, decimals);

  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("withdraw-source", 200, {
      actionType: "aave-v3/withdraw",
      network: plan.network,
      asset,
      amount,
      to: plan.source_address,
    }),
    actionNode("verify-withdraw", 400, {
      actionType: "web3/check-token-balance",
      network: plan.network,
      address: plan.source_address,
      tokenConfig: tokenConfig(plan.network, plan.token),
    }),
    actionNode("approve-aave", 500, {
      actionType: "web3/approve-token",
      network: plan.network,
      tokenConfig: tokenConfig(plan.network, plan.token),
      spenderAddress: AAVE_V3_SEPOLIA_POOL,
      amount: "max",
    }),
    actionNode("supply-target", 600, {
      actionType: "aave-v3/supply",
      network: plan.network,
      asset,
      amount,
      onBehalfOf: plan.recipient_address,
      // Marked optional in KeeperHub's schema but confirmed live to be
      // required by the underlying call construction -- omitting it fails
      // with "Invalid function arguments: referralCode: uint16 is missing".
      referralCode: "0",
    }),
    actionNode("verify-supply", 800, {
      actionType: "web3/check-token-balance",
      network: plan.network,
      address: plan.recipient_address,
      tokenConfig: tokenConfig(plan.network, plan.token),
    }),
    actionNode("notify-telegram", 1000, {
      actionType: "telegram/send-message",
      chatId: "@your_telegram_chat",
      message: `MigrateX: migration complete. Final ${plan.token} balance: {{@verify-supply:Balance.balance.balance}} ${plan.token}.`,
    }),
  ];

  const edges: WorkflowEdge[] = [
    edge("trigger-1", "withdraw-source"),
    edge("withdraw-source", "verify-withdraw"),
    edge("verify-withdraw", "approve-aave"),
    edge("approve-aave", "supply-target"),
    edge("supply-target", "verify-supply"),
    edge("verify-supply", "notify-telegram"),
  ];

  return {
    name: `migrate-${plan.token}-aave-v3-to-aave-v3`,
    description: `Migrate ${plan.amount} ${plan.token} within Aave V3 on chain ${plan.network}`,
    nodes,
    edges,
  };
}

export interface MonitorConfig {
  network: string;
  /** Wallet address whose Aave V3 position / balances are monitored. */
  user: string;
}

/**
 * WORKFLOW 2 -- Scheduled APY Monitor + Auto-migrate.
 * Fires every 6h, reads the live Aave V3 supply APY (`liquidityRate`, in
 * ray units -- NOT `currentLiquidityRate`, which doesn't exist on this
 * action's output; confirmed against list_action_schemas), and if it has
 * dropped below 3% withdraws + re-supplies 0.005 WETH (a same-market
 * round trip stands in for "migrate to a better market" until a second
 * live Sepolia lending market is available to compare against). Both
 * branches converge on a final balance log.
 */
export function buildApyMonitorWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const { address: weth } = tokenInfo(cfg.network, "WETH");
  const amount = "5000000000000000"; // 0.005 WETH

  const nodes: WorkflowNode[] = [
    scheduleTriggerNode("0 */6 * * *", "UTC"),
    actionNode("read-reserve", 200, {
      actionType: "aave-v3/get-user-reserve-data",
      network: cfg.network,
      asset: weth,
      user: cfg.user,
    }),
    conditionNode(
      "apy-check",
      400,
      // 3% APY in ray units (1e27 == 100%) => 3e25.
      "{{@read-reserve:Reserve.liquidityRate}} < 30000000000000000000000000"
    ),
    actionNode("withdraw-low", 600, {
      actionType: "aave-v3/withdraw",
      network: cfg.network,
      asset: weth,
      amount,
      to: cfg.user,
    }),
    actionNode("resupply-low", 800, {
      actionType: "aave-v3/supply",
      network: cfg.network,
      asset: weth,
      amount,
      onBehalfOf: cfg.user,
      referralCode: "0",
    }),
    actionNode("log-state", 1000, {
      actionType: "web3/check-token-balance",
      network: cfg.network,
      address: cfg.user,
      tokenConfig: tokenConfig(cfg.network, "WETH"),
    }),
  ];

  const edges: WorkflowEdge[] = [
    edge("trigger-1", "read-reserve"),
    edge("read-reserve", "apy-check"),
    edge("apy-check", "withdraw-low", "true"),
    edge("apy-check", "log-state", "false"),
    edge("withdraw-low", "resupply-low"),
    edge("resupply-low", "log-state"),
  ];

  return {
    name: "apy-monitor-auto-migrate",
    description: "Every 6h: read Aave V3 supply APY; if below 3%, withdraw and re-supply 0.005 WETH, then log final balance.",
    nodes,
    edges,
  };
}

/**
 * WORKFLOW 3 -- Balance Guardian.
 * KeeperHub triggers only support a fixed set (Manual/Schedule/Webhook/
 * Event/Block) -- there is no generic "balance drops below X" trigger
 * type, so the spec's "web3 event" trigger is implemented as an hourly
 * Schedule poll (the spec's own stated "polling fallback"), which is the
 * only live option that actually exists.
 */
export function buildBalanceGuardianWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const { address: weth } = tokenInfo(cfg.network, "WETH");

  const nodes: WorkflowNode[] = [
    scheduleTriggerNode("0 * * * *", "UTC"),
    actionNode("check-bal", 200, {
      actionType: "web3/check-token-balance",
      network: cfg.network,
      address: cfg.user,
      tokenConfig: tokenConfig(cfg.network, "aWETH"),
    }),
    conditionNode(
      "bal-check",
      400,
      // check-token-balance's raw amount lives at `balance.balanceRaw`, not
      // a flat `balance` field -- confirmed against list_action_schemas.
      "{{@check-bal:Balance.balance.balanceRaw}} < 4000000000000000"
    ),
    actionNode("health-check", 600, {
      actionType: "aave-v3/get-user-reserve-data",
      network: cfg.network,
      asset: weth,
      user: cfg.user,
    }),
    actionNode("gas-check", 800, {
      actionType: "web3/check-balance",
      network: cfg.network,
      address: cfg.user,
    }),
  ];

  const edges: WorkflowEdge[] = [
    edge("trigger-1", "check-bal"),
    edge("check-bal", "bal-check"),
    edge("bal-check", "health-check", "true"),
    edge("health-check", "gas-check"),
    // false branch: intentionally no edge -- position is healthy, stop.
  ];

  return {
    name: "balance-guardian",
    description: "Hourly: check aWETH balance; if below 0.004 (possible liquidation/withdrawal), run a full Aave V3 health check and verify remaining gas balance.",
    nodes,
    edges,
  };
}

/**
 * WORKFLOW 4 -- Multi-step Migration with Verification Gates (flagship).
 * The spec numbers two DIFFERENT nodes "Node 8" (abort vs. supply) and two
 * different nodes "Node 9" (alert vs. final verify) -- a literal build
 * would collide two node ids. Fixed by giving each terminal branch (abort,
 * alert-and-hold) its own node id instead of reusing a number; the gating
 * logic itself (pre-flight -> balance gate -> withdraw -> receipt gate ->
 * supply -> final verify, with two off-ramps) is unchanged from the spec.
 */
export function buildAdvancedMigrationWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const { address: weth } = tokenInfo(cfg.network, "WETH");
  const amount = "5000000000000000"; // 0.005 WETH

  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("preflight", 200, {
      actionType: "aave-v3/get-user-reserve-data",
      network: cfg.network,
      asset: weth,
      user: cfg.user,
    }),
    actionNode("check-aweth", 400, {
      actionType: "web3/check-token-balance",
      network: cfg.network,
      address: cfg.user,
      tokenConfig: tokenConfig(cfg.network, "aWETH"),
    }),
    conditionNode("cond-balance", 600, `{{@check-aweth:Balance.balance.balanceRaw}} >= ${amount}`),
    actionNode("withdraw", 800, {
      actionType: "aave-v3/withdraw",
      network: cfg.network,
      asset: weth,
      amount,
      to: cfg.user,
    }),
    actionNode("check-weth", 1000, {
      actionType: "web3/check-token-balance",
      network: cfg.network,
      address: cfg.user,
      tokenConfig: tokenConfig(cfg.network, "WETH"),
    }),
    conditionNode("cond-weth", 1200, `{{@check-weth:Balance.balance.balanceRaw}} >= ${amount}`),
    actionNode("supply", 1400, {
      actionType: "aave-v3/supply",
      network: cfg.network,
      asset: weth,
      amount,
      onBehalfOf: cfg.user,
      referralCode: "0",
    }),
    actionNode("final-verify", 1600, {
      actionType: "web3/check-token-balance",
      network: cfg.network,
      address: cfg.user,
      tokenConfig: tokenConfig(cfg.network, "aWETH"),
    }),
    actionNode("abort-log", 400, {
      actionType: "web3/check-token-balance",
      network: cfg.network,
      address: cfg.user,
      tokenConfig: tokenConfig(cfg.network, "aWETH"),
    }),
    actionNode("alert-hold", 1000, {
      actionType: "web3/check-token-balance",
      network: cfg.network,
      address: cfg.user,
      tokenConfig: tokenConfig(cfg.network, "WETH"),
    }),
  ];

  const edges: WorkflowEdge[] = [
    edge("trigger-1", "preflight"),
    edge("preflight", "check-aweth"),
    edge("check-aweth", "cond-balance"),
    edge("cond-balance", "withdraw", "true"),
    edge("cond-balance", "abort-log", "false"),
    edge("withdraw", "check-weth"),
    edge("check-weth", "cond-weth"),
    edge("cond-weth", "supply", "true"),
    edge("cond-weth", "alert-hold", "false"),
    edge("supply", "final-verify"),
  ];

  return {
    name: "advanced-migration-verification-gates",
    description: "Pre-flight check -> balance gate -> withdraw -> receipt gate -> supply -> final verify, with dedicated abort and alert-and-hold off-ramps.",
    nodes,
    edges,
  };
}

/**
 * uint256 max -- passed as `amount` to Pool.withdraw(), this is the
 * standard Aave/Compound-style sentinel meaning "withdraw my entire
 * balance," not a real numeric amount. This is a base-protocol
 * convention (the Pool contract itself special-cases it), not a
 * KeeperHub feature, so it needs no special support from aave-v3/withdraw
 * beyond accepting an arbitrary string in that field, which it already does.
 */
const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

/**
 * WORKFLOW 5 -- Emergency Exit (panic button).
 * One manual trigger, no amount to configure: withdraws the ENTIRE
 * supplied WETH position in a single call (via the uint256-max
 * sentinel above) rather than a fixed 0.005 like every other workflow
 * here, then confirms on-chain that the position is fully closed
 * (currentATokenBalance back to 0). Meant to be triggered by hand when
 * something looks wrong (a depeg, a suspicious rate change, anything
 * that should not wait for the next scheduled check) -- it does not run
 * on a timer.
 */
export function buildEmergencyExitWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const { address: weth } = tokenInfo(cfg.network, "WETH");

  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("preflight", 200, {
      actionType: "aave-v3/get-user-reserve-data",
      network: cfg.network,
      asset: weth,
      user: cfg.user,
    }),
    actionNode("withdraw-all", 400, {
      actionType: "aave-v3/withdraw",
      network: cfg.network,
      asset: weth,
      amount: MAX_UINT256,
      to: cfg.user,
    }),
    actionNode("verify-exit", 600, {
      actionType: "web3/check-token-balance",
      network: cfg.network,
      address: cfg.user,
      tokenConfig: tokenConfig(cfg.network, "WETH"),
    }),
    actionNode("confirm-closed", 800, {
      actionType: "aave-v3/get-user-reserve-data",
      network: cfg.network,
      asset: weth,
      user: cfg.user,
    }),
  ];

  const edges: WorkflowEdge[] = [
    edge("trigger-1", "preflight"),
    edge("preflight", "withdraw-all"),
    edge("withdraw-all", "verify-exit"),
    edge("verify-exit", "confirm-closed"),
  ];

  return {
    name: "emergency-exit",
    description: "Panic button: withdraw the entire supplied WETH position from Aave V3 in one call, verify it landed in the wallet, and confirm the position is fully closed.",
    nodes,
    edges,
  };
}

/* ------------------------------------------------------------------------
 * 20 FEATURE WORKFLOWS -- the full real Aave V3 action surface KeeperHub
 * exposes (borrow/repay/set-collateral/get-user-account-data, on top of
 * supply/withdraw already used above), combined with every real trigger
 * type (Manual/Schedule/Webhook/Event/Block). Every field name below is
 * confirmed against the live list_action_schemas dump, not guessed --
 * aave-v3/borrow and aave-v3/repay both mark `interestRateMode` optional,
 * but it's included explicitly on both here on the same precedent as
 * aave-v3/supply's `referralCode`: a field an earlier, unrelated call
 * needed despite being marked optional in the schema.
 *
 * These are created + validated live (create_workflow + validate_workflow
 * deepCheck:true) but, unlike `basic` and `emergency`, are NOT executed as
 * part of building them -- several would open real debt or move real
 * funds, and doing that isn't implied by "add the feature." Execute any
 * of them individually the same way `emergency` was: build, dry-run,
 * --execute.
 * ------------------------------------------------------------------------ */

const SMALL_AMOUNT = "1000000000000000"; // 0.001 WETH -- a demo-scale borrow/repay amount, distinct from the 0.005 used for supply/withdraw elsewhere.

/** Aave V3 Pool's real `Supply` event signature -- used by the event-triggered feature below. */
const AAVE_SUPPLY_EVENT_ABI = {
  anonymous: false,
  name: "Supply",
  type: "event",
  inputs: [
    { indexed: true, name: "reserve", type: "address" },
    { indexed: false, name: "user", type: "address" },
    { indexed: true, name: "onBehalfOf", type: "address" },
    { indexed: false, name: "amount", type: "uint256" },
    { indexed: true, name: "referralCode", type: "uint16" },
  ],
};

/** 1. Health Factor Monitor -- hourly check of overall account health (not just one reserve). */
export function buildHealthFactorMonitorWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const nodes: WorkflowNode[] = [
    scheduleTriggerNode("0 * * * *", "UTC"),
    actionNode("account-data", 200, { actionType: "aave-v3/get-user-account-data", network: cfg.network, user: cfg.user }),
    conditionNode("health-check", 400, "{{@account-data:AccountData.healthFactor}} < 1500000000000000000"),
    actionNode("log-warning", 600, { actionType: "web3/check-balance", network: cfg.network, address: cfg.user }),
  ];
  const edges: WorkflowEdge[] = [
    edge("trigger-1", "account-data"),
    edge("account-data", "health-check"),
    edge("health-check", "log-warning", "true"),
  ];
  return { name: "health-factor-monitor", description: "Hourly: read overall Aave V3 account health factor; if below 1.5, log a warning state.", nodes, edges };
}

/** 2. Enable Collateral -- flip the WETH reserve to usable as collateral. */
export function buildEnableCollateralWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const { address: weth } = tokenInfo(cfg.network, "WETH");
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("enable-collateral", 200, { actionType: "aave-v3/set-collateral", network: cfg.network, asset: weth, useAsCollateral: "true" }),
  ];
  const edges: WorkflowEdge[] = [edge("trigger-1", "enable-collateral")];
  return { name: "enable-collateral", description: "Manual: mark the WETH reserve as usable collateral.", nodes, edges };
}

/** 3. Disable Collateral -- flip the WETH reserve to NOT usable as collateral (keeps the supply position, stops it backing borrows). */
export function buildDisableCollateralWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const { address: weth } = tokenInfo(cfg.network, "WETH");
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("disable-collateral", 200, { actionType: "aave-v3/set-collateral", network: cfg.network, asset: weth, useAsCollateral: "false" }),
  ];
  const edges: WorkflowEdge[] = [edge("trigger-1", "disable-collateral")];
  return { name: "disable-collateral", description: "Manual: mark the WETH reserve as NOT usable collateral, without withdrawing it.", nodes, edges };
}

/** 4. Auto-Repay on Low Health -- every 30min, repay a small amount of debt if health factor is dangerously low. */
export function buildAutoRepayOnLowHealthWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const { address: weth } = tokenInfo(cfg.network, "WETH");
  const nodes: WorkflowNode[] = [
    scheduleTriggerNode("*/30 * * * *", "UTC"),
    actionNode("account-data", 200, { actionType: "aave-v3/get-user-account-data", network: cfg.network, user: cfg.user }),
    conditionNode("danger-check", 400, "{{@account-data:AccountData.healthFactor}} < 1200000000000000000"),
    actionNode("emergency-repay", 600, {
      actionType: "aave-v3/repay", network: cfg.network, asset: weth, amount: SMALL_AMOUNT, onBehalfOf: cfg.user, interestRateMode: "2",
    }),
  ];
  const edges: WorkflowEdge[] = [
    edge("trigger-1", "account-data"),
    edge("account-data", "danger-check"),
    edge("danger-check", "emergency-repay", "true"),
  ];
  return { name: "auto-repay-on-low-health", description: "Every 30min: if account health factor drops below 1.2, repay 0.001 WETH of debt.", nodes, edges };
}

/** 5. Borrow Against Collateral -- only borrows if the account actually has borrowing power available. */
export function buildBorrowAgainstCollateralWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const { address: weth } = tokenInfo(cfg.network, "WETH");
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("account-data", 200, { actionType: "aave-v3/get-user-account-data", network: cfg.network, user: cfg.user }),
    conditionNode("borrow-power-check", 400, "{{@account-data:AccountData.availableBorrowsBase}} > 0"),
    actionNode("borrow", 600, {
      actionType: "aave-v3/borrow", network: cfg.network, asset: weth, amount: SMALL_AMOUNT, onBehalfOf: cfg.user, interestRateMode: "2", referralCode: "0",
    }),
  ];
  const edges: WorkflowEdge[] = [
    edge("trigger-1", "account-data"),
    edge("account-data", "borrow-power-check"),
    edge("borrow-power-check", "borrow", "true"),
  ];
  return { name: "borrow-against-collateral", description: "Manual: only borrow 0.001 WETH if the account has available borrowing power.", nodes, edges };
}

/** 6. Debt Position Monitor -- hourly check for any outstanding variable debt on the WETH reserve. */
export function buildDebtPositionMonitorWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const { address: weth } = tokenInfo(cfg.network, "WETH");
  const nodes: WorkflowNode[] = [
    scheduleTriggerNode("0 * * * *", "UTC"),
    actionNode("reserve-data", 200, { actionType: "aave-v3/get-user-reserve-data", network: cfg.network, asset: weth, user: cfg.user }),
    conditionNode("debt-check", 400, "{{@reserve-data:Reserve.currentVariableDebtTokenBalance}} > 0"),
    actionNode("log-debt", 600, { actionType: "web3/check-token-balance", network: cfg.network, address: cfg.user, tokenConfig: tokenConfig(cfg.network, "WETH") }),
  ];
  const edges: WorkflowEdge[] = [
    edge("trigger-1", "reserve-data"),
    edge("reserve-data", "debt-check"),
    edge("debt-check", "log-debt", "true"),
  ];
  return { name: "debt-position-monitor", description: "Hourly: check for any outstanding variable debt on the WETH reserve; log wallet balance if debt exists.", nodes, edges };
}

/** 7. Webhook Rebalance Trigger -- an external system calls the webhook to force a withdraw. */
export function buildWebhookRebalanceWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const { address: weth } = tokenInfo(cfg.network, "WETH");
  const nodes: WorkflowNode[] = [
    webhookTriggerNode(),
    actionNode("reserve-data", 200, { actionType: "aave-v3/get-user-reserve-data", network: cfg.network, asset: weth, user: cfg.user }),
    conditionNode("has-position", 400, "{{@reserve-data:Reserve.currentATokenBalance}} > 0"),
    actionNode("rebalance-withdraw", 600, { actionType: "aave-v3/withdraw", network: cfg.network, asset: weth, amount: SMALL_AMOUNT, to: cfg.user }),
  ];
  const edges: WorkflowEdge[] = [
    edge("trigger-1", "reserve-data"),
    edge("reserve-data", "has-position"),
    edge("has-position", "rebalance-withdraw", "true"),
  ];
  return { name: "webhook-rebalance-trigger", description: "External webhook call: if a supplied position exists, withdraw 0.001 WETH of it (stand-in for an off-chain rebalance signal).", nodes, edges };
}

/** 8. Block-Interval Sync -- fires every 50 Sepolia blocks (~10min at 12s/block), independent of wall-clock time. */
export function buildBlockIntervalSyncWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const nodes: WorkflowNode[] = [
    blockTriggerNode(cfg.network, "50"),
    actionNode("sync-balance", 200, { actionType: "web3/check-token-balance", network: cfg.network, address: cfg.user, tokenConfig: tokenConfig(cfg.network, "aWETH") }),
  ];
  const edges: WorkflowEdge[] = [edge("trigger-1", "sync-balance")];
  return { name: "block-interval-sync", description: "Every 50 Sepolia blocks: log the current aWETH balance -- a block-native alternative to a wall-clock schedule.", nodes, edges };
}

/** 9. Event-Triggered Supply Watch -- fires whenever ANY Supply event lands on the Aave V3 Pool, not just this wallet's own. */
export function buildEventTriggeredSupplyWatchWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const nodes: WorkflowNode[] = [
    eventTriggerNode(cfg.network, AAVE_V3_SEPOLIA_POOL, "Supply", AAVE_SUPPLY_EVENT_ABI),
    actionNode("log-own-balance", 200, { actionType: "web3/check-token-balance", network: cfg.network, address: cfg.user, tokenConfig: tokenConfig(cfg.network, "aWETH") }),
  ];
  const edges: WorkflowEdge[] = [edge("trigger-1", "log-own-balance")];
  return { name: "event-triggered-supply-watch", description: "Fires on every Supply event emitted by the Aave V3 Sepolia Pool (market-wide, not just this wallet); logs this wallet's own aWETH balance in response.", nodes, edges };
}

/** 10. Allowance Auditor -- catches the exact class of bug that broke `basic` earlier this session: a silently-exhausted approval. */
export function buildAllowanceAuditorWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const nodes: WorkflowNode[] = [
    scheduleTriggerNode("0 * * * *", "UTC"),
    actionNode("check-allowance", 200, {
      actionType: "web3/check-allowance", network: cfg.network, tokenConfig: tokenConfig(cfg.network, "WETH"), ownerAddress: cfg.user, spenderAddress: AAVE_V3_SEPOLIA_POOL,
    }),
    conditionNode("low-allowance", 400, "{{@check-allowance:Allowance.allowance}} < 5000000000000000"),
    actionNode("re-approve", 600, { actionType: "web3/approve-token", network: cfg.network, tokenConfig: tokenConfig(cfg.network, "WETH"), spenderAddress: AAVE_V3_SEPOLIA_POOL, amount: "max" }),
  ];
  const edges: WorkflowEdge[] = [
    edge("trigger-1", "check-allowance"),
    edge("check-allowance", "low-allowance"),
    edge("low-allowance", "re-approve", "true"),
  ];
  return { name: "allowance-auditor", description: "Hourly: check the Aave Pool's WETH allowance; if it has dropped below 0.005, re-approve unlimited. Prevents the exact 'missing revert data' failure the basic workflow hit live earlier.", nodes, edges };
}

/** 11. Multi-Asset Balance Snapshot -- both legs of the position (underlying + receipt token) in one run. */
export function buildMultiAssetBalanceSnapshotWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("weth-balance", 200, { actionType: "web3/check-token-balance", network: cfg.network, address: cfg.user, tokenConfig: tokenConfig(cfg.network, "WETH") }),
    actionNode("aweth-balance", 400, { actionType: "web3/check-token-balance", network: cfg.network, address: cfg.user, tokenConfig: tokenConfig(cfg.network, "aWETH") }),
  ];
  const edges: WorkflowEdge[] = [edge("trigger-1", "weth-balance"), edge("weth-balance", "aweth-balance")];
  return { name: "multi-asset-balance-snapshot", description: "Manual: log both WETH (idle) and aWETH (supplied) balances in one run.", nodes, edges };
}

/** 12. Collateral Safety Check -- only disables collateral if health factor can absorb it (health factor is checked, not simulated post-disable -- Aave doesn't expose a dry-run for this). */
export function buildCollateralSafetyCheckWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const { address: weth } = tokenInfo(cfg.network, "WETH");
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("account-data", 200, { actionType: "aave-v3/get-user-account-data", network: cfg.network, user: cfg.user }),
    conditionNode("safe-to-disable", 400, "{{@account-data:AccountData.healthFactor}} > 2000000000000000000"),
    actionNode("disable-collateral", 600, { actionType: "aave-v3/set-collateral", network: cfg.network, asset: weth, useAsCollateral: "false" }),
    actionNode("abort-log", 400, { actionType: "web3/check-balance", network: cfg.network, address: cfg.user }),
  ];
  const edges: WorkflowEdge[] = [
    edge("trigger-1", "account-data"),
    edge("account-data", "safe-to-disable"),
    edge("safe-to-disable", "disable-collateral", "true"),
    edge("safe-to-disable", "abort-log", "false"),
  ];
  return { name: "collateral-safety-check", description: "Manual: only disable WETH as collateral if health factor is comfortably above 2.0; otherwise abort and log.", nodes, edges };
}

/** 13. Repay Full Debt -- reads the exact current debt rather than a fixed amount, then repays it. */
export function buildRepayFullDebtWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const { address: weth } = tokenInfo(cfg.network, "WETH");
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("reserve-data", 200, { actionType: "aave-v3/get-user-reserve-data", network: cfg.network, asset: weth, user: cfg.user }),
    actionNode("repay-all", 400, {
      actionType: "aave-v3/repay", network: cfg.network, asset: weth,
      amount: "{{@reserve-data:Reserve.currentVariableDebtTokenBalance}}", onBehalfOf: cfg.user, interestRateMode: "2",
    }),
  ];
  const edges: WorkflowEdge[] = [edge("trigger-1", "reserve-data"), edge("reserve-data", "repay-all")];
  return { name: "repay-full-debt", description: "Manual: read the exact current variable debt balance and repay precisely that amount, not a guessed fixed amount.", nodes, edges };
}

/** 14. Borrow Then Track -- borrows, then immediately confirms both the new balance and the resulting health factor. */
export function buildBorrowThenTrackWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const { address: weth } = tokenInfo(cfg.network, "WETH");
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("borrow", 200, { actionType: "aave-v3/borrow", network: cfg.network, asset: weth, amount: SMALL_AMOUNT, onBehalfOf: cfg.user, interestRateMode: "2", referralCode: "0" }),
    actionNode("verify-balance", 400, { actionType: "web3/check-token-balance", network: cfg.network, address: cfg.user, tokenConfig: tokenConfig(cfg.network, "WETH") }),
    actionNode("confirm-health", 600, { actionType: "aave-v3/get-user-account-data", network: cfg.network, user: cfg.user }),
  ];
  const edges: WorkflowEdge[] = [edge("trigger-1", "borrow"), edge("borrow", "verify-balance"), edge("verify-balance", "confirm-health")];
  return { name: "borrow-then-track", description: "Manual: borrow 0.001 WETH, verify it landed in the wallet, then confirm the resulting account health factor.", nodes, edges };
}

/** 15. Position Health Dashboard Feed -- the richest read-only snapshot: account health + both balances, every 15min. */
export function buildPositionHealthDashboardFeedWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const nodes: WorkflowNode[] = [
    scheduleTriggerNode("*/15 * * * *", "UTC"),
    actionNode("account-data", 200, { actionType: "aave-v3/get-user-account-data", network: cfg.network, user: cfg.user }),
    actionNode("weth-balance", 400, { actionType: "web3/check-token-balance", network: cfg.network, address: cfg.user, tokenConfig: tokenConfig(cfg.network, "WETH") }),
    actionNode("aweth-balance", 600, { actionType: "web3/check-token-balance", network: cfg.network, address: cfg.user, tokenConfig: tokenConfig(cfg.network, "aWETH") }),
  ];
  const edges: WorkflowEdge[] = [edge("trigger-1", "account-data"), edge("account-data", "weth-balance"), edge("weth-balance", "aweth-balance")];
  return { name: "position-health-dashboard-feed", description: "Every 15min: account health factor + both WETH and aWETH balances in one run -- feed for a live dashboard.", nodes, edges };
}

/** 16. Pre-Migration Safety Gate -- what `basic`'s withdraw-source SHOULD be preceded by: a health check before ever touching the position. */
export function buildPreMigrationSafetyGateWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const { address: weth } = tokenInfo(cfg.network, "WETH");
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("account-data", 200, { actionType: "aave-v3/get-user-account-data", network: cfg.network, user: cfg.user }),
    conditionNode("safe-to-migrate", 400, "{{@account-data:AccountData.healthFactor}} > 1100000000000000000"),
    actionNode("withdraw", 600, { actionType: "aave-v3/withdraw", network: cfg.network, asset: weth, amount: SMALL_AMOUNT, to: cfg.user }),
    actionNode("abort-log", 400, { actionType: "web3/check-balance", network: cfg.network, address: cfg.user }),
  ];
  const edges: WorkflowEdge[] = [
    edge("trigger-1", "account-data"),
    edge("account-data", "safe-to-migrate"),
    edge("safe-to-migrate", "withdraw", "true"),
    edge("safe-to-migrate", "abort-log", "false"),
  ];
  return { name: "pre-migration-safety-gate", description: "Manual: only withdraw 0.001 WETH if health factor is above 1.1 first; otherwise abort and log -- a health check `basic` itself doesn't have.", nodes, edges };
}

/** 17. Gas Buffer Guardian -- native ETH, not WETH: makes sure the wallet can still afford to pay for the NEXT transaction. */
export function buildGasBufferGuardianWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const nodes: WorkflowNode[] = [
    scheduleTriggerNode("0 * * * *", "UTC"),
    actionNode("gas-balance", 200, { actionType: "web3/check-balance", network: cfg.network, address: cfg.user }),
    conditionNode("low-gas", 400, "{{@gas-balance:Balance.balance}} < 0.001"),
    actionNode("flag-low-gas", 600, { actionType: "web3/check-balance", network: cfg.network, address: cfg.user }),
  ];
  const edges: WorkflowEdge[] = [
    edge("trigger-1", "gas-balance"),
    edge("gas-balance", "low-gas"),
    edge("low-gas", "flag-low-gas", "true"),
  ];
  return { name: "gas-buffer-guardian", description: "Hourly: check native ETH balance; if below 0.001, flag it -- every other workflow here needs gas to run at all.", nodes, edges };
}

/** 18. Full Position Report -- everything readable about this position in one workflow: account health, reserve detail, both balances. */
export function buildFullPositionReportWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const { address: weth } = tokenInfo(cfg.network, "WETH");
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("account-data", 200, { actionType: "aave-v3/get-user-account-data", network: cfg.network, user: cfg.user }),
    actionNode("reserve-data", 400, { actionType: "aave-v3/get-user-reserve-data", network: cfg.network, asset: weth, user: cfg.user }),
    actionNode("aweth-balance", 600, { actionType: "web3/check-token-balance", network: cfg.network, address: cfg.user, tokenConfig: tokenConfig(cfg.network, "aWETH") }),
    actionNode("weth-balance", 800, { actionType: "web3/check-token-balance", network: cfg.network, address: cfg.user, tokenConfig: tokenConfig(cfg.network, "WETH") }),
  ];
  const edges: WorkflowEdge[] = [
    edge("trigger-1", "account-data"),
    edge("account-data", "reserve-data"),
    edge("reserve-data", "aweth-balance"),
    edge("aweth-balance", "weth-balance"),
  ];
  return { name: "full-position-report", description: "Manual: the complete readable position in one run -- account health, per-reserve detail, both balances.", nodes, edges };
}

/** 19. Re-enable Collateral After Repay -- pairs a repay with restoring the reserve's collateral flag, in one workflow. */
export function buildReenableCollateralAfterRepayWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const { address: weth } = tokenInfo(cfg.network, "WETH");
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("repay", 200, { actionType: "aave-v3/repay", network: cfg.network, asset: weth, amount: SMALL_AMOUNT, onBehalfOf: cfg.user, interestRateMode: "2" }),
    actionNode("re-enable-collateral", 400, { actionType: "aave-v3/set-collateral", network: cfg.network, asset: weth, useAsCollateral: "true" }),
  ];
  const edges: WorkflowEdge[] = [edge("trigger-1", "repay"), edge("repay", "re-enable-collateral")];
  return { name: "re-enable-collateral-after-repay", description: "Manual: repay 0.001 WETH of debt, then re-enable WETH as collateral in the same run.", nodes, edges };
}

/** 20. Emergency Debt Clear -- emergency-exit's counterpart for the debt side: only acts if there's actually debt to clear. */
export function buildEmergencyDebtClearWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const { address: weth } = tokenInfo(cfg.network, "WETH");
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("reserve-data", 200, { actionType: "aave-v3/get-user-reserve-data", network: cfg.network, asset: weth, user: cfg.user }),
    conditionNode("has-debt", 400, "{{@reserve-data:Reserve.currentVariableDebtTokenBalance}} > 0"),
    actionNode("repay-all", 600, {
      actionType: "aave-v3/repay", network: cfg.network, asset: weth,
      amount: "{{@reserve-data:Reserve.currentVariableDebtTokenBalance}}", onBehalfOf: cfg.user, interestRateMode: "2",
    }),
    actionNode("log-no-debt", 400, { actionType: "web3/check-token-balance", network: cfg.network, address: cfg.user, tokenConfig: tokenConfig(cfg.network, "WETH") }),
  ];
  const edges: WorkflowEdge[] = [
    edge("trigger-1", "reserve-data"),
    edge("reserve-data", "has-debt"),
    edge("has-debt", "repay-all", "true"),
    edge("has-debt", "log-no-debt", "false"),
  ];
  return { name: "emergency-debt-clear", description: "Manual panic button for the debt side: if any variable debt exists on WETH, repay it in full; otherwise log that there was nothing to clear.", nodes, edges };
}

/* ------------------------------------------------------------------------
 * LEVERAGE PAIR -- the 25 workflows above (5 core + 20 features) each call
 * exactly one Aave V3 write action per "leg." These two chain THREE writes
 * (supply -> borrow -> supply, and its inverse) into a single recursive
 * leverage loop -- a real DeFi primitive (looping the same collateral
 * asset to amplify exposure), not another balance-check permutation.
 * WETH is used on both legs (collateral AND the borrowed asset) because
 * it's the only funded Sepolia reserve this project has verified live;
 * that's honest about what's actually being demonstrated here, not a
 * claim this is a profitable production strategy (borrowing the same
 * asset you supplied has no yield differential -- the point is the
 * mechanism, not the economics).
 * ------------------------------------------------------------------------ */

/** WORKFLOW -- Leverage Loop: supply -> check borrowing power -> borrow -> re-supply the borrowed amount -> confirm resulting health factor. */
export function buildLeverageLoopWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const { address: weth } = tokenInfo(cfg.network, "WETH");
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("supply-initial", 200, { actionType: "aave-v3/supply", network: cfg.network, asset: weth, amount: SMALL_AMOUNT, onBehalfOf: cfg.user, referralCode: "0" }),
    actionNode("account-check", 400, { actionType: "aave-v3/get-user-account-data", network: cfg.network, user: cfg.user }),
    conditionNode("has-borrow-power", 600, "{{@account-check:AccountData.availableBorrowsBase}} > 0"),
    actionNode("borrow-against", 800, { actionType: "aave-v3/borrow", network: cfg.network, asset: weth, amount: SMALL_AMOUNT, onBehalfOf: cfg.user, interestRateMode: "2", referralCode: "0" }),
    actionNode("supply-borrowed", 1000, { actionType: "aave-v3/supply", network: cfg.network, asset: weth, amount: SMALL_AMOUNT, onBehalfOf: cfg.user, referralCode: "0" }),
    actionNode("confirm-leverage", 1200, { actionType: "aave-v3/get-user-account-data", network: cfg.network, user: cfg.user }),
  ];
  const edges: WorkflowEdge[] = [
    edge("trigger-1", "supply-initial"),
    edge("supply-initial", "account-check"),
    edge("account-check", "has-borrow-power"),
    edge("has-borrow-power", "borrow-against", "true"),
    edge("borrow-against", "supply-borrowed"),
    edge("supply-borrowed", "confirm-leverage"),
  ];
  return {
    name: "leverage-loop",
    description: "Supply 0.001 WETH, borrow 0.001 WETH against it (only if borrowing power allows), re-supply the borrowed amount, then confirm the resulting health factor -- one recursive leverage loop.",
    nodes,
    edges,
  };
}

/** WORKFLOW -- Deleverage: reads the LIVE debt balance and repays exactly that, then withdraws the extra collateral the loop above added. */
export function buildDeleverageWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const { address: weth } = tokenInfo(cfg.network, "WETH");
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("reserve-check", 200, { actionType: "aave-v3/get-user-reserve-data", network: cfg.network, asset: weth, user: cfg.user }),
    actionNode("repay-debt", 400, {
      actionType: "aave-v3/repay", network: cfg.network, asset: weth,
      amount: "{{@reserve-check:Reserve.currentVariableDebtTokenBalance}}", onBehalfOf: cfg.user, interestRateMode: "2",
    }),
    actionNode("withdraw-extra", 600, { actionType: "aave-v3/withdraw", network: cfg.network, asset: weth, amount: SMALL_AMOUNT, to: cfg.user }),
    actionNode("confirm-unwound", 800, { actionType: "aave-v3/get-user-account-data", network: cfg.network, user: cfg.user }),
  ];
  const edges: WorkflowEdge[] = [
    edge("trigger-1", "reserve-check"),
    edge("reserve-check", "repay-debt"),
    edge("repay-debt", "withdraw-extra"),
    edge("withdraw-extra", "confirm-unwound"),
  ];
  return {
    name: "deleverage",
    description: "Unwind the leverage loop: repay the exact live variable debt balance, withdraw the extra 0.001 WETH the loop supplied, then confirm the resulting health factor.",
    nodes,
    edges,
  };
}

/* ------------------------------------------------------------------------
 * MULTI-PROTOCOL INTEGRATIONS -- 11 more workflows spanning oracles
 * (Chainlink, Chronicle), other lending/DeFi protocols (Lido, Uniswap V3,
 * Morpho), a compute primitive (Math), and notifications (Discord, Slack,
 * Telegram, Email).
 *
 * Every protocol/action pair below was LIVE-TESTED against Sepolia before
 * being used here, the same way Aave V4 and Morpho markets were tested
 * and ruled out earlier in this project -- registry presence in
 * list_action_schemas does NOT mean a chain actually has that protocol
 * deployed. Confirmed working live: chainlink (price feeds), chronicle
 * (price feeds), wrapped (canonical WETH9), lido (stETH/wstETH),
 * uniswap-v3 (position NFT balance), morpho (is-authorized -- the core
 * contract exists even though no usable market does, per the earlier
 * investigation). Confirmed NOT deployed on Sepolia via real 400 errors
 * naming the missing contract: aave-v4, aerodrome, ajna, cowswap, curve,
 * ethena, frax-ether-v2, pendle, rocket-pool, sky, spark.
 *
 * `code/run-code`, `webhook/send-webhook`, and every `blockscout/*` action
 * were also tried here first -- all three are real KeeperHub features,
 * but `create_workflow` rejected all three live with a genuine 402
 * "requires a paid plan" (this account is on KeeperHub's free tier), so
 * the workflows below were redesigned to not depend on them (see the
 * comments on `chainlink-eth-price-monitor` and `oracle-cross-check`).
 * See the "Discovered but out of scope" README section for the full list
 * with each item's specific reason.
 * ------------------------------------------------------------------------ */

/**
 * WORKFLOW -- Chainlink ETH Price Monitor: real Sepolia price feed, hourly.
 * Originally piped the raw answer through a `code/run-code` node to format
 * it to USD -- `create_workflow` rejected that live with a real 402
 * "This workflow uses features that require a paid plan" naming
 * `code/run-code` specifically (this KeeperHub account is on the free
 * tier). Kept as a plain oracle read rather than force a paid feature in;
 * `answer` is already a real, live, verified value (confirmed via a
 * direct execute_protocol_action call before this was ever built as a
 * workflow) even unformatted.
 */
export function buildChainlinkPriceMonitorWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const nodes: WorkflowNode[] = [
    scheduleTriggerNode("0 * * * *", "UTC"),
    actionNode("get-price", 200, { actionType: "chainlink/eth-usd-latest-round-data", network: cfg.network }),
  ];
  const edges: WorkflowEdge[] = [edge("trigger-1", "get-price")];
  return { name: "chainlink-eth-price-monitor", description: "Hourly: read the real Chainlink ETH/USD Sepolia price feed.", nodes, edges };
}

/**
 * WORKFLOW -- Oracle Cross-Check: reads the SAME ETH/USD price from two
 * independent, live-verified Sepolia oracles (Chainlink and Chronicle)
 * side by side. Originally computed the percentage difference between
 * them via a `code/run-code` node -- same 402 paid-plan rejection as
 * above, so the comparison itself is left to whoever reads the two
 * outputs rather than a Code node; the real value here is that BOTH
 * numbers come from independently deployed Sepolia oracle contracts.
 */
export function buildOracleCrossCheckWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("chainlink-price", 200, { actionType: "chainlink/eth-usd-latest-round-data", network: cfg.network }),
    actionNode("chronicle-price", 400, { actionType: "chronicle/eth-usd-read", network: cfg.network }),
  ];
  const edges: WorkflowEdge[] = [edge("trigger-1", "chainlink-price"), edge("chainlink-price", "chronicle-price")];
  return { name: "oracle-cross-check", description: "Manual: reads ETH/USD from both Chainlink and Chronicle -- two independently deployed Sepolia price oracles -- side by side.", nodes, edges };
}

/** WORKFLOW -- Canonical WETH Balance Check: KeeperHub's generic `wrapped/*` actions target Sepolia's canonical WETH9 (0xfFf997...), a DIFFERENT contract from the Aave reserve WETH (0xC558DB...) this whole project runs on. Confirmed live: this wallet's balance there is 0, since every wrap this project has done went through the Aave reserve token directly. */
export function buildCanonicalWethBalanceCheckWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("check-canonical-weth", 200, { actionType: "wrapped/balance-of", network: cfg.network, account: cfg.user }),
  ];
  const edges: WorkflowEdge[] = [edge("trigger-1", "check-canonical-weth")];
  return { name: "canonical-weth-balance-check", description: "Manual: checks the balance on Sepolia's CANONICAL WETH9 contract -- a different, separate contract from the Aave reserve WETH this project's position lives in. Documents the 'no single WETH' lesson from a second angle.", nodes, edges };
}

/** WORKFLOW -- Lido Position Check: stETH and wstETH are real, deployed contracts on Sepolia (confirmed live), independent of this project's Aave position. */
export function buildLidoPositionCheckWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("steth-balance", 200, { actionType: "lido/get-steth-balance", network: cfg.network, account: cfg.user }),
    actionNode("wsteth-balance", 400, { actionType: "lido/get-wsteth-balance", network: cfg.network, account: cfg.user }),
  ];
  const edges: WorkflowEdge[] = [edge("trigger-1", "steth-balance"), edge("steth-balance", "wsteth-balance")];
  return { name: "lido-position-check", description: "Manual: checks stETH and wstETH balances on Sepolia's real, live Lido deployment.", nodes, edges };
}

/** WORKFLOW -- Uniswap V3 LP Position Count: the position-NFT manager is deployed on Sepolia; balance-of counts how many LP position NFTs this wallet owns (0, since this project has never opened one). */
export function buildUniswapLpPositionCountWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("lp-count", 200, { actionType: "uniswap/balance-of", network: cfg.network, owner: cfg.user }),
  ];
  const edges: WorkflowEdge[] = [edge("trigger-1", "lp-count")];
  return { name: "uniswap-lp-position-count", description: "Manual: counts how many Uniswap V3 LP position NFTs this wallet owns on Sepolia.", nodes, edges };
}

/** WORKFLOW -- Morpho Authorization Check: the Morpho Blue core contract IS deployed on Sepolia (confirmed live) even though the one market this project investigated earlier was never usable -- this checks the separate on-chain authorization system, not a market position. */
export function buildMorphoAuthorizationCheckWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("check-auth", 200, { actionType: "morpho/is-authorized", network: cfg.network, authorizer: cfg.user, authorized: cfg.user }),
  ];
  const edges: WorkflowEdge[] = [edge("trigger-1", "check-auth")];
  return { name: "morpho-authorization-check", description: "Manual: checks this wallet's Morpho Blue on-chain authorization status -- the core Morpho contract is real and deployed on Sepolia, independent of whether any market on it is usable.", nodes, edges };
}

/** WORKFLOW -- Position Value Aggregator: combines two real balance reads with a Math node instead of manual addition. */
export function buildPositionValueAggregatorWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("weth-balance", 200, { actionType: "web3/check-token-balance", network: cfg.network, address: cfg.user, tokenConfig: tokenConfig(cfg.network, "WETH") }),
    actionNode("aweth-balance", 400, { actionType: "web3/check-token-balance", network: cfg.network, address: cfg.user, tokenConfig: tokenConfig(cfg.network, "aWETH") }),
    actionNode("total-value", 600, {
      actionType: "math/aggregate",
      operation: "sum",
      inputMode: "explicit",
      explicitValues: "{{@weth-balance:Balance.balance.balanceRaw}}\n{{@aweth-balance:Balance.balance.balanceRaw}}",
    }),
  ];
  const edges: WorkflowEdge[] = [edge("trigger-1", "weth-balance"), edge("weth-balance", "aweth-balance"), edge("aweth-balance", "total-value")];
  return { name: "position-value-aggregator", description: "Manual: reads WETH (idle) and aWETH (supplied) balances, then sums them via a Math node into one total WETH-denominated position value.", nodes, edges };
}

/** Shared health-check preface for the 4 messaging workflows below -- none of these are executed: this KeeperHub account has no Discord/Slack/Telegram/SendGrid integration configured (confirmed via a live list_integrations call, which shows only the wallet integration), so a real send would fail even though the workflow itself is structurally valid. */
function messagingCfg(cfg: MonitorConfig) {
  return { network: cfg.network, user: cfg.user };
}

/** WORKFLOW -- Discord Health Alert (structural only; needs a Discord integration configured in your KeeperHub account). */
export function buildDiscordHealthAlertWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const c = messagingCfg(cfg);
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("account-data", 200, { actionType: "aave-v3/get-user-account-data", network: c.network, user: c.user }),
    actionNode("send-discord", 400, { actionType: "discord/send-message", discordMessage: "MigrateX health factor: {{@account-data:AccountData.healthFactor}}" }),
  ];
  const edges: WorkflowEdge[] = [edge("trigger-1", "account-data"), edge("account-data", "send-discord")];
  return { name: "discord-health-alert", description: "Manual: posts the current Aave V3 health factor to Discord. Needs a Discord integration configured in your KeeperHub account to actually send.", nodes, edges };
}

/** WORKFLOW -- Slack Health Alert (structural only; needs a Slack integration configured in your KeeperHub account). */
export function buildSlackHealthAlertWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const c = messagingCfg(cfg);
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("account-data", 200, { actionType: "aave-v3/get-user-account-data", network: c.network, user: c.user }),
    actionNode("send-slack", 400, { actionType: "slack/send-message", slackChannel: "#migratex-alerts", slackMessage: "MigrateX health factor: {{@account-data:AccountData.healthFactor}}" }),
  ];
  const edges: WorkflowEdge[] = [edge("trigger-1", "account-data"), edge("account-data", "send-slack")];
  return { name: "slack-health-alert", description: "Manual: posts the current Aave V3 health factor to Slack. Needs a Slack integration configured in your KeeperHub account to actually send.", nodes, edges };
}

/** WORKFLOW -- Telegram Health Alert (structural only; needs a Telegram integration configured in your KeeperHub account). */
export function buildTelegramHealthAlertWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const c = messagingCfg(cfg);
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("account-data", 200, { actionType: "aave-v3/get-user-account-data", network: c.network, user: c.user }),
    actionNode("send-telegram", 400, { actionType: "telegram/send-message", chatId: "@migratex_alerts", message: "MigrateX health factor: {{@account-data:AccountData.healthFactor}}" }),
  ];
  const edges: WorkflowEdge[] = [edge("trigger-1", "account-data"), edge("account-data", "send-telegram")];
  return { name: "telegram-health-alert", description: "Manual: posts the current Aave V3 health factor to Telegram. Needs a Telegram integration configured in your KeeperHub account to actually send.", nodes, edges };
}

/** WORKFLOW -- Email Health Alert via SendGrid (structural only; needs a SendGrid integration configured in your KeeperHub account). */
export function buildEmailHealthAlertWorkflow(cfg: MonitorConfig): KeeperHubWorkflow {
  const c = messagingCfg(cfg);
  const nodes: WorkflowNode[] = [
    triggerNode(),
    actionNode("account-data", 200, { actionType: "aave-v3/get-user-account-data", network: c.network, user: c.user }),
    actionNode("send-email", 400, {
      actionType: "sendgrid/send-email",
      emailTo: "alerts@example.com",
      emailSubject: "MigrateX health alert",
      emailBody: "MigrateX health factor: {{@account-data:AccountData.healthFactor}}",
    }),
  ];
  const edges: WorkflowEdge[] = [edge("trigger-1", "account-data"), edge("account-data", "send-email")];
  return { name: "email-health-alert", description: "Manual: emails the current Aave V3 health factor via SendGrid. Needs a SendGrid integration configured in your KeeperHub account to actually send.", nodes, edges };
}
