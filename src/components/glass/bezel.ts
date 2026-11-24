// Adapted from Liquid Glass by Naitik (MIT).
const mapCache = new Map<string, string>();
export function buildMap(w: number, h: number, r: number, bezel: number) {
  const key = `${Math.round(w)}x${Math.round(h)}r${r}b${Math.round(bezel)}`;
  const hit = mapCache.get(key);
  if (hit) return hit;
  const out = buildMapRaw(w, h, r, bezel);
  if (mapCache.size >= 24) mapCache.clear();
  mapCache.set(key, out);
  return out;
}
function buildMapRaw(w: number, h: number, r: number, bezel: number) {
  const s = Math.min(0.75, 360 / Math.max(w, h));
  const W = Math.max(2, Math.round(w * s));
  const H = Math.max(2, Math.round(h * s));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  const hw = w / 2, hh = h / 2;
  const rad = Math.min(r, hw, hh);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const x = (px + 0.5) / s - hw;
      const y = (py + 0.5) / s - hh;
      const qx = Math.abs(x) - (hw - rad);
      const qy = Math.abs(y) - (hh - rad);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const d = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - rad;
      const inside = -d;
      let nx = 0, ny = 0, mag = 0;
      if (inside > 0 && inside < bezel) {
        if (ox > 0 || oy > 0) {
          const l = Math.hypot(ox, oy) || 1;
          nx = (ox / l) * Math.sign(x);
          ny = (oy / l) * Math.sign(y);
        } else if (qx > qy) nx = Math.sign(x);
        else ny = Math.sign(y);
        const t = 1 - inside / bezel;
        // derivative of a squircle height field: steep at the rim, flat in the middle
        mag = Math.pow(t, 2.4);
      }
      const i = (py * W + px) * 4;
      img.data[i] = 128 - nx * mag * 127;
      img.data[i + 1] = 128 - ny * mag * 127;
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}
