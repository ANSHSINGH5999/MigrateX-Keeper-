# MigrateX × ElizaOS — Demo Video Script

Target length: **3–4 minutes**. Every claim below is something you can actually run live on
camera — nothing here is staged or pre-recorded fakery. Run the real commands while talking;
if something takes a few seconds (LLM inference, tx confirmation), let it breathe on screen —
judges watching real latency is more convincing than a jump cut.

Have three things open before you hit record:
1. A terminal at the repo root, wide enough to read.
2. `https://github.com/ANSHSINGH5999/MigrateX-Keeper-` in a browser tab.
3. `https://sepolia.etherscan.io` in another tab (empty, ready to paste a tx hash into).

---

## 0. Cold open (0:00–0:15) — the theme, in one breath

**Screen:** your face or a blank terminal, nothing fancy.

**Say:**
> "KeeperHub's brief for this hackathon was specific: don't build another standalone demo —
> integrate KeeperHub into a live project, and show it executing value movement that project
> triggers. This is MigrateX: an ElizaOS agent that decides what to do, and KeeperHub that
> executes it — deterministically, for real, on Sepolia."

---

## 1. The live project (0:15–0:45)

**Screen:** switch to the GitHub tab, then to `keeperhub.com/integrations` if you want one more
cut, or just narrate over the repo README scrolled to the "ElizaOS integration" section.

**Say:**
> "ElizaOS is a real agent framework — nineteen thousand GitHub stars, commits landing same-day —
> and it's one of KeeperHub's own listed integration partners. Their own site says ElizaOS agents
> plug into KeeperHub for execution. That's exactly what I built."

**Screen:** scroll briefly to `eliza-agent/` in the repo file tree.

> "One custom ElizaOS action. It doesn't know how to move funds — it only knows how to *pick*
> which already-built, already-validated KeeperHub workflow to run."

---

## 2. The live demo — this is the centerpiece (0:45–2:15)

**Screen:** terminal, full width. This is the part to rehearse once so the pacing is smooth.

**Say (before running):**
> "Here's a real event — think of this as a webhook, a chat message, anything external. I'm
> typing it as a CLI arg so you see exactly what the agent receives."

**Run:**
```bash
cd eliza-agent
bun run start "Please run the keeperhub workflow named health-factor-monitor right now to check my Aave position."
```

**While it boots (narrate over the logs, don't wait in silence):**
> "This is a real ElizaOS AgentRuntime booting — real database, real plugin system. The model
> here is Ollama running locally — completely free, zero API cost, so anyone judging this can
> reproduce it with no credentials."

**When the LLM response appears on screen — pause and point at it:**
> "Watch this line. That's the agent's own reasoning, not scripted."

**Read the actual output text out loud, e.g.:**
> *"Operator requested to run health-factor-monitor on KeeperHub. Acknowledge and execute the
> workflow."* — and it selects `RUN_KEEPERHUB_WORKFLOW`. That decision was made by the model. Now
> watch what happens next — this part is not the model anymore."

**When the execution result prints:**
> "That's a real call to KeeperHub's MCP server. Real workflow validation, real execution ID,
> real status. The agent didn't touch the chain — it picked a workflow. KeeperHub executed it."

**Screen:** point at the execution ID on screen.
> "That execution ID is queryable against KeeperHub's own audit trail — nothing here is a mock."

---

## 3. Prove it moves real value (2:15–2:50)

This step demonstrates the *other* half of the rubric: "did value actually move through
KeeperHub, and can we see it." `health-factor-monitor` is read-only by design — pick a real
write to show a real transaction. The `basic` migration workflow is the safest one to run live
on camera (small, known amount, already proven many times over).

**Say:**
> "That first run was read-only, on purpose — I didn't want to move real funds mid-recording
> without you seeing the setup first. Here's one that does move value."

**Run (from repo root):**
```bash
cd orchestrator
node dist/index.js --workflow basic --plan ../plan.json --execute
```

**While it runs:**
> "This is the actual Aave V3 migration workflow — withdraw, verify, approve, supply, verify.
> Five real on-chain steps, all through KeeperHub."

**When it finishes, copy the printed transaction hash, switch to the Etherscan tab, paste it:**
> "That's not a KeeperHub dashboard telling me it succeeded — that's Sepolia's own explorer,
> independently, showing a real, mined transaction."

---

## 4. Breadth and reliability, quickly (2:50–3:20)

**Screen:** scroll the README's workflow tables, or open the Workflow Catalog UI
(`localhost:3200`, the "Catalog" nav link) and filter through a couple of category tags.

**Say:**
> "This isn't the only workflow — there are 38, spanning Aave V3's full action surface, real
> price oracles, Lido, Uniswap V3, leverage loops, and messaging. Every single one was created
> and validated live against KeeperHub before I trusted it — several protocols I tried, like
> Aave V4 and half a dozen others, turned out not to be deployed on this testnet at all, and I
> documented that instead of hiding it. Same discipline applies to the agent side: I found a real
> bug in ElizaOS's own database migration order, and a reliability gap in local-model tool
> selection — both are written up, not swept under the rug."

---

## 5. Close (3:20–3:40)

**Screen:** back to the GitHub repo, README top.

**Say:**
> "MigrateX: a real agent framework deciding what to do, KeeperHub deciding nothing and executing
> everything exactly as composed. Source, this demo, and every transaction hash are all in the
> repo. Thanks for watching."

---

## Submission form answers (have these ready to paste)

- **Which project did you integrate with, and what does the integration do?** ElizaOS — a real
  ElizaOS `AgentRuntime` with a custom action (`RUN_KEEPERHUB_WORKFLOW`) that reasons about which
  pre-built MigrateX/Aave V3 workflow to run, then executes it through KeeperHub.
- **Which KeeperHub surfaces did you use?** MCP (streamable-HTTP JSON-RPC client), agent-authored
  workflow selection, audit trail (`get_execution`, cross-checked against raw
  `eth_getTransactionReceipt`).
- **Testnet or mainnet?** Sepolia testnet (11155111).
- **What still breaks or is unfinished?** The trigger is a CLI arg standing in for a real
  webhook/chat event (wiring one is a documented, not-yet-built next step); ElizaOS's own
  database-migration ordering bug needed a workaround (documented in `eliza-agent/README.md`);
  small local models need `@elizaos/plugin-bootstrap` to reliably see available actions, or they
  silently default to a generic reply.
- **Contact:** [fill in your email + X/Discord handle]

## Before you hit record

- [ ] Run `git pull` / confirm `git status` is clean so what's on screen matches GitHub exactly.
- [ ] Confirm `ollama list` shows a model and `ollama serve` is running.
- [ ] Confirm `orchestrator/.env` and `eliza-agent/.env` both have a real `KEEPERHUB_API_KEY` —
      **do not show these files on screen**, the key must never appear in the recording.
- [ ] Check the Aave V3 position has enough supplied balance for the `basic` workflow's withdraw
      step to succeed live (re-supply first if a prior run drained it — see the README's
      "Verified execution" section for the exact recovery steps).
- [ ] Do one dry run of the whole script off-camera so you know the real timings.
