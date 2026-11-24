import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { box, group, mat, screen } from "./fixtures";

const templates = new Map<string, ReturnType<GLTFLoader["loadAsync"]>>();
export function hash(id: string) {
  let h = 5381;
  for (const c of id) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return h;
}
const shirts = [
  "#31635e",
  "#7895a6",
  "#925247",
  "#bd9471",
  "#577753",
  "#6a6490",
  "#426179",
];
const helmetShell = new T.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, 1.83);

function courierUniform(root: T.Group, model?: T.Object3D) {
  const golden = "#f8c72d", webbing = "#28352e";
  const attach = (part: T.Group, bone: string, height: number) => {
    const joint = model?.getObjectByName(bone);
    if (!joint) {
      part.position.set(0, height, 0);
      return;
    }
    part.position.copy(root.worldToLocal(joint.getWorldPosition(new T.Vector3())));
    joint.attach(part);
  };
  const pack = group(root);
  box(pack, 0, 0.075, -0.233, 0.36, 0.41, 0.25, golden, true);
  box(pack, 0, 0.253, -0.234, 0.371, 0.058, 0.257, golden, true);
  box(pack, 0, 0.218, -0.234, 0.367, 0.012, 0.254, webbing, true);
  box(pack, 0, -0.121, -0.234, 0.361, 0.023, 0.254, webbing, true);
  for (const side of [-1, 1]) {
    box(pack, side * 0.173, 0.052, -0.359, 0.012, 0.335, 0.008, webbing);
    box(pack, side * 0.089, 0.119, 0.105, 0.029, 0.27, 0.017, webbing, true);
    box(pack, side * 0.089, 0.246, 0.004, 0.029, 0.026, 0.213, webbing, true);
    box(pack, side * 0.091, 0.066, 0.117, 0.032, 0.021, 0.009, "#c5cebc");
  }
  const badge = screen(pack, 0, 0.085, -0.365, 0.253, 0.09, (ctx, w, h) => {
    ctx.fillStyle = golden;
    ctx.fillRect(0, 0, w, h);
    ctx.font = "bold " + Math.round(h * 0.81) + "px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#193724";
    ctx.fillText("blinkit", w / 2, h * 0.53);
  }, 256).face;
  badge.rotation.y = Math.PI;
  attach(pack, "Torso", 1.06);
  const helmet = group(root);
  const shell = new T.Mesh(helmetShell, mat(golden));
  shell.position.set(0, 0.14, -0.003);
  shell.scale.set(0.128, 0.109, 0.135);
  shell.castShadow = true;
  helmet.add(shell);
  box(helmet, 0, 0.124, 0.098, 0.203, 0.016, 0.137, webbing, true);
  for (const side of [-1, 1])
    box(helmet, side * 0.108, 0.079, 0.006, 0.011, 0.077, 0.017, webbing, true);
  attach(helmet, "Head", 1.46);
  return () => {
    badge.material.map?.dispose();
    badge.material.dispose();
    badge.geometry.dispose();
  };
}
const blocked = [
  [-4.85, -1.5, -0.99, 0.4],
  [-1.24, 4.75, -3.12, -1.7],
  [4.11, 5.76, -3.36, -2.0],
  [-0.69, 1.59, 0.02, 1.1],
  [4.39, 5.44, -0.62, 1.9],
  [-4.98, -4.23, 2.23, 2.95],
];
const grid = 0.25;
const distance = (a: T.Vector3, b: T.Vector3) =>
  Math.hypot(a.x - b.x, a.z - b.z);
function route(start: T.Vector3, end: T.Vector3, people: T.Vector3[]) {
  const x0 = -5.5,
    z0 = -3.4;
  const width = 46,
    rows = Math.ceil((Math.max(start.z, end.z, 5.6) - z0 + 1) / grid);
  const cell = (p: T.Vector3) =>
    Math.max(0, Math.min(width - 1, Math.round((p.x - x0) / grid))) +
    Math.max(0, Math.min(rows - 1, Math.round((p.z - z0) / grid))) * width;
  const pos = (n: number) =>
    new T.Vector3(
      x0 + (n % width) * grid,
      0,
      z0 + Math.floor(n / width) * grid,
    );
  const first = cell(start),
    last = cell(end),
    open = [first],
    parent = new Map<number, number>(),
    cost = new Map([[first, 0]]);
  const score = (n: number) => cost.get(n)! + distance(pos(n), end) / grid;
  const allowed = (p: T.Vector3) =>
    !blocked.some(([l, r, t, b]) => p.x > l && p.x < r && p.z > t && p.z < b) &&
    !people.some(
      (other) => distance(other, p) < 0.41 && distance(other, end) > 0.35,
    );
  while (open.length) {
    let best = 0;
    for (let i = 1; i < open.length; i++)
      if (score(open[i]) < score(open[best])) best = i;
    const cur = open.splice(best, 1)[0];
    if (cur === last) {
      const path = [end.clone()];
      let n = last;
      while (parent.has(n)) {
        const prev = parent.get(n)!;
        if (prev !== first) path.unshift(pos(prev));
        n = prev;
      }
      return path;
    }
    const x = cur % width,
      z = Math.floor(cur / width);
    for (const [a, b] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
    ]) {
      if (x + a < 0 || x + a >= width || z + b < 0 || z + b >= rows) continue;
      const n = cur + a + b * width;
      if (n !== last && !allowed(pos(n))) continue;
      if (a && b && (!allowed(pos(cur + a)) || !allowed(pos(cur + b * width))))
        continue;
      const value = cost.get(cur)! + Math.hypot(a, b);
      if (value >= (cost.get(n) ?? Infinity)) continue;
      parent.set(n, cur);
      cost.set(n, value);
      if (!open.includes(n)) open.push(n);
    }
  }
  return [];
}
export class Person {
  readonly root = new T.Group();
  readonly phone: T.Mesh;
  private hand?: T.Object3D;
  private leftHand?: T.Object3D;
  private armJoints: { right: T.Object3D[]; left: T.Object3D[] } = {
    right: [],
    left: [],
  };
  private model?: T.Object3D;
  private mixer?: T.AnimationMixer;
  private actions = new Map<string, T.AnimationAction>();
  private action = "";
  private at = 0;
  private goal?: T.Vector3;
  private path: T.Vector3[] = [];
  private dead = false;
  private removeUniform?: () => void;
  private ownMaterials: T.Material[] = [];
  private headYaw?: number;
  private wristTarget = new T.Vector3();
  seated = false;
  pose: "wait" | "phone" | "carry" | "work" = "wait";
  reach?: T.Vector3;
  facing = 0;
  constructor(scene: T.Scene, id: string, staff = false, courier = false) {
    scene.add(this.root);
    this.phone = box(this.root, 0, 1, 0, 0.073, 0.143, 0.011, "#1b292d", true);
    this.phone.visible = false;
    box(this.phone, 0, 0, 0.53, 0.83, 0.85, 0.04, "#97d4cd");
    const seed = hash(id),
      woman = id === "worker" || (!staff && seed % 2 === 0);
    const url = woman ? "/models/casual-woman.glb" : "/models/casual-man.glb";
    let template = templates.get(url);
    if (!template) {
      template = new GLTFLoader().loadAsync(url);
      templates.set(url, template);
    }
    void template
      .then((gltf) => {
        if (this.dead) return;
        const model = clone(gltf.scene);
        model.scale.setScalar(
          (1.63 + (seed % 14) / 100) / (woman ? 4.655 : 4.841),
        );
        this.root.add(model);
        this.model = model;
        model.traverse((o) => {
          if (o instanceof T.Mesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            o.frustumCulled = false;
            const recolor = (m: T.Material) => {
              if (!(m instanceof T.MeshStandardMaterial)) return m;
              const copy = m.clone();
              this.ownMaterials.push(copy);
              if (/shirt/i.test(m.name))
                copy.color.set(
                  courier ? "#f8c72d" : staff ? "#346459" : shirts[seed % shirts.length],
                );
              if (courier && /pants|shoes/i.test(m.name)) copy.color.set("#293b36");
              if (/skin/i.test(m.name))
                copy.color.set(
                  ["#ab7658", "#bc8767", "#855a40", "#a66e50"][seed % 4],
                );
              return copy;
            };
            o.material = Array.isArray(o.material)
              ? o.material.map(recolor)
              : recolor(o.material);
          }
        });
        this.hand = model.getObjectByName("PalmR");
        this.leftHand = model.getObjectByName("PalmL");
        for (const side of ["right", "left"] as const) {
          for (const bone of ["LowerArm", "UpperArm"]) {
            const joint = model.getObjectByName(
              bone + (side === "right" ? "R" : "L"),
            );
            if (joint) this.armJoints[side].push(joint);
          }
        }
        this.mixer = new T.AnimationMixer(model);
        for (const clip of gltf.animations) {
          const name = clip.name.split("_").at(-1)!;
          if (["Idle", "Walk", "Sitting"].includes(name))
            this.actions.set(name, this.mixer.clipAction(clip));
        }
        this.animate(false, courier ? 0.2 : 0);
        if (courier) this.removeUniform = courierUniform(this.root, model);
      })
      .catch(() => {
        if (!this.dead) {
          const fallback = group(this.root);
          box(
            fallback,
            0,
            1,
            0,
            0.38,
            0.64,
            0.23,
            courier ? "#f8c72d" : shirts[seed % shirts.length],
            true,
          );
          box(fallback, 0, 1.47, 0, 0.23, 0.27, 0.21, "#aa7959", true);
          for (const x of [-0.11, 0.11])
            box(fallback, x, 0.37, 0, 0.15, 0.74, 0.16, "#405059", true);
          if (courier) this.removeUniform = courierUniform(this.root);
        }
      });
  }
  place(x: number, z: number, angle = 0) {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = this.facing = angle;
    this.goal = undefined;
    this.path = [];
  }
  move(end: T.Vector3, others: T.Vector3[]) {
    if (!this.path.length && distance(this.root.position, end) < 0.06) {
      this.goal = end;
      return;
    }
    if (
      this.goal &&
      distance(end, this.goal) < 0.06 &&
      (this.path.length || distance(this.root.position, end) < 0.09)
    )
      return;
    this.goal = end.clone();
    this.path = route(this.root.position, end, others);
  }
  get arrived() {
    return (
      !this.path.length &&
      (!this.goal || distance(this.root.position, this.goal) < 0.09)
    );
  }
  palm(out: T.Vector3) {
    return this.hand
      ? this.hand.getWorldPosition(out)
      : out.copy(this.root.position).add(new T.Vector3(0.18, 1.05, 0.17));
  }
  private animate(walk: boolean, dt: number) {
    const name = this.seated ? "Sitting" : walk ? "Walk" : "Idle";
    if (name !== this.action && this.actions.has(name)) {
      const previous = this.actions.get(this.action);
      const a = this.actions.get(name)!.reset();
      if (previous) {
        previous.fadeOut(0.18);
        a.fadeIn(0.18);
      }
      a.play();
      if (name === "Sitting") {
        a.time = 2.6;
        a.paused = true;
      }
      this.action = name;
    }
    this.mixer?.update(dt);
  }
  private aim(point: T.Vector3, side: "right" | "left" = "right") {
    const hand = side === "right" ? this.hand : this.leftHand;
    if (!hand) return;
    for (let pass = 0; pass < 4; pass++)
      for (const joint of this.armJoints[side]) {
        if (!joint?.parent) continue;
        const origin = joint.getWorldPosition(new T.Vector3());
        const from = hand
            .getWorldPosition(new T.Vector3())
            .sub(origin)
            .normalize(),
          to = point.clone().sub(origin).normalize();
        const change = new T.Quaternion().setFromUnitVectors(from, to);
        const world = joint
          .getWorldQuaternion(new T.Quaternion())
          .premultiply(change);
        joint.quaternion.copy(
          joint.parent
            .getWorldQuaternion(new T.Quaternion())
            .invert()
            .multiply(world),
        );
        joint.updateWorldMatrix(false, true);
      }
  }
  update(dt: number) {
    this.at += dt;
    let remaining = dt * 1.48;
    const walking = this.path.length > 0;
    while (remaining > 0 && this.path.length) {
      const dest = this.path[0],
        p = this.root.position,
        dist = distance(p, dest);
      if (dist > 0.005) this.facing = Math.atan2(dest.x - p.x, dest.z - p.z);
      if (dist <= remaining) {
        p.copy(dest);
        this.path.shift();
        remaining -= dist;
      } else {
        p.lerp(dest, remaining / dist);
        remaining = 0;
      }
    }
    const streetDepth = this.root.position.z - 4.32;
    this.root.position.y =
      -0.11 * Math.min(4, Math.max(0, Math.ceil(streetDepth / 0.28)));
    const delta = this.facing - this.root.rotation.y;
    this.root.rotation.y +=
      Math.atan2(Math.sin(delta), Math.cos(delta)) * (1 - Math.exp(-dt * 10));
    this.animate(walking, dt);
    this.root.updateWorldMatrix(true, true);
    this.phone.visible = !walking && this.pose === "phone";
    if (this.reach) this.aim(this.reach);
    else if (this.pose === "work") {
      const mouse = Math.floor(this.at / 4) % 3 === 2;
      this.wristTarget.set(
        mouse ? -0.3 : -0.1,
        0.895 + 0.011 * Math.sin(this.at * 9),
        mouse ? 0.35 : 0.39,
      );
      this.aim(this.root.localToWorld(this.wristTarget));
      this.wristTarget.set(0.05, 0.895 + 0.013 * Math.cos(this.at * 8), 0.39);
      this.aim(this.root.localToWorld(this.wristTarget), "left");
    } else if (this.phone.visible || this.pose === "carry") {
      this.wristTarget.set(-0.2, this.pose === "phone" ? 1.25 : 1.01, 0.27);
      this.aim(this.root.localToWorld(this.wristTarget));
    }
    if (this.phone.visible) {
      this.phone.position.copy(
        this.root.worldToLocal(this.palm(new T.Vector3())),
      );
      this.phone.rotation.x = -0.45;
    }
    if (this.seated && this.model) {
      const head = this.model.getObjectByName("Head");
      if (head) {
        this.headYaw ??= head.rotation.y;
        head.rotation.y = this.headYaw + 0.04 * Math.sin(this.at * 2);
      }
    }
  }
  dispose() {
    this.dead = true;
    this.removeUniform?.();
    this.mixer?.stopAllAction();
    if (this.model) this.mixer?.uncacheRoot(this.model);
    this.ownMaterials.forEach((m) => m.dispose());
    this.root.removeFromParent();
  }
}
