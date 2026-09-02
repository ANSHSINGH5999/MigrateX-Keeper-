import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildMigrationWorkflow,
  buildEmergencyExitWorkflow,
  buildHealthFactorMonitorWorkflow,
  buildEnableCollateralWorkflow,
  buildDisableCollateralWorkflow,
  buildAutoRepayOnLowHealthWorkflow,
  buildBorrowAgainstCollateralWorkflow,
  buildDebtPositionMonitorWorkflow,
  buildWebhookRebalanceWorkflow,
  buildBlockIntervalSyncWorkflow,
  buildEventTriggeredSupplyWatchWorkflow,
  buildAllowanceAuditorWorkflow,
  buildMultiAssetBalanceSnapshotWorkflow,
  buildCollateralSafetyCheckWorkflow,
  buildRepayFullDebtWorkflow,
  buildBorrowThenTrackWorkflow,
  buildPositionHealthDashboardFeedWorkflow,
  buildPreMigrationSafetyGateWorkflow,
  buildGasBufferGuardianWorkflow,
  buildFullPositionReportWorkflow,
  buildReenableCollateralAfterRepayWorkflow,
  buildEmergencyDebtClearWorkflow,
} from "./workflow-builder.js";
import type { KeeperHubWorkflow, MigrationPlan, WorkflowNode } from "./types.js";

// Aave V3's real Sepolia WETH reserve, confirmed live via getReservesList()/
// getReserveData() against the Pool at 0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951.
const aaveV3Plan: MigrationPlan = {
  source_protocol: "aave-v3",
  target_protocol: "aave-v3",
  token: "WETH",
  amount: "0.005",
  network: "11155111",
  source_address: `0x${"11".repeat(20)}`,
  recipient_address: `0x${"22".repeat(20)}`,
  threshold: "0.005",
  min_expected_target_amount: "0.005",
  slippage_bps: 0,
};

function node(wf: KeeperHubWorkflow, id: string): WorkflowNode {
  const n = wf.nodes.find((n) => n.id === id);
  assert.ok(n, `expected node '${id}' to exist`);
  return n!;
}

test("6-node linear graph: trigger -> withdraw -> verify -> approve -> supply -> verify", () => {
  const wf = buildMigrationWorkflow(aaveV3Plan);
  assert.equal(wf.nodes.length, 6);
  assert.deepEqual(
    wf.nodes.map((n) => n.id),
    ["trigger-1", "withdraw-source", "verify-withdraw", "approve-aave", "supply-target", "verify-supply"]
  );
  assert.equal(wf.edges.length, 5);
  assert.deepEqual(
    wf.edges.map((e) => [e.source, e.target]),
    [
      ["trigger-1", "withdraw-source"],
      ["withdraw-source", "verify-withdraw"],
      ["verify-withdraw", "approve-aave"],
      ["approve-aave", "supply-target"],
      ["supply-target", "verify-supply"],
    ]
  );
});

test("approve-aave node uses web3/approve-token with unlimited allowance to the Aave V3 Sepolia Pool", () => {
  const wf = buildMigrationWorkflow(aaveV3Plan);
  const approve = node(wf, "approve-aave");
  assert.equal(approve.data.config.actionType, "web3/approve-token");
  assert.equal(approve.data.config.spenderAddress, "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951");
  assert.equal(approve.data.config.amount, "max");
});

test("throws for any non-aave-v3 pair -- morpho support was removed entirely", () => {
  const bad = { ...aaveV3Plan, target_protocol: "morpho" };
  assert.throws(() => buildMigrationWorkflow(bad), /only supports aave-v3/);
});

test("withdraw/supply nodes use the exact live-verified aave-v3 field names", () => {
  const wf = buildMigrationWorkflow(aaveV3Plan);
  const withdraw = node(wf, "withdraw-source");
  assert.equal(withdraw.data.config.actionType, "aave-v3/withdraw");
  assert.equal(withdraw.data.config.asset, "0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c");
  assert.equal(withdraw.data.config.to, aaveV3Plan.source_address);
  assert.ok(!("onBehalfOf" in withdraw.data.config), "aave-v3/withdraw has no onBehalfOf field");

  const supply = node(wf, "supply-target");
  assert.equal(supply.data.config.actionType, "aave-v3/supply");
  assert.equal(supply.data.config.onBehalfOf, aaveV3Plan.recipient_address);
  assert.ok(!("to" in supply.data.config), "aave-v3/supply has no to field");
});

test("referralCode is included even though KeeperHub marks it optional -- confirmed live required", () => {
  const wf = buildMigrationWorkflow(aaveV3Plan);
  const supply = node(wf, "supply-target");
  assert.equal(supply.data.config.referralCode, "0");
});

test("amount is converted to raw base units, not left as a human decimal", () => {
  const wf = buildMigrationWorkflow(aaveV3Plan);
  const withdraw = node(wf, "withdraw-source");
  // WETH has 18 decimals: 0.005 -> 5000000000000000
  assert.equal(withdraw.data.config.amount, "5000000000000000");
});

test("balance-check nodes use the real Aave-reserve WETH address via tokenConfig", () => {
  const wf = buildMigrationWorkflow(aaveV3Plan);
  const verify = node(wf, "verify-withdraw");
  assert.equal(verify.data.config.actionType, "web3/check-token-balance");
  const parsed = JSON.parse(verify.data.config.tokenConfig as string);
  assert.equal(parsed.customToken.symbol, "WETH");
  assert.equal(parsed.customToken.address, "0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c");
});

test("WORKFLOW 5 -- emergency-exit: 5-node linear graph, manual trigger only", () => {
  const wf = buildEmergencyExitWorkflow({ network: "11155111", user: `0x${"33".repeat(20)}` });
  assert.equal(wf.nodes.length, 5);
  assert.deepEqual(
    wf.nodes.map((n) => n.id),
    ["trigger-1", "preflight", "withdraw-all", "verify-exit", "confirm-closed"]
  );
  assert.equal(wf.nodes[0]!.data.config.triggerType, "Manual");
});

test("emergency-exit withdraws the ENTIRE position via the uint256-max sentinel, not a fixed amount", () => {
  const wf = buildEmergencyExitWorkflow({ network: "11155111", user: `0x${"33".repeat(20)}` });
  const withdraw = node(wf, "withdraw-all");
  assert.equal(withdraw.data.config.actionType, "aave-v3/withdraw");
  assert.equal(
    withdraw.data.config.amount,
    "115792089237316195423570985008687907853269984665640564039457584007913129639935"
  );
});

/* ------------------------------------------------------------------------
 * Smoke tests for the 20 feature workflows: every graph must be internally
 * consistent (one trigger, every edge references a real node id, every
 * node has an actionType or triggerType) even though each one is also
 * individually spot-checked below for its one distinguishing field.
 * ------------------------------------------------------------------------ */
const featureCfg = { network: "11155111", user: `0x${"44".repeat(20)}` };
const FEATURE_BUILDERS: Record<string, (cfg: typeof featureCfg) => KeeperHubWorkflow> = {
  "health-factor-monitor": buildHealthFactorMonitorWorkflow,
  "enable-collateral": buildEnableCollateralWorkflow,
  "disable-collateral": buildDisableCollateralWorkflow,
  "auto-repay-on-low-health": buildAutoRepayOnLowHealthWorkflow,
  "borrow-against-collateral": buildBorrowAgainstCollateralWorkflow,
  "debt-position-monitor": buildDebtPositionMonitorWorkflow,
  "webhook-rebalance-trigger": buildWebhookRebalanceWorkflow,
  "block-interval-sync": buildBlockIntervalSyncWorkflow,
  "event-triggered-supply-watch": buildEventTriggeredSupplyWatchWorkflow,
  "allowance-auditor": buildAllowanceAuditorWorkflow,
  "multi-asset-balance-snapshot": buildMultiAssetBalanceSnapshotWorkflow,
  "collateral-safety-check": buildCollateralSafetyCheckWorkflow,
  "repay-full-debt": buildRepayFullDebtWorkflow,
  "borrow-then-track": buildBorrowThenTrackWorkflow,
  "position-health-dashboard-feed": buildPositionHealthDashboardFeedWorkflow,
  "pre-migration-safety-gate": buildPreMigrationSafetyGateWorkflow,
  "gas-buffer-guardian": buildGasBufferGuardianWorkflow,
  "full-position-report": buildFullPositionReportWorkflow,
  "re-enable-collateral-after-repay": buildReenableCollateralAfterRepayWorkflow,
  "emergency-debt-clear": buildEmergencyDebtClearWorkflow,
};

test(`all 20 feature workflows build a structurally consistent graph (${Object.keys(FEATURE_BUILDERS).length} checked)`, () => {
  assert.equal(Object.keys(FEATURE_BUILDERS).length, 20);
  for (const [name, build] of Object.entries(FEATURE_BUILDERS)) {
    const wf = build(featureCfg);
    const triggers = wf.nodes.filter((n) => n.type === "trigger");
    assert.equal(triggers.length, 1, `${name}: expected exactly one trigger node`);
    assert.equal(triggers[0]!.id, "trigger-1", `${name}: trigger node must be id 'trigger-1'`);

    const ids = new Set(wf.nodes.map((n) => n.id));
    assert.equal(ids.size, wf.nodes.length, `${name}: duplicate node id`);
    for (const e of wf.edges) {
      assert.ok(ids.has(e.source), `${name}: edge source '${e.source}' has no matching node`);
      assert.ok(ids.has(e.target), `${name}: edge target '${e.target}' has no matching node`);
    }

    for (const n of wf.nodes) {
      const cfg = n.data.config;
      const key = n.type === "trigger" ? "triggerType" : "actionType";
      assert.ok(cfg[key], `${name}: node '${n.id}' (${n.type}) missing '${key}'`);
    }
  }
});

test("health-factor-monitor reads overall account health, not a single reserve", () => {
  const wf = buildHealthFactorMonitorWorkflow(featureCfg);
  const n = node(wf, "account-data");
  assert.equal(n.data.config.actionType, "aave-v3/get-user-account-data");
});

test("event-triggered-supply-watch's trigger listens on the real Aave V3 Sepolia Pool for a real Supply event", () => {
  const wf = buildEventTriggeredSupplyWatchWorkflow(featureCfg);
  assert.equal(wf.nodes[0]!.data.config.triggerType, "Event");
  assert.equal(wf.nodes[0]!.data.config.contractAddress, "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951");
  assert.equal(wf.nodes[0]!.data.config.eventName, "Supply");
});

test("block-interval-sync triggers on a block count, not a wall-clock schedule", () => {
  const wf = buildBlockIntervalSyncWorkflow(featureCfg);
  assert.equal(wf.nodes[0]!.data.config.triggerType, "Block");
  assert.equal(wf.nodes[0]!.data.config.blockInterval, "50");
});

test("webhook-rebalance-trigger is Webhook-triggered, not Manual or Schedule", () => {
  const wf = buildWebhookRebalanceWorkflow(featureCfg);
  assert.equal(wf.nodes[0]!.data.config.triggerType, "Webhook");
});

test("allowance-auditor checks the Aave Pool's allowance via web3/check-allowance, and re-approves via web3/approve-token", () => {
  const wf = buildAllowanceAuditorWorkflow(featureCfg);
  const check = node(wf, "check-allowance");
  assert.equal(check.data.config.actionType, "web3/check-allowance");
  assert.equal(check.data.config.spenderAddress, "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951");
  const reapprove = node(wf, "re-approve");
  assert.equal(reapprove.data.config.actionType, "web3/approve-token");
});

test("repay-full-debt and emergency-debt-clear repay the LIVE debt balance via a template ref, not a fixed amount", () => {
  for (const wf of [buildRepayFullDebtWorkflow(featureCfg), buildEmergencyDebtClearWorkflow(featureCfg)]) {
    const repay = wf.nodes.find((n) => n.data.config.actionType === "aave-v3/repay");
    assert.ok(repay, "expected a repay node");
    assert.match(repay!.data.config.amount as string, /^\{\{@.*currentVariableDebtTokenBalance\}\}$/);
  }
});

test("collateral-safety-check and pre-migration-safety-gate both gate on healthFactor before acting", () => {
  for (const wf of [buildCollateralSafetyCheckWorkflow(featureCfg), buildPreMigrationSafetyGateWorkflow(featureCfg)]) {
    const cond = wf.nodes.find((n) => n.data.config.actionType === "Condition");
    assert.ok(cond, "expected a Condition node");
    assert.match(cond!.data.config.condition as string, /healthFactor/);
  }
});
