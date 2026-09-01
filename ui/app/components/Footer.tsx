export default function Footer() {
  return (
    <footer className="border-t-[1.5px] border-ink px-8 lg:px-14 py-7 flex items-center justify-between flex-wrap gap-4">
      <span className="font-cursive text-2xl">MigrateX</span>
      <div className="flex gap-6">
        {["GitHub", "Docs", "Discord", "KeeperHub"].map((l) => (
          <a key={l} href="#" className="font-mono text-[11px] tracking-[0.04em] uppercase hover:text-gold transition-colors">
            {l}
          </a>
        ))}
      </div>
      <div className="font-mono text-[10px] tracking-[0.06em] uppercase text-dim">KeeperHub Hackathon 2026</div>
    </footer>
  );
}
