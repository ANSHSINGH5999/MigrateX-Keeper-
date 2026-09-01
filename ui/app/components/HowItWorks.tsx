import Reveal from "./Reveal";

const STEPS = [
  {
    n: "Step 01 — Define",
    glyph: "Plan",
    title: "Define the migration",
    body: "Specify source protocol, target, token, amount. Rust core validates the pair before anything touches the chain.",
  },
  {
    n: "Step 02 — Compose",
    glyph: "Build",
    title: "Compose the workflow",
    body: "The orchestrator composes the exact KeeperHub workflow — withdraw, verify, supply, confirm — as a reviewable node graph.",
  },
  {
    n: "Step 03 — Validate",
    glyph: "Check",
    title: "Validate deeply",
    body: "validate_workflow(deepCheck:true) catches structural and on-chain issues before any signature is requested.",
  },
  {
    n: "Step 04 — Execute",
    glyph: "Done",
    title: "Execute exactly that",
    body: "KeeperHub runs that exact workflow. Transaction hash extracted and logged via get_execution.",
  },
];

export default function HowItWorks() {
  return (
    <Reveal className="block">
      <section id="how-it-works" className="py-24 px-8 lg:px-14">
        <div className="max-w-[640px] mx-auto text-center mb-14">
          <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-dim mb-2.5">The Process</div>
          <h2 className="font-serif text-[42px]">How it works</h2>
          <span className="font-cursive text-gold text-[30px] block mt-1">Simple.</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border-t-[1.5px] border-l-[1.5px] border-ink">
          {STEPS.map((s) => (
            <div key={s.title} className="relative overflow-hidden border-r-[1.5px] border-b-[1.5px] border-ink p-9 group hover:bg-cream-hover transition-colors">
              <span className="absolute left-0 bottom-0 right-0 h-[3px] bg-gold scale-x-0 origin-left transition-transform duration-300 group-hover:scale-x-100" />
              <div className="font-mono text-[10px] tracking-[0.1em] text-dim">{s.n}</div>
              <div className="font-cursive text-gold text-4xl leading-none mt-2.5 mb-1">{s.glyph}</div>
              <h3 className="font-serif text-[22px] mb-2.5">{s.title}</h3>
              <p className="text-sm text-dim">{s.body}</p>
            </div>
          ))}
        </div>
      </section>
    </Reveal>
  );
}
