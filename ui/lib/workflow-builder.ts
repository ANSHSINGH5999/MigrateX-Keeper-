// Copy of orchestrator/src/workflow-builder.ts -- Turbopack won't resolve imports outside ui/'s project root, so this is duplicated rather than shared.
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

function actionNode(id: string, y: number, config: Record<string, unknown>): WorkflowNode {
  return {
    id,
    type: "action",
    position: { x: 0, y },
    data: { type: "action", config },
  };
}

function edge(source: string, target: string): WorkflowEdge {
  return { id: `${source}-${target}`, source, target };
}

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
 * 5-node linear graph (no threshold/condition gating, per spec):
 *   trigger-1 -> withdraw-source -> verify-withdraw -> supply-target -> verify-supply
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
    edge("verify-withdraw", "supply-target"),
    edge("supply-target", "verify-supply"),
  ];

  return {
    name: `migrate-${plan.token}-aave-v3-to-aave-v3`,
    description: `Migrate ${plan.amount} ${plan.token} within Aave V3 on chain ${plan.network}`,
    nodes,
    edges,
  };
}
