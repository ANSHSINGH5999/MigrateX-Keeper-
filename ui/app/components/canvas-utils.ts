export const GOLD = "#E8B800";
export const GOLD2 = "#C8A800";

export function withAlpha(hex: string, frac: number): string {
  const a = Math.round(Math.max(0, Math.min(1, frac)) * 255)
    .toString(16)
    .padStart(2, "0");
  return hex + a;
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface Particle {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  t: number;
  speed: number;
  radius: number;
  alpha: number;
  arrived: boolean;
  trail: { x: number; y: number }[];
  x?: number;
  y?: number;
}

export function stepParticles(particles: Particle[], dt: number, arcHeight: number, trailMax: number, fadeRate: number): Particle[] {
  for (const p of particles) {
    if (!p.arrived) {
      p.t = Math.min(1, p.t + dt * p.speed);
      const e = easeInOut(p.t);
      const x = p.ax + (p.bx - p.ax) * e;
      const y = p.ay + (p.by - p.ay) * e - Math.sin(p.t * Math.PI) * arcHeight;
      p.trail.push({ x, y });
      if (p.trail.length > trailMax) p.trail.shift();
      p.x = x;
      p.y = y;
      if (p.t >= 1) p.arrived = true;
    } else {
      p.alpha -= fadeRate;
    }
  }
  return particles.filter((p) => p.alpha > 0);
}
