"use client";

import { useEffect, useRef } from "react";
import { GOLD, GOLD2, withAlpha, roundRect, stepParticles, type Particle } from "./canvas-utils";

const LABELS = ["AAVE V3", "KEEPERHUB", "AAVE V3"];
const SPAWN_MS = 180;
const ARC = 30;
const TRAVEL_MS = 1300;

export default function HeroCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    function nodes() {
      const w = W(), h = H();
      const nodeW = Math.min(120, w * 0.28);
      const nodeH = 46;
      const cy = h / 2;
      const xs = [w * 0.18, w * 0.5, w * 0.82];
      return LABELS.map((l, i) => ({ cx: xs[i], cy, w: nodeW, h: nodeH, label: l }));
    }

    let particles: Particle[] = [];
    const lastSpawn: Record<number, number> = { 0: 0, 1: 0 };

    function spawn(a: ReturnType<typeof nodes>[number], b: ReturnType<typeof nodes>[number]) {
      particles.push({
        ax: a.cx + a.w / 2, ay: a.cy, bx: b.cx - b.w / 2, by: b.cy,
        t: 0, speed: 1000 / TRAVEL_MS, radius: 2.5 + Math.random() * 2, alpha: 1, arrived: false, trail: [],
      });
    }

    function drawParticle(p: Particle) {
      if (!ctx) return;
      for (let i = 0; i < p.trail.length; i++) {
        const pt = p.trail[i];
        const f = (i + 1) / p.trail.length;
        ctx.beginPath();
        ctx.fillStyle = withAlpha(GOLD2, 0.4 * f * p.alpha);
        ctx.arc(pt.x, pt.y, p.radius * 0.55 * f, 0, Math.PI * 2);
        ctx.fill();
      }
      const last = p.trail.length ? p.trail[p.trail.length - 1] : { x: p.x!, y: p.y! };
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
      const ns = nodes();
      ctx.clearRect(0, 0, W(), H());

      ctx.save();
      ctx.strokeStyle = withAlpha(GOLD, 0.18);
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(ns[0].cx + ns[0].w / 2, ns[0].cy);
      ctx.lineTo(ns[1].cx - ns[1].w / 2, ns[1].cy);
      ctx.moveTo(ns[1].cx + ns[1].w / 2, ns[1].cy);
      ctx.lineTo(ns[2].cx - ns[2].w / 2, ns[2].cy);
      ctx.stroke();
      ctx.restore();

      if (!reduceMotion) {
        if (now - lastSpawn[0] >= SPAWN_MS) { lastSpawn[0] = now; spawn(ns[0], ns[1]); }
        if (now - lastSpawn[1] >= SPAWN_MS) { lastSpawn[1] = now; spawn(ns[1], ns[2]); }
        particles = stepParticles(particles, dt, ARC, 7, 0.05);
      }

      ns.forEach((n) => {
        const x = n.cx - n.w / 2, y = n.cy - n.h / 2;
        ctx.save();
        ctx.fillStyle = "#1c1a12";
        ctx.strokeStyle = withAlpha(GOLD, 0.55);
        ctx.lineWidth = 1;
        roundRect(ctx, x, y, n.w, n.h, 5);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.textAlign = "center";
        ctx.fillStyle = GOLD;
        ctx.font = "bold 10px var(--f-mono), monospace";
        ctx.fillText(n.label, n.cx, n.cy + 3);
        ctx.restore();
      });

      if (!reduceMotion) particles.forEach(drawParticle);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="block w-full h-full" />;
}
