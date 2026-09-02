const LINKS: [string, string][] = [
  ["GitHub", "https://github.com/ANSHSINGH5999/MigrateX-Keeper-"],
  ["Docs", "https://github.com/ANSHSINGH5999/MigrateX-Keeper-#readme"],
  ["KeeperHub", "https://app.keeperhub.com"],
];

export default function Footer() {
  return (
    <footer className="border-t-[1.5px] border-ink px-8 lg:px-14 py-7 flex items-center justify-between flex-wrap gap-4">
      <span className="font-cursive text-2xl">MigrateX</span>
      <div className="flex gap-6">
        {LINKS.map(([label, href]) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11px] tracking-[0.04em] uppercase hover:text-gold transition-colors"
          >
            {label}
          </a>
        ))}
      </div>
      <div className="font-mono text-[10px] tracking-[0.06em] uppercase text-dim">KeeperHub Hackathon 2026</div>
    </footer>
  );
}
