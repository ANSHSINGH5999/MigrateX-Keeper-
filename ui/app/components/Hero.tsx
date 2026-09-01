import HeroCanvas from "./HeroCanvas";
import StatCounters from "./StatCounters";

export default function Hero() {
  return (
    <header id="monitor" className="grid grid-cols-1 lg:grid-cols-2 min-h-[calc(100vh-61px)]">
      <div className="border-b-[1.5px] lg:border-b-0 lg:border-r-[1.5px] border-ink px-8 lg:px-14 py-16 flex flex-col justify-center gap-5">
        <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-dim">
          KeeperHub Integration &middot; Sepolia Testnet
        </div>
        <h1 className="font-serif text-[52px] lg:text-[68px] leading-[1.04]">
          Token migration
          <br />
          <em className="italic">without</em>
          <br />
          the guesswork
        </h1>
        <div className="font-cursive text-gold text-[40px] lg:text-[44px] -mt-1.5">deterministic.</div>
        <div className="font-serif italic text-[22px] border-l-[3px] border-gold pl-4">
          &ldquo;What you review is what executes.&rdquo;
        </div>
        <p className="text-base text-dim max-w-[46ch]">
          Compose your workflow. Dry-run it without touching the chain. Execute exactly that — with
          nonce management, MEV protection, and a full audit trail on every run.
        </p>
        <div className="flex gap-3.5 mt-1">
          <a
            href="#console"
            className="font-mono text-xs uppercase tracking-[0.03em] px-6 py-3.5 border-[1.5px] border-ink rounded-[3px] bg-ink text-cream shadow-[4px_4px_0_var(--color-ink)] hover:bg-gold hover:text-ink hover:shadow-[4px_4px_0_var(--color-gold-hover)] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all duration-200"
          >
            Launch App →
          </a>
          <a
            href="#how-it-works"
            className="font-mono text-xs uppercase tracking-[0.03em] px-6 py-3.5 border-[1.5px] border-ink rounded-[3px] bg-transparent shadow-[4px_4px_0_var(--color-ink)] hover:bg-cream-hover hover:shadow-[4px_4px_0_var(--color-gold)] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all duration-200"
          >
            How it works
          </a>
        </div>
        <StatCounters />
      </div>
      <div className="bg-ink text-cream flex flex-col min-h-[420px] lg:min-h-0">
        <div className="px-6 py-3.5 border-b border-[#33301f] font-mono text-[10px] tracking-[0.08em] uppercase text-[#a89f7f]">
          Live Execution Monitor &middot; KeeperHub MCP
        </div>
        <div className="flex-1 relative">
          <HeroCanvas />
        </div>
        <div className="px-6 py-3 border-t border-[#33301f] font-mono text-[10px] flex justify-between text-[#a89f7f]">
          <span>
            <span className="live-dot mr-1.5" />
            MCP Connected &middot; mcp:write
          </span>
          <span>0x11F1&hellip;4E7B2</span>
        </div>
      </div>
    </header>
  );
}
