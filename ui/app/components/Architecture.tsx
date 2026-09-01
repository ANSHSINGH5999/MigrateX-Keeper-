import Reveal from "./Reveal";

const FEATURES = [
  { glyph: "Shield", title: "MEV protection", body: "Transactions route through KeeperHub's execution layer, not a public mempool." },
  { glyph: "Speed", title: "Smart gas estimation", body: "Gas limits are computed per-call, not guessed with a flat multiplier." },
  { glyph: "Loop", title: "Automatic retry", body: "Idempotency-keyed retries survive upstream cold starts without double-broadcasting." },
  { glyph: "Audit", title: "Full audit trail", body: "Every node's status and transaction hash is queryable after the fact via get_execution." },
  { glyph: "Lock", title: "Non-custodial", body: "Your wallet signs. MigrateX never holds keys or funds at rest." },
  { glyph: "Open", title: "Open source", body: "Rust core, orchestrator, and UI are all inspectable — nothing is a black box." },
];

export default function Architecture() {
  return (
    <Reveal className="block">
      <section id="architecture" className="py-24 px-8 lg:px-14">
        <div className="max-w-[640px] mx-auto text-center mb-14">
          <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-dim mb-2.5">Under The Hood</div>
          <h2 className="font-serif text-[42px]">Architecture</h2>
          <span className="font-cursive text-gold text-[30px] block mt-1">Built to hold.</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 border-t-[1.5px] border-l-[1.5px] border-ink">
          {FEATURES.map((f) => (
            <div key={f.title} className="border-r-[1.5px] border-b-[1.5px] border-ink p-10 hover:bg-gold-hover transition-colors">
              <div className="font-cursive text-gold text-4xl">{f.glyph}</div>
              <h3 className="font-serif text-xl mt-3 mb-2">{f.title}</h3>
              <p className="text-sm text-dim">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </Reveal>
  );
}
