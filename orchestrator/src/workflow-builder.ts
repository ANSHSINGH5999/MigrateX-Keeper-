import type { KeeperHubWorkflow, MigrationPlan, WorkflowEdge, WorkflowNode } from "./types.js";

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
 * 6-node linear graph:
 *   trigger-1 -> withdraw-source -> verify-withdraw -> approve-aave -> supply-target -> verify-supply
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
  ];

  const edges: WorkflowEdge[] = [
    edge("trigger-1", "withdraw-source"),
    edge("withdraw-source", "verify-withdraw"),
    edge("verify-withdraw", "approve-aave"),
    edge("approve-aave", "supply-target"),
    edge("supply-target", "verify-supply"),
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
