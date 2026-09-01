export default function Nav() {
  return (
    <nav className="fixed top-0 inset-x-0 h-[61px] bg-cream border-b-[1.5px] border-ink z-50 flex items-center">
      <div className="w-full max-w-[1440px] mx-auto px-8 grid grid-cols-[1fr_auto_1fr] items-center">
        <div className="flex items-baseline gap-2.5">
          <span className="font-cursive text-[32px] leading-none">MigrateX</span>
          <span className="font-mono text-[9px] tracking-[0.1em] uppercase text-dim">Protocol Layer</span>
        </div>
        <div className="hidden md:flex gap-8 justify-self-center">
          {[
            ["How it works", "#how-it-works"],
            ["Console", "#console"],
            ["Monitor", "#monitor"],
            ["Audit Trail", "#exec-panel"],
          ].map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="relative font-mono text-[11px] tracking-[0.04em] uppercase pb-1 group"
            >
              {label}
              <span className="absolute left-0 bottom-0 w-full h-0.5 bg-gold scale-x-0 origin-left transition-transform duration-250 group-hover:scale-x-100" />
            </a>
          ))}
        </div>
        <a
          href="#console"
          className="justify-self-end font-mono text-[11px] uppercase tracking-[0.03em] px-4.5 py-2 border-[1.5px] border-ink rounded-[3px] bg-ink text-cream shadow-[4px_4px_0_var(--color-ink)] hover:bg-gold hover:text-ink hover:shadow-[4px_4px_0_var(--color-gold-hover)] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all duration-200"
        >
          Launch App →
        </a>
      </div>
    </nav>
  );
}
