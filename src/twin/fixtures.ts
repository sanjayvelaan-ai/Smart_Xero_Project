import * as T from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import QRCode from "qrcode";
import type { Selection } from "./state";

export const machineX = (id: number) => -0.15 + (id - 1) * 1.88;
export const machineZ = -2.42;
export const tableY = 0.76;
export const pickup = new T.Vector3(0.45, 0.99, 0.56);
export const waitingSeats = [-0.02, 0.65, 1.32].map((z) => new T.Vector3(4.59, 0, z));
export const tray = (id: number) =>
  new T.Vector3(machineX(id), tableY + 0.434, machineZ + 0.185);
export const boxGeometry = new T.BoxGeometry(1, 1, 1);
const rounded = new RoundedBoxGeometry(1, 1, 1, 2, 0.055);
const materials = new Map<string, T.MeshStandardMaterial>();
export function mat(color: string, metal = 0) {
  const key = color + metal;
  if (!materials.has(key))
    materials.set(
      key,
      new T.MeshStandardMaterial({
        color,
        roughness: metal ? 0.38 : 0.79,
        metalness: metal,
      }),
    );
  return materials.get(key)!;
}
export function box(
  parent: T.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  color: string | T.Material,
  soft = false,
) {
  const mesh = new T.Mesh(
    soft ? rounded : boxGeometry,
    typeof color === "string" ? mat(color) : color,
  );
  mesh.position.set(x, y, z);
  mesh.scale.set(w, h, d);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
export function group(parent: T.Object3D, x = 0, y = 0, z = 0) {
  const g = new T.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
export function screen(
  parent: T.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  paint: (c: CanvasRenderingContext2D, width: number, height: number) => void,
  width = 768,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round((width * h) / w);
  const ctx = canvas.getContext("2d")!;
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  function draw(fn: typeof paint) {
    fn(ctx, canvas.width, canvas.height);
    texture.needsUpdate = true;
  }
  draw(paint);
  const material = new T.MeshBasicMaterial({ map: texture, toneMapped: false });
  const face = new T.Mesh(new T.PlaneGeometry(w, h), material);
  face.position.set(x, y, z);
  parent.add(face);
  face.userData.localTexture = true;
  return { face, draw };
}
function text(
  c: CanvasRenderingContext2D,
  line: string,
  x: number,
  y: number,
  font: number,
  color: string,
  weight = 600,
) {
  c.fillStyle = color;
  c.font = weight + " " + font + "px Arial, Nirmala UI, sans-serif";
  c.fillText(line, x, y);
}
function plaque(
  parent: T.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  title: string,
  sub: string,
  bg = "#153d3c",
  fg = "#ffffff",
) {
  box(parent, x, y, z, w + 0.04, h + 0.04, 0.045, "#283b38", true);
  return screen(parent, x, y, z + 0.025, w, h, (c, W, H) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    text(
      c,
      title,
      W * 0.055,
      H * 0.5,
      Math.min(H * 0.38, W / (title.length * 0.63)),
      fg,
      700,
    );
    text(
      c,
      sub,
      W * 0.055,
      H * 0.82,
      Math.min(H * 0.19, W / (sub.length * 0.64)),
      fg,
      500,
    );
  });
}
export function tag(obj: T.Object3D, target: Selection) {
  obj.userData.target = target;
  return obj;
}
function batch(parent: T.Group) {
  parent.updateWorldMatrix(true, true);
  const inverse = parent.matrixWorld.clone().invert();
  const sets = new Map<T.Material, T.BufferGeometry[]>();
  const old: T.Mesh[] = [];
  parent.traverse((o) => {
    if (
      !(o instanceof T.Mesh) ||
      o.userData.localTexture ||
      Array.isArray(o.material)
    )
      return;
    for (let a: T.Object3D | null = o; a && a !== parent; a = a.parent)
      if (a.userData.target) return;
    const geo = (
      o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()
    ).applyMatrix4(inverse.clone().multiply(o.matrixWorld));
    const parts = sets.get(o.material) ?? [];
    parts.push(geo);
    sets.set(o.material, parts);
    old.push(o);
  });
  for (const o of old) o.removeFromParent();
  for (const [material, geos] of sets) {
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (merged) {
      const mesh = new T.Mesh(merged, material);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.localGeometry = true;
      parent.add(mesh);
    }
  }
}
// Shared procedural surface maps keep the room self-contained, including offline demos.
const surfaces = new Map<string, T.MeshStandardMaterial>();
function finish(color: string, wood = false) {
  const key = color + (wood ? "wood" : "stone");
  const old = surfaces.get(key);
  if (old) return old;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const c = canvas.getContext("2d")!;
  c.fillStyle = color;
  c.fillRect(0, 0, 256, 128);
  let seed = 2048;
  const random = () =>
    (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < (wood ? 210 : 5000); i++) {
    const x = random() * 256,
      y = random() * 128;
    c.fillStyle = i % 2 ? "rgba(255,253,241,.12)" : "rgba(67,62,49,.12)";
    if (wood) {
      c.fillRect(x, y, 8 + random() * 85, 0.4 + random() * 0.7);
    } else {
      c.fillRect(x, y, 0.45 + random() * 1.2, 0.4 + random());
    }
  }
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  const material = new T.MeshStandardMaterial({
    map,
    roughness: wood ? 0.6 : 0.78,
  });
  surfaces.set(key, material);
  return material;
}
function laminate(
  parent: T.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
) {
  box(parent, x, y, z, w, 0.065, d, "#ae8055", true);
  box(
    parent,
    x,
    y + 0.034,
    z,
    w - 0.015,
    0.009,
    d - 0.015,
    finish("#ceaa7e", true),
  );
}
function bench(
  parent: T.Object3D,
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
) {
  laminate(parent, x, h - 0.035, z, w, d);
  for (const dx of [-1, 1])
    for (const dz of [-1, 1])
      box(
        parent,
        x + dx * (w / 2 - 0.09),
        (h - 0.07) / 2,
        z + dz * (d / 2 - 0.09),
        0.055,
        h - 0.07,
        0.055,
        "#405451",
      );
}
function chair(parent: T.Object3D, x: number, z: number, turn = 0) {
  const root = group(parent, x, 0, z);
  root.rotation.y = turn;
  box(root, 0, 0.46, 0, 0.48, 0.075, 0.48, "#334947", true);
  box(root, 0, 0.77, -0.21, 0.45, 0.47, 0.075, "#28413e", true);
  box(root, 0, 0.24, 0, 0.065, 0.42, 0.065, "#626e69");
  for (let i = 0; i < 5; i++) {
    const spoke = group(root, 0, 0.09, 0);
    spoke.rotation.y = (i * Math.PI * 2) / 5;
    box(spoke, 0, 0, 0.11, 0.035, 0.04, 0.24, "#464d49");
    box(spoke, 0, -0.045, 0.23, 0.075, 0.08, 0.08, "#263533", true);
  }
}
function stockedShelf(root: T.Object3D, x: number, z: number) {
  const rack = group(root, x, 0, z);
  const wood = "#9c7352";
  for (const dx of [-0.65, 0.65])
    for (const dz of [-0.23, 0.23])
      box(rack, dx, 1.03, dz, 0.044, 2.06, 0.044, "#394d48");
  for (let level = 0; level < 4; level++) {
    const y = 0.19 + level * 0.51;
    box(rack, 0, y, 0, 1.38, 0.045, 0.52, wood);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 1 + ((level + i) % 3); j++) {
        const bx = -0.44 + i * 0.43;
        box(
          rack,
          bx,
          y + 0.095 + j * 0.14,
          0,
          0.395,
          0.132,
          0.37,
          ["#e8e5d9", "#dadcc9", "#c3d4cc"][(i + level) % 3],
          true,
        );
        box(
          rack,
          bx - 0.08,
          y + 0.1 + j * 0.14,
          0.189,
          0.14,
          0.094,
          0.008,
          ["#136b5d", "#a54833", "#36596c"][(i + level) % 3],
        );
      }
  }
}
let copierTemplate: Promise<T.Group> | undefined;
export function buildFixtures(
  scene: T.Scene,
  shopId: string,
  shopName: string,
  demo: boolean,
) {
  const root = group(scene);
  // A front cutaway keeps the operator aisle and customer lanes visible from the overview camera.
  box(root, 0, -0.21, 0.25, 11.7, 0.42, 8.15, "#465c55", true);
  box(root, 0, -0.055, 0.25, 11.55, 0.11, 8.02, "#a6aca0");
  const swatches = ["#d6d5c7", "#d9d8cc", "#d4d3c6", "#dcdace"];
  for (let i = 0; i < 14; i++)
    for (let j = 0; j < 10; j++)
      box(
        root,
        -5.36 + i * 0.824,
        -0.013,
        -3.36 + j * 0.8,
        0.817,
        0.028,
        0.793,
        finish(swatches[(i * 7 + j * 3) % 4]),
      );
  box(root, 0, 1.72, -3.79, 11.6, 3.44, 0.16, "#eeeae0");
  box(root, -5.76, 1.72, 0.18, 0.15, 3.44, 8.06, "#e3e4d7");
  box(root, 0, 0.54, -3.695, 11.55, 1.08, 0.035, "#74988a");
  box(root, -5.67, 0.54, 0.18, 0.035, 1.08, 8, "#74988a");
  box(root, 0, 0.075, -3.66, 11.55, 0.15, 0.05, "#485b51");
  box(root, 0, 3.4, -3.68, 11.75, 0.13, 0.25, "#5a756a");
  box(root, -5.65, 3.4, 0.16, 0.25, 0.13, 8.16, "#5a756a");
  // Glazed side window, with mullions, sill and adjustable slats.
  const windowBay = group(root, -5.65, 2.1, -0.25);
  windowBay.rotation.y = Math.PI / 2;
  box(windowBay, 0, 0, 0, 3.6, 1.53, 0.08, "#3c5550");
  box(windowBay, 0, 0, 0.055, 3.46, 1.38, 0.035, "#abcbd0");
  for (let i = 0; i < 4; i++)
    box(windowBay, -1.67 + i * 1.12, 0, 0.095, 0.045, 1.4, 0.05, "#f2ece2");
  for (let i = 0; i < 6; i++)
    box(windowBay, 0, 0.62 - i * 0.095, 0.12, 3.48, 0.044, 0.08, "#c9c9b8");
  box(windowBay, 0, -0.77, 0.1, 3.82, 0.08, 0.28, "#9c8f76");
  plaque(
    root,
    -2.6,
    2.64,
    -3.65,
    4.33,
    0.74,
    "PRINTFLOW",
    "SMART XEROX CENTER   /   CHENNAI",
  );
  for (const x of [1.45, 3.5]) {
    box(root, x, 2.77, -3.62, 1.45, 0.11, 0.18, "#737875", true);
    box(root, x, 2.73, -3.5, 1.34, 0.06, 0.04, "#f6f6e6");
  }
  for (let i = 0; i < 3; i++)
    box(root, 4.83, 2.1 - i * 0.09, -3.66, 0.45, 0.038, 0.04, "#84988d");
  stockedShelf(root, 4.94, -2.65);
  const machineBank = group(root);
  bench(machineBank, 1.74, machineZ, 5.68, 1.06, tableY);
  for (let i = 0; i < 5; i++)
    box(
      machineBank,
      -0.56 + i * 1.03,
      0.34,
      machineZ,
      1.01,
      0.62,
      0.91,
      "#8a9e91",
      true,
    );
  for (let i = 0; i < 5; i++)
    box(
      machineBank,
      -0.56 + i * 1.03,
      0.56,
      machineZ + 0.465,
      0.26,
      0.027,
      0.04,
      "#344641",
    );
  const desk = group(root, -3.15, 0, -0.3);
  bench(desk, 0, 0, 2.85, 1.03, 0.85);
  box(desk, 0, 0.41, 0.415, 2.65, 0.73, 0.09, "#31584f");
  for (let i = 0; i < 24; i++)
    box(desk, -1.26 + i * 0.11, 0.42, 0.475, 0.034, 0.72, 0.045, "#668976");
  plaque(
    desk,
    -0.72,
    0.51,
    0.5,
    0.77,
    0.22,
    "ORDER DESK",
    "CUSTOMER SERVICE",
    "#e9e5d9",
    "#2e4a41",
  );
  chair(root, -2.95, -1.17);
  const computer = tag(group(desk, 0.2, 0.85, -0.02), { kind: "monitor" });
  box(computer, 0, 0.025, 0, 0.38, 0.05, 0.24, "#283733", true);
  box(computer, 0, 0.17, 0, 0.075, 0.3, 0.06, "#374641");
  box(computer, 0, 0.42, 0, 0.75, 0.45, 0.055, "#263431", true);
  const monitor = screen(computer, 0, 0.422, -0.032, 0.7, 0.397, () => {});
  monitor.face.rotation.y = Math.PI;
  box(computer, -0.08, 0.019, -0.28, 0.46, 0.03, 0.14, "#374744", true);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 11; c++)
      box(
        computer,
        -0.277 + c * 0.039,
        0.038,
        -0.32 + r * 0.034,
        0.03,
        0.01,
        0.023,
        "#69766f",
      );
  box(computer, -0.31, 0.024, -0.28, 0.074, 0.046, 0.106, "#293937", true);
  // Customer-facing operations display on the rear wall.
  const display = tag(group(root, 0.47, 2.01, -3.64), { kind: "queue" });
  box(display, 0, 0, 0, 1.6, 0.83, 0.07, "#213732", true);
  const queue = screen(display, 0, 0, 0.041, 1.52, 0.75, () => {});
  const counter = tag(group(root, pickup.x, 0, pickup.z), { kind: "pickup" });
  box(counter, 0, 0.45, 0, 1.9, 0.9, 0.68, "#60806f", true);
  laminate(counter, 0, 0.932, 0, 2.02, 0.78);
  plaque(
    counter,
    0,
    0.6,
    0.37,
    1.03,
    0.26,
    "COLLECTION",
    "SHOW PICKUP CODE",
    "#e9e5d9",
    "#244c3d",
  );
  const qr = tag(group(root, -4.6, 0, 2.57), { kind: "qr" });
  box(qr, 0, 0.025, 0, 0.51, 0.05, 0.37, "#3c5149", true);
  box(qr, 0, 0.76, 0, 0.055, 1.44, 0.055, "#4d6259");
  box(qr, 0, 1.48, 0, 0.59, 0.73, 0.035, "#e7e5da", true);
  const qrCode = QRCode.create(
    location.origin + "/shop/" + encodeURIComponent(shopId),
  );
  screen(
    qr,
    0,
    1.48,
    0.021,
    0.55,
    0.69,
    (c, W, H) => {
      c.fillStyle = "#f9f9ef";
      c.fillRect(0, 0, W, H);
      text(c, "ORDER HERE", W * 0.1, H * 0.15, W * 0.115, "#174840", 750);
      const size = W * 0.7,
        step = size / qrCode.modules.size;
      c.fillStyle = "#183b34";
      for (let row = 0; row < qrCode.modules.size; row++)
        for (let col = 0; col < qrCode.modules.size; col++)
          if (qrCode.modules.get(row, col))
            c.fillRect(
              Math.round(W * 0.15 + col * step),
              Math.round(H * 0.23 + row * step),
              Math.ceil(step),
              Math.ceil(step),
            );
      text(c, "SCAN TO PRINT", W * 0.14, H * 0.92, W * 0.093, "#264a40");
    },
    384,
  );
  const payments = group(desk, 0.98, 0.85, 0.24);
  box(payments, 0, 0.014, 0, 0.39, 0.024, 0.16, "#46645a", true);
  box(payments, 0, 0.22, 0, 0.36, 0.42, 0.025, "#edece2", true);
  const paymentCode = QRCode.create(
    location.origin + "/shop/" + encodeURIComponent(shopId) + "#my-orders",
  );
  screen(
    payments,
    0,
    0.22,
    0.015,
    0.35,
    0.4,
    (c, W, H) => {
      c.fillStyle = "#f4f2e8";
      c.fillRect(0, 0, W, H);
      text(
        c,
        demo ? "PAY BY QR" : "PAY IN PORTAL",
        W * 0.09,
        H * 0.13,
        W * 0.085,
        "#294c42",
      );
      const step = (W * 0.67) / paymentCode.modules.size;
      c.fillStyle = "#193c34";
      for (let y = 0; y < paymentCode.modules.size; y++)
        for (let x = 0; x < paymentCode.modules.size; x++)
          if (paymentCode.modules.get(y, x))
            c.fillRect(
              W * 0.165 + x * step,
              H * 0.21 + y * step,
              Math.ceil(step),
              Math.ceil(step),
            );
      text(c, "YOUR ORDERS", W * 0.16, H * 0.92, W * 0.085, "#284d40");
    },
    256,
  );
  // The entrance descends from the raised shop slab to the exterior pavement.
  for (let step = 0; step < 3; step++) {
    const top = -0.11 * (step + 1),
      height = top + 0.44;
    box(
      root,
      0,
      -0.44 + height / 2,
      4.46 + step * 0.28,
      11.56,
      height,
      0.28,
      "#a9b4a8",
    );
  }
  const front = group(root, -5.05, 0, 3.9);
  box(front, 0, 1.17, 0, 0.09, 2.34, 0.1, "#31564e");
  box(front, 1.52, 1.17, 0, 0.09, 2.34, 0.1, "#31564e");
  plaque(
    front,
    0.76,
    2.3,
    0.01,
    1.64,
    0.38,
    "PRINTFLOW",
    "XEROX  •  PRINT  •  SCAN",
  );
  box(front, 0.76, 0.012, -0.23, 1.48, 0.022, 0.67, "#62766a");
  const door = group(front, -0.02, 0, 0);
  door.rotation.y = -Math.PI * 0.46;
  const glazing = new T.MeshStandardMaterial({
    color: "#b8d4c9",
    transparent: true,
    opacity: 0.17,
    roughness: 0.24,
    depthWrite: false,
  });
  box(door, 0.68, 1.08, 0, 1.32, 2.05, 0.025, glazing);
  for (const dx of [0, 1.35])
    box(door, dx, 1.09, 0, 0.041, 2.17, 0.05, "#526b63");
  for (const y of [0.1, 2.15])
    box(door, 0.68, y, 0, 1.35, 0.044, 0.051, "#526b63");
  box(door, 1.21, 1.08, 0.065, 0.032, 0.29, 0.035, "#3f514e", true);
  for (const z of [1.3, 2.17, 3.04])
    for (const x of [-3.62, 2.33])
      box(root, x, 0.005, z, 0.4, 0.005, 0.036, "#8faaa0");
  // Stationery, cable raceway, sockets, calendar and supplies.
  box(root, 1.84, 1.39, -3.65, 5.5, 0.06, 0.07, "#d7d4c8");
  for (let id = 1; id <= 3; id++) {
    const x = machineX(id);
    box(root, x, 1.39, -3.59, 0.21, 0.13, 0.05, "#f7f4e9", true);
    for (const dx of [-0.055, 0.055])
      box(root, x + dx, 1.39, -3.558, 0.025, 0.033, 0.012, "#555e56");
    plaque(
      root,
      x,
      1.66,
      -3.64,
      0.62,
      0.25,
      "PRESS 0" + id,
      id === 2 ? "COLOUR" : "MONO",
      "#f1eee4",
      "#35534b",
    );
  }
  const calendar = group(root, -4.96, 1.96, -3.66);
  plaque(
    calendar,
    0,
    0,
    0,
    0.63,
    0.75,
    "CHENNAI",
    "LOCAL PRINT SERVICES",
    "#eae3ca",
    "#425e50",
  );
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 6; i++)
      box(
        calendar,
        -0.23 + i * 0.088,
        -0.14 - j * 0.063,
        0.035,
        0.043,
        0.025,
        0.009,
        "#65796c",
      );
  for (let i = 0; i < 5; i++)
    box(
      desk,
      0.86,
      0.855 + i * 0.012,
      -0.19,
      0.32,
      0.011,
      0.22,
      i === 4 ? "#a4c5b6" : "#f3efe0",
    );
  bench(root, 4.92, 0.65, 0.65, 2.06, 0.425);
  for (const z of [-0.23, 1.53])
    box(root, 5.18, 0.63, z, 0.04, 0.59, 0.048, "#425651", true);
  for (const seat of waitingSeats) {
    box(root, 4.91, 0.442, seat.z, 0.56, 0.052, 0.638, "#547169", true);
    box(root, 5.15, 0.735, seat.z, 0.072, 0.38, 0.638, "#5d7b70", true);
  }
  const lamp = group(root, -2.3, 0.85, -0.06);
  box(lamp, 0, 0.09, 0, 0.1, 0.18, 0.1, "#a57952", true);
  for (let i = 0; i < 4; i++)
    box(
      lamp,
      -0.03 + i * 0.018,
      0.23,
      0.01,
      0.012,
      0.19,
      0.012,
      ["#296457", "#28464e", "#9d3e31", "#475650"][i],
    );
  batch(root);
  const printers = [1, 2, 3].map((id) => {
    const g = tag(group(root, machineX(id), tableY, machineZ), {
      kind: "printer",
      id: String(id),
    });
    const stub = group(g);
    box(stub, 0, 0.23, 0, 0.82, 0.46, 0.62, "#e1e1d6", true);
    box(stub, 0, 0.56, -0.2, 0.82, 0.24, 0.2, "#485a53");
    box(stub, 0, 0.69, 0, 0.83, 0.15, 0.66, "#abb6ae", true);
    copierTemplate ??= new GLTFLoader()
      .loadAsync("/models/copier.glb")
      .then((g) => g.scene)
      .catch((e) => {
        copierTemplate = undefined;
        throw e;
      });
    void copierTemplate
      .then((template) => {
        if (!g.parent) return;
        const clone = template.clone(true);
        clone.traverse((o) => {
          if (o instanceof T.Mesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        g.add(clone);
        stub.visible = false;
      })
      .catch(() => {});
    const light = box(
      g,
      0.367,
      0.679,
      0.34,
      0.027,
      0.018,
      0.012,
      "#47a986",
      true,
    );
    const sheet = box(g, 0, 0.47, -0.105, 0.211, 0.004, 0.001, "#fffef5");
    const stack = box(g, 0, 0.435, 0.185, 0.216, 0.005, 0.299, "#fbfaf1", true);
    stack.visible = sheet.visible = false;
    const supply = box(g, -0.1, 0.315, 0.325, 0.34, 0.008, 0.018, "#efece0");
    const drawer = box(
      g,
      -0.1,
      0.286,
      0.326,
      0.37,
      0.023,
      0.021,
      "#768981",
      true,
    );
    return { id, root: g, light, sheet, stack, supply, drawer };
  });
  function drawDisplays(tokens: string[], normal: number, express: number) {
    function paint(c: CanvasRenderingContext2D, W: number, H: number) {
      c.fillStyle = "#102e2c";
      c.fillRect(0, 0, W, H);
      text(
        c,
        "PRINTFLOW  /  LIVE QUEUE",
        W * 0.05,
        H * 0.19,
        W * 0.045,
        "#a9e2cb",
      );
      text(
        c,
        "Normal  " + normal + "     Express  " + express,
        W * 0.05,
        H * 0.4,
        W * 0.067,
        "#f4f7e9",
      );
      tokens
        .slice(0, 3)
        .forEach((t, i) =>
          text(c, t, W * 0.06, H * (0.57 + 0.155 * i), W * 0.042, "#dcece0"),
        );
    }
    queue.draw(paint);
    monitor.draw(paint);
  }
  drawDisplays([shopName], 0, 0);
  return { root, printers, drawDisplays };
}
