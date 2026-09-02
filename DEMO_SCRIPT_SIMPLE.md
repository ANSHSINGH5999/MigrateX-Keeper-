# MigrateX Demo Video — Simple Script

This is a short, easy-to-read script. Just read the "Say" parts out loud while you show the
"Show" parts on your screen. About 3–4 minutes total.

Before you record:
- [ ] Make sure your `.env` files have your real KeeperHub key in them (but **don't show these
      files on screen** — keep the key hidden from the recording).
- [ ] Make sure Ollama is running (`ollama serve`) and the model is downloaded.
- [ ] Do one practice run first, so you know what to expect.

---

## Part 1 — Say what this is (15 seconds)

**Show:** Your face, or just a blank screen.

**Say:**
> "Hi, this is MigrateX. It's a project that connects two things: a smart AI agent, and
> KeeperHub — a service that safely does blockchain actions for you. The AI decides what to do.
> KeeperHub actually does it, safely and exactly as planned."

---

## Part 2 — Explain the idea simply (30 seconds)

**Show:** The GitHub page for the project.

**Say:**
> "Here's the problem: AI agents are smart, but they can make mistakes — especially with money.
> If you ask an AI to move your crypto, it might misunderstand you.
>
> KeeperHub fixes this. You build a plan first. You check the plan. Then it runs — exactly as
> planned, no surprises.
>
> I connected this to a real AI agent system called ElizaOS. ElizaOS is a well-known, actively
> used AI agent tool — and KeeperHub even lists it as one of their official partners on their own
> website."

---

## Part 3 — The live demo (this is the main part, about 90 seconds)

**Show:** Your terminal (the black command-line window), big enough to read.

**Say (before you run the command):**
> "Let me show you this working for real. I'm going to type a message to the AI agent, like
> someone asking it for help."

**Type and run this:**
```bash
cd eliza-agent
bun run start "Please run the keeperhub workflow named health-factor-monitor right now to check my Aave position."
```

**While it's loading, talk over it:**
> "This is starting up a real AI agent. It's using a free AI model that runs on my own computer —
> no paid service needed, so anyone can copy this and try it themselves."

**When you see the AI's response — stop and read it out loud:**
> "Look at this part — the AI is thinking. It says: *'Operator requested to run
> health-factor-monitor on KeeperHub. Acknowledge and execute the workflow.'*
>
> That's the AI deciding, by itself, to check my crypto position. I did not tell it exactly what
> to click — it figured that part out."

**When the final result appears:**
> "And there it is — a real result from KeeperHub. It checked my position on Aave, a real
> crypto lending app, using a test network — so this is completely safe, no real money at risk
> here. But the exact same process works with real money too."

---

## Part 4 — Show a real transaction (30 seconds)

**Show:** Your terminal, then switch to a browser tab with Etherscan (a website that shows
blockchain transactions) already open.

**Say:**
> "Now let me show you something that actually moves money — well, test money, since we're on a
> test network. Watch this."

**Run:**
```bash
cd ../orchestrator
node dist/index.js --workflow basic --plan ../plan.json --execute
```

**While it runs:**
> "This is doing five real steps: take money out of the lending app, check it arrived, give
> permission to put it back in, put it back in, and check that worked too. All automatic, all
> through KeeperHub."

**When it finishes, copy the transaction code it prints, paste it into Etherscan:**
> "See this? This isn't me telling you it worked — this is an independent website, completely
> outside of my project, showing the exact same result. That's proof."

---

## Part 5 — Show there's more (20 seconds)

**Show:** Scroll through the project's website (`localhost:3200`), especially the "Catalog"
section that lists many workflows.

**Say:**
> "This is just one example. My project actually has 38 different automated tasks it can do —
> checking prices, watching for danger, and more. I tested every single one against the real
> KeeperHub service before trusting it. A few things I tried didn't actually work — and instead
> of hiding that, I wrote it all down honestly in my project's documentation."

---

## Part 6 — Wrap up (15 seconds)

**Show:** Back to the GitHub page.

**Say:**
> "So that's MigrateX: a real AI agent that thinks, and KeeperHub that acts — safely, and for
> real. Everything you saw here is in the code, free to check yourself. Thanks for watching!"

---

## Quick word list (in case you want to explain any of these on camera)

- **AI agent** — a computer program that can understand instructions and make decisions on its
  own, a bit like a very smart assistant.
- **KeeperHub** — a service that takes a planned set of steps and runs them safely on the
  blockchain, without guessing or improvising.
- **Blockchain** — a public, shared record of transactions that anyone can check.
- **Testnet / test network** — a practice version of the blockchain. Nothing here uses real
  money, so it's safe to experiment with.
- **Transaction** — one action recorded on the blockchain, like "moved this much crypto from
  here to there."
- **Workflow** — a fixed list of steps that always happen in the same order, every time.
