"use client";

import { useEffect, useRef, useState } from "react";
import { GOLD, GOLD2, withAlpha, roundRect, stepParticles, type Particle } from "./canvas-utils";

const NODES = [
  { label: "AAVE V3", sub: "Sepolia · Source" },
  { label: "KEEPERHUB", sub: "Execution Layer" },
  { label: "AAVE V3", sub: "Sepolia · Target" },
];

const STEP_LABELS = ["Trigger", "Withdraw", "Verify", "Supply", "Verify", "Done"];

const LOGS: Record<string, string> = {
  trigger: "✓ manual trigger accepted",
  withdrawStart: "⟳ aave-v3/withdraw broadcasting…",
  withdrawDone: "✓ withdraw confirmed · tx 0x4f2a…91bc",
  verify1: "✓ balance verified in wallet",
  supplyStart: "⟳ aave-v3/supply broadcasting…",
  supplyDone: "✓ supply confirmed · tx 0x9c11…fe3d",
  verify2: "✓ destination balance verified · migration complete",
};

interface SeqEvent {
  idx: number;
  at: number;
  status: string;
  cls: "active" | "done";
  log?: string;
  phase?: number;
}

const SEQUENCE: SeqEvent[] = [
  { idx: 0, at: 150, status: "running...", cls: "active" },
  { idx: 0, at: 500, status: "✓ done", cls: "done", log: "trigger" },
  { idx: 1, at: 500, status: "running...", cls: "active", log: "withdrawStart", phase: 0 },
  { idx: 1, at: 2800, status: "✓ done", cls: "done", log: "withdrawDone" },
  { idx: 2, at: 2800, status: "running...", cls: "active", log: "verify1" },
  { idx: 2, at: 3400, status: "✓ done", cls: "done" },
  { idx: 3, at: 3400, status: "running...", cls: "active", log: "supplyStart", phase: 1 },
  { idx: 3, at: 5700, status: "✓ done", cls: "done", log: "supplyDone" },
  { idx: 4, at: 5700, status: "running...", cls: "active", log: "verify2" },
  { idx: 4, at: 6300, status: "✓ done", cls: "done" },
  { idx: 5, at: 6300, status: "running...", cls: "active" },
  { idx: 5, at: 6700, status: "✓ done", cls: "done" },
];
const LOOP_PAUSE_MS = 1800;

type StepState = { cls: "" | "active" | "done"; status: string };

export default function ExecPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(0);
  const particlesRef = useRef<Particle[]>([]);
  const [steps, setSteps] = useState<StepState[]>(STEP_LABELS.map(() => ({ cls: "", status: "pending" })));
  const [log, setLog] = useState({ time: "00:00", msg: "standing by" });

  useEffect(() => {
    let timers: ReturnType<typeof setTimeout>[] = [];
    let seqStart = performance.now();

    function writeLog(key: string) {
      const text = LOGS[key];
      if (!text) return;
      const el = (performance.now() - seqStart) / 1000;
      const m = Math.floor(el / 60), s = Math.floor(el % 60);
      setLog({ time: `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`, msg: text });
    }

    function runSequence() {
      timers.forEach(clearTimeout);
      timers = [];
      phaseRef.current = 0;
      particlesRef.current = [];
      seqStart = performance.now();
      setSteps(STEP_LABELS.map(() => ({ cls: "", status: "pending" })));
      setLog({ time: "00:00", msg: "sequence started" });

      SEQUENCE.forEach((ev) => {
        timers.push(
          setTimeout(() => {
            setSteps((prev) => {
              const next = [...prev];
              next[ev.idx] = { cls: ev.cls, status: ev.status };
              return next;
            });
            if (ev.log) writeLog(ev.log);
            if (typeof ev.phase === "number") phaseRef.current = ev.phase;
          }, ev.at)
        );
      });

      const lastAt = SEQUENCE[SEQUENCE.length - 1].at;
      timers.push(setTimeout(runSequence, lastAt + LOOP_PAUSE_MS));
    }
    runSequence();

    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const W = () => canvas.offsetWidth;
    const H = () => canvas.offsetHeight;

    function resize() {
      if (!canvas || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(W() * dpr);
      canvas.height = Math.round(H() * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }
    resize();
    window.addEventListener("resize", resize);

    function nodeGeometry() {
      const w = W(), h = H();
      const spacing = 0.35 * w;
      const nodeW = Math.max(90, Math.min(140, spacing - 84));
      const nodeH = 60;
      const cy = h / 2 - 6;
      const xs = [w * 0.15, w * 0.5, w * 0.85];
      return NODES.map((n, i) => ({ cx: xs[i], cy, w: nodeW, h: nodeH, label: n.label, sub: n.sub }));
    }

    let lastSpawn = 0;
    const SPAWN_MS = 160, ARC = 30, TRAVEL_MS = 900;

    function spawnParticle(ns: ReturnType<typeof nodeGeometry>) {
      const a = ns[phaseRef.current], b = ns[phaseRef.current + 1];
      particlesRef.current.push({
        ax: a.cx + a.w / 2, ay: a.cy, bx: b.cx - b.w / 2, by: b.cy,
        t: 0, speed: 1000 / TRAVEL_MS, radius: 4 + Math.random() * 4, alpha: 1, arrived: false, trail: [],
      });
    }

    function drawParticle(p: Particle) {
      if (!ctx) return;
      for (let i = 0; i < p.trail.length; i++) {
        const pt = p.trail[i];
        const f = (i + 1) / p.trail.length;
        ctx.beginPath();
        ctx.fillStyle = withAlpha(GOLD2, 0.5 * f * p.alpha);
        ctx.arc(pt.x, pt.y, p.radius * 0.6 * f, 0, Math.PI * 2);
        ctx.fill();
      }
      const last = p.trail.length ? p.trail[p.trail.length - 1] : { x: p.x!, y: p.y! };
      ctx.beginPath();
      ctx.fillStyle = withAlpha(GOLD, 0.1 * p.alpha);
      ctx.arc(last.x, last.y, p.radius * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = withAlpha(GOLD, p.alpha);
      ctx.arc(last.x, last.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    let raf = 0;
    let last = 0;
    function frame(now: number) {
      if (!ctx || !canvas) return;
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      const ns = nodeGeometry();
      ctx.clearRect(0, 0, W(), H());

      ctx.save();
      ctx.strokeStyle = withAlpha(GOLD, 0.16);
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(ns[0].cx + ns[0].w / 2, ns[0].cy);
      ctx.lineTo(ns[1].cx - ns[1].w / 2, ns[1].cy);
      ctx.moveTo(ns[1].cx + ns[1].w / 2, ns[1].cy);
      ctx.lineTo(ns[2].cx - ns[2].w / 2, ns[2].cy);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.textAlign = "center";
      ctx.font = "bold 10px monospace";
      ctx.fillStyle = "#3A3A2A";
      ctx.fillText("0.005 WETH", (ns[0].cx + ns[1].cx) / 2, ns[0].cy - 28);
      ctx.fillText("0.005 WETH", (ns[1].cx + ns[2].cx) / 2, ns[1].cy - 28);
      ctx.restore();

      if (!reduceMotion) {
        if (now - lastSpawn >= SPAWN_MS) { lastSpawn = now; spawnParticle(ns); }
        particlesRef.current = stepParticles(particlesRef.current, dt, ARC, 8, 0.04);
      }

      ns.forEach((n) => {
        const breathe = reduceMotion ? 0 : Math.sin(now / 650 + n.cx) * 2.2;
        const x = n.cx - n.w / 2, y = n.cy - n.h / 2;
        ctx.save();
        ctx.fillStyle = "#111108";
        ctx.strokeStyle = withAlpha(GOLD, 0.38);
        ctx.lineWidth = 1;
        roundRect(ctx, x, y, n.w, n.h, 6);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = withAlpha(GOLD, 0.25);
        ctx.lineWidth = 0.5;
        roundRect(ctx, x - 8 - breathe, y - 8 - breathe, n.w + 16 + breathe * 2, n.h + 16 + breathe * 2, 9);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.textAlign = "center";
        ctx.fillStyle = GOLD;
        ctx.font = "bold 12px monospace";
        ctx.fillText(n.label, n.cx, n.cy - 3);
        ctx.fillStyle = "#3A3A28";
        ctx.font = "9px monospace";
        ctx.fillText(n.sub, n.cx, n.cy + 12);
        ctx.restore();
      });

      if (!reduceMotion) particlesRef.current.forEach(drawParticle);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <section id="exec-panel" className="bg-[#0C0C0A] text-[#b8b498] font-mono">
      <div className="flex items-center justify-between h-11 px-5 border-b border-[#1E1E18]">
        <div className="flex gap-[7px]">
          <span className="w-[9px] h-[9px] rounded-full bg-[#7A3A2A]" />
          <span className="w-[9px] h-[9px] rounded-full bg-[#7A6A2A]" />
          <span className="w-[9px] h-[9px] rounded-full bg-[#2A6A34]" />
        </div>
        <div className="text-[10px] tracking-[0.14em] uppercase text-[#3A3A30]">MigrateX &middot; KeeperHub Execution</div>
        <div className="text-[10px] tracking-[0.06em] uppercase text-gold flex items-center gap-2">
          <span className="live-dot" />Live &middot; Sepolia
        </div>
      </div>
      <canvas ref={canvasRef} className="block w-full h-[320px]" />
      <div className="flex border-t border-[#1E1E18]">
        {steps.map((s, i) => (
          <div key={i} className="flex-1 p-3.5 border-r border-[#1A1A14] last:border-r-0">
            <div className="text-[9px] text-[#2A2A22]">{String(i + 1).padStart(2, "0")}</div>
            <div className={`text-[11px] font-bold mt-1 transition-colors ${s.cls === "active" ? "text-gold" : s.cls === "done" ? "text-[#C8A800]" : "text-[#5A5A48]"}`}>
              {STEP_LABELS[i]}
            </div>
            <div className={`text-[9px] mt-0.5 transition-colors ${s.cls === "active" ? "text-gold" : s.cls === "done" ? "text-[#C8A800]" : "text-[#2A2A22]"}`}>
              {s.status}
            </div>
            <div className="mt-2 h-0.5 bg-transparent">
              <div
                className="h-0.5 bg-gold"
                style={{
                  width: s.cls === "done" ? "100%" : s.cls === "active" ? undefined : "0%",
                  animation: s.cls === "active" ? "bar-breathe 1.5s ease-in-out infinite" : undefined,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2.5 h-[38px] px-5 border-t border-[#1E1E18] text-[11px]">
        <span className="text-[9px] text-[#2A2A22]">{log.time}</span>
        <span>{log.msg}</span>
      </div>
    </section>
  );
}
