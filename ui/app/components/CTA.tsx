import Reveal from "./Reveal";

export default function CTA() {
  return (
    <Reveal className="block">
      <section className="grid grid-cols-1 lg:grid-cols-2">
        <div className="bg-ink text-cream px-8 lg:px-14 py-20 flex flex-col justify-center gap-3.5">
          <div className="font-cursive text-gold text-[56px] lg:text-[64px] leading-none">Migrate</div>
          <h2 className="font-serif text-cream text-[34px]">Start migrating, not guessing</h2>
          <p className="text-[#a89f7f] max-w-[40ch]">
            Connect your wallet, define your migration, and let KeeperHub execute it with complete
            determinism.
          </p>
        </div>
        <div className="bg-gold px-8 lg:px-14 py-20 flex flex-col justify-center gap-4">
          <h3 className="font-serif text-[28px] mb-1.5">Ready to go onchain?</h3>
          <a
            href="#console"
            className="text-center font-mono text-xs uppercase tracking-[0.03em] px-6 py-3.5 border-[1.5px] border-ink rounded-[3px] bg-ink text-cream shadow-[4px_4px_0_var(--color-ink)] hover:bg-ink hover:text-gold hover:shadow-[4px_4px_0_var(--color-white)] transition-all duration-200"
          >
            Open Console
          </a>
          <a
            href="https://github.com/ANSHSINGH5999/MigrateX-Keeper-#readme"
            target="_blank"
            rel="noreferrer"
            className="text-center font-mono text-xs uppercase tracking-[0.03em] px-6 py-3.5 border-[1.5px] border-ink rounded-[3px] bg-cream shadow-[4px_4px_0_var(--color-ink)] hover:bg-white transition-all duration-200"
          >
            Read Docs
          </a>
          <a
            href="https://github.com/ANSHSINGH5999/MigrateX-Keeper-"
            target="_blank"
            rel="noreferrer"
            className="text-center font-mono text-xs uppercase tracking-[0.03em] px-6 py-3.5 border-[1.5px] border-ink rounded-[3px] bg-cream shadow-[4px_4px_0_var(--color-ink)] hover:bg-white transition-all duration-200"
          >
            View GitHub
          </a>
        </div>
      </section>
    </Reveal>
  );
}
