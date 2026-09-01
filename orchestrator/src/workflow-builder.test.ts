import { test } from "node:test";
import assert from "node:assert/strict";

import { buildMigrationWorkflow } from "./workflow-builder.js";
import type { MigrationPlan, WorkflowNode } from "./types.js";

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

function node(wf: ReturnType<typeof buildMigrationWorkflow>, id: string): WorkflowNode {
  const n = wf.nodes.find((n) => n.id === id);
  assert.ok(n, `expected node '${id}' to exist`);
  return n!;
}

test("5-node linear graph: trigger -> withdraw -> verify -> supply -> verify", () => {
  const wf = buildMigrationWorkflow(aaveV3Plan);
  assert.equal(wf.nodes.length, 5);
  assert.deepEqual(
    wf.nodes.map((n) => n.id),
    ["trigger-1", "withdraw-source", "verify-withdraw", "supply-target", "verify-supply"]
  );
  assert.equal(wf.edges.length, 4);
  assert.deepEqual(
    wf.edges.map((e) => [e.source, e.target]),
    [
      ["trigger-1", "withdraw-source"],
      ["withdraw-source", "verify-withdraw"],
      ["verify-withdraw", "supply-target"],
      ["supply-target", "verify-supply"],
    ]
  );
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
