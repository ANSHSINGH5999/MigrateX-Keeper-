const TEXT = "Aave V3 → V3 ✦ Real KeeperHub Execution ✦ MEV Protected ✦ Non-Custodial ✦ Audit Trail ✦ Dry-run First ✦ Sepolia Testnet ✦ KeeperHub MCP ✦ ";

export default function Marquee() {
  return (
    <div className="bg-gold border-y-[1.5px] border-ink overflow-hidden whitespace-nowrap py-3">
      <div className="marquee-track">
        <span className="font-mono text-[13px] font-bold tracking-[0.03em] uppercase px-5">{TEXT}</span>
        <span className="font-mono text-[13px] font-bold tracking-[0.03em] uppercase px-5">{TEXT}</span>
      </div>
    </div>
  );
}
