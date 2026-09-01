"use client";

import { useEffect, useRef, useState } from "react";

const STATS = [
  { target: 20, prefix: "", suffix: "+", label: "Networks" },
  { target: 100, prefix: "", suffix: "%", label: "Success" },
  { target: 50, prefix: "<", suffix: "ms", label: "Dry-run" },
];

export default function StatCounters() {
  const ref = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState([0, 0, 0]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let done = false;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !done) {
          done = true;
          const start = performance.now();
          const dur = 1100;
          function tick(now: number) {
            const p = Math.min(1, (now - start) / dur);
            const eased = 1 - Math.pow(1 - p, 3);
            setValues(STATS.map((s) => Math.round(s.target * eased)));
            if (p < 1) requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
          io.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="mt-7 pt-5 border-t-[1.5px] border-ink flex gap-11">
      {STATS.map((s, i) => (
        <div key={s.label}>
          <div className="font-serif text-[34px] leading-none">
            {s.prefix}
            {values[i]}
            {s.suffix}
          </div>
          <div className="font-mono text-[9px] tracking-[0.08em] uppercase text-dim">{s.label}</div>
        </div>
      ))}
    </div>
  );
}
