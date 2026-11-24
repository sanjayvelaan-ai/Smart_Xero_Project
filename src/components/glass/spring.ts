// Adapted from Liquid Glass by Naitik (MIT).
// Damped harmonic spring integrator (semi-implicit Euler, sub-stepped for stability).
export type Spring = { x: number; v: number };

export function stepSpring(s: Spring, target: number, k: number, c: number, dt: number) {
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const a = -k * (s.x - target) - c * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
  return s;
}
