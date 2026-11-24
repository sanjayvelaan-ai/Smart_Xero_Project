import * as T from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  box,
  buildFixtures,
  machineX,
  machineZ,
  mat,
  pickup,
  tableY,
  tray,
  waitingSeats,
} from "./fixtures";
import { Person } from "./people";
import {
  type Camera,
  type Customer,
  type Floor,
  type Selection,
} from "./state";
import type { ShopEvent } from "../domain";

const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
const handoffPosition = v(1.84, 0, 1.05);
const entrance = v(-4.3, 0, 3.9);
const pavement = v(-4.3, 0, 5.55);
type Resident = {
  actor: Person;
  order: Customer;
  slot: T.Vector3;
  arrival: number;
  leaving: boolean;
  depart: boolean;
  atDoor: boolean;
  label: T.Sprite;
  seat?: T.Vector3;
  courier?: {
    actor: Person;
    slot: T.Vector3;
    stage: "entering" | "waiting" | "exiting" | "outside";
  };
};
type Delivery = {
  id: string;
  printer: number;
  paper: T.Mesh;
  phase:
    | "reported"
    | "retrieve"
    | "meet"
    | "output"
    | "collect"
    | "carry"
    | "place"
    | "counter"
    | "give"
    | "received";
  age: number;
  verified: boolean;
  slot: T.Vector3;
  from: T.Vector3;
};
type Shot = { view: Camera; order?: string; printer?: number };
const eventsToCamera: Partial<Record<ShopEvent["type"], Camera>> = {
  ORDER_CREATED: "Entrance",
  SERVICE_MODE_SELECTED: "Customer phone",
  PAYMENT_CONFIRMED: "Customer phone",
  OWNER_NOTIFIED: "Owner monitor",
  ORDER_QUEUED: "Waiting area",
  PRINTER_ASSIGNED: "Paper output",
  PRINT_STARTED: "Paper output",
  PRINT_COMPLETED: "Follow worker",
  ORDER_READY_FOR_PICKUP: "Pickup counter",
  PICKUP_VERIFIED: "Pickup counter",
  ORDER_COMPLETED: "Follow customer",
};
function tokenLabel(order: Customer) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = order.mode === "EXPRESS" ? "#88580d" : "#174f49";
  ctx.beginPath();
  ctx.roundRect(2, 2, 252, 60, 22);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.font = "600 32px Arial";
  ctx.fillText(order.token, 128, 44);
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  const label = new T.Sprite(
    new T.SpriteMaterial({ map: tex, depthWrite: false }),
  );
  label.position.y = 1.96;
  label.scale.set(0.85, 0.212, 1);
  return label;
}
export function waitingSlots(orders: Customer[]) {
  const slots = new Map<string, T.Vector3>();
  for (const mode of ["NORMAL", "EXPRESS"] as const) {
    const list = orders
      .filter((o) => o.mode === mode)
      .sort(
        (a, b) =>
          (a.queuePosition ?? 999) - (b.queuePosition ?? 999) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id),
      );
    list.forEach((o, i) =>
      slots.set(
        o.id,
        v(
          (mode === "NORMAL" ? -3.65 : 1.87) + (i % 3) * 0.85,
          0,
          1.55 + Math.floor(i / 3) * 0.88,
        ),
      ),
    );
  }
  return slots;
}

export class ShopScene {
  readonly world = new T.Scene();
  readonly renderer: T.WebGLRenderer;
  readonly camera = new T.PerspectiveCamera(37, 1, 0.06, 130);
  private control: OrbitControls;
  private fixtures: ReturnType<typeof buildFixtures>;
  private owner: Person;
  private worker: Person;
  private residents = new Map<string, Resident>();
  private deliveries = new Map<string, Delivery>();
  private floor: Floor = { orders: [], printers: [] };
  private ring: T.Mesh;
  private selected: Selection | null = null;
  private frame = 0;
  private last = 0;
  private age = 0;
  private paused = false;
  private speed = 1;
  private cameraMode: Camera = "Shop overview";
  private cinematic = true;
  private shots: Shot[] = [];
  private shot: Shot = { view: "Shop overview" };
  private hold = 0;

  private observer: ResizeObserver;
  private sound?: AudioContext;
  private tone?: OscillatorNode;
  private gain?: GainNode;
  private down = [0, 0];
  private keyLight: T.DirectionalLight;
  private closed = false;
  private visible = true;
  private onVisibility = () => {
    this.visible = document.visibilityState !== "hidden";
    this.last = 0;
  };
  private contextLost = (e: Event) => {
    e.preventDefault();
    this.onLoss();
  };
  private onDown = (e: PointerEvent) => {
    this.down = [e.clientX, e.clientY];
  };
  private onUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) > 5)
      return;
    const r = this.host.getBoundingClientRect(),
      ray = new T.Raycaster();
    ray.setFromCamera(
      new T.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        1 - ((e.clientY - r.top) / r.height) * 2,
      ),
      this.camera,
    );
    for (const hit of ray.intersectObjects(this.world.children, true)) {
      let o: T.Object3D | null = hit.object;
      while (o && !o.userData.target) o = o.parent;
      if (o) {
        this.onSelect(o.userData.target);
        return;
      }
    }
  };
  constructor(
    private host: HTMLDivElement,
    private demo: boolean,
    shop: string,
    name: string,
    private onSelect: (s: Selection) => void,
    private onManual: () => void,
    private onLoss: () => void,
  ) {
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.55));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Interactive print shop floor",
    );
    host.appendChild(this.renderer.domElement);
    this.world.background = new T.Color("#dbe5df");
    this.world.add(new T.HemisphereLight("#fff9ed", "#abbab1", 2.05));
    this.keyLight = new T.DirectionalLight("#fff1d8", 3.1);
    this.keyLight.position.set(-3, 10, 7);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    Object.assign(this.keyLight.shadow.camera, {
      left: -9,
      right: 9,
      top: 8,
      bottom: -8,
      near: 0.1,
      far: 38,
    });
    this.keyLight.shadow.normalBias = 0.026;
    this.keyLight.shadow.bias = -0.00022;
    this.world.add(this.keyLight);
    const floor = box(this.world, 0, -0.49, 0, 150, 0.1, 150, "#c4d2c8");
    floor.castShadow = false;
    this.fixtures = buildFixtures(this.world, shop, name, demo);
    this.owner = new Person(this.world, "ram", true);
    this.owner.place(-2.95, -0.98, 0);
    this.owner.seated = true;
    this.owner.pose = "work";
    this.worker = new Person(this.world, "worker", true);
    this.worker.place(0.5, -0.47, 0.04);
    this.ring = new T.Mesh(
      new T.TorusGeometry(0.41, 0.026, 8, 48),
      new T.MeshBasicMaterial({ color: "#007969" }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.world.add(this.ring);
    this.ring.visible = false;
    this.camera.position.set(8.9, 7.9, 12.6);
    this.control = new OrbitControls(this.camera, this.renderer.domElement);
    this.control.target.set(0, 0.55, 0.13);
    this.control.enableDamping = true;
    this.control.maxPolarAngle = Math.PI * 0.489;
    this.control.minDistance = 0.42;
    this.control.maxDistance = 30;
    this.control.addEventListener("start", () => {
      this.cameraMode = "Free camera";
      this.cinematic = false;
      this.shots = [];
      this.onManual();
    });
    this.control.update();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.renderer.domElement.addEventListener("pointerdown", this.onDown);
    this.renderer.domElement.addEventListener("pointerup", this.onUp);
    this.renderer.domElement.addEventListener(
      "webglcontextlost",
      this.contextLost,
    );
    document.addEventListener("visibilitychange", this.onVisibility);
    this.frame = requestAnimationFrame(this.tick);
  }
  private resize() {
    const { width, height } = this.host.getBoundingClientRect();
    this.renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }
  private removeResident(id: string) {
    const r = this.residents.get(id);
    if (!r) return;
    r.label.material.map?.dispose();
    r.label.material.dispose();
    r.actor.dispose();
    r.courier?.actor.dispose();
    this.residents.delete(id);
  }
  private courierFor(r: Resident, restore: boolean) {
    if (r.courier || !r.order.courier) return;
    const others = [...this.residents.values()].flatMap((p) =>
      p.courier ? [p.courier.slot] : [],
    );
    let i = 0;
    let slot = v(2.58, 0, 0.56);
    while (others.some((p) => p.distanceToSquared(slot) < 0.01)) {
      i++;
      slot = v(2.58 + (i % 3) * 0.7, 0, 0.56 + Math.floor(i / 3) * 0.72);
    }
    const actor = new Person(this.world, "courier-" + r.order.id, false, true);
    actor.root.add(r.label);
    actor.root.userData.target = { kind: "order", id: r.order.id };
    const start = restore ? slot : pavement;
    actor.place(start.x, start.z, restore ? -Math.PI / 2 : Math.PI);
    r.courier = { actor, slot, stage: restore ? "waiting" : "entering" };
  }
  private clear() {
    for (const id of this.residents.keys()) this.removeResident(id);
    for (const d of this.deliveries.values()) d.paper.removeFromParent();
    this.deliveries.clear();
    this.shots = [];
    this.hold = 0;
    this.shot = { view: "Shop overview" };
    this.worker.place(0.5, -0.47);
    this.worker.reach = undefined;
    this.worker.pose = "wait";
  }
  private parcel(id: string, printer: number, ready: boolean) {
    const existing = this.deliveries.get(id);
    if (existing) return existing;
    let i = 0;
    const next = () =>
      v(
        pickup.x - 0.6 + (i % 5) * 0.29,
        pickup.y + Math.floor(i / 10) * 0.022,
        pickup.z - 0.31 + Math.floor((i % 10) / 5) * 0.29,
      );
    let slot = next();
    while (
      [...this.deliveries.values()].some((d) => d.slot.distanceTo(slot) < 0.02)
    ) {
      i++;
      slot = next();
    }
    const paper = box(
      this.world,
      0,
      0,
      0,
      0.212,
      0.012,
      0.297,
      "#fffef2",
      true,
    );
    box(paper, -0.1, 0.54, 0, 0.07, 0.03, 0.72, "#659889");
    paper.position.copy(ready ? slot : tray(printer));
    const delivery: Delivery = {
      id,
      printer,
      paper,
      phase: ready ? "counter" : this.demo ? "output" : "reported",
      age: 0,
      verified: false,
      slot,
      from: new T.Vector3(),
    };
    this.deliveries.set(id, delivery);
    return delivery;
  }
  sync(floor: Floor, events: ShopEvent[], reset: boolean) {
    if (reset) this.clear();
    const eligible = floor.orders.filter((o) =>
      !o.courier && (!o.collectionAt || o.collectionDue) && ["QUEUED", "ASSIGNED", "PRINTING", "FINISHING", "HELD"].includes(o.status),
    );
    const seats = new Map<string, T.Vector3>();
    for (const o of eligible) {
      const existing = this.residents.get(o.id)?.seat;
      if (existing) seats.set(o.id, existing);
    }
    const occupied = new Set(seats.values());
    const freeSeats = waitingSeats.filter((s) => !occupied.has(s));
    eligible.sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    for (const o of eligible) {
      if (seats.has(o.id)) continue;
      const next = freeSeats.shift();
      if (!next) break;
      seats.set(o.id, next);
    }
    const slots = waitingSlots(floor.orders.filter((o) => !o.courier && (!o.collectionAt || o.collectionDue) && !seats.has(o.id)));
    for (const o of floor.orders) if (!slots.has(o.id) && !seats.has(o.id)) slots.set(o.id, pavement);
    seats.forEach((slot, id) => slots.set(id, slot));
    const created = new Set(
      events.filter((e) => e.type === "ORDER_CREATED").map((e) => e.orderId),
    );
    for (const o of floor.orders) {
      let r = this.residents.get(o.id);
      if (!r) {
        const actor = new Person(this.world, o.id),
          label = tokenLabel(o);
        actor.root.add(label);
        actor.root.userData.target = { kind: "order", id: o.id };
        const slot = slots.get(o.id)!;
        const entering = this.demo && !o.courier && !o.collectionAt && !reset && created.has(o.id);
        const arrivals = [...this.residents.values()].filter(
          (person) => person.arrival >= 0,
        ).length;
        actor.place(
          entering ? -4.32 : slot.x,
          entering ? 4.55 + arrivals * 0.72 : slot.z,
          Math.PI,
        );
        r = {
          actor,
          label,
          order: o,
          slot,
          arrival: entering ? 0 : -1,
          leaving: false,
          depart: false,
          atDoor: false,
        };
        this.residents.set(o.id, r);
      }
      r.actor.root.visible = !o.courier && (!o.collectionAt || o.collectionDue === true);
      r.order = o;
      r.slot = slots.get(o.id)!;
      r.seat = seats.get(o.id);
      if (reset && r.seat) {
        r.actor.place(r.seat.x, r.seat.z, -Math.PI / 2);
        r.actor.seated = true;
        r.label.position.y = 1.46;
      }
      if (o.status === "READY" && (!o.collectionAt || o.collectionDue)) this.courierFor(r, reset || !this.demo);
      if (reset && ["READY", "FINISHING"].includes(o.status)) {
        const machine =
          events.findLast(
            (e) => e.orderId === o.id && e.type === "PRINT_COMPLETED",
          )?.payload.printerId ?? 1;
        const d = this.parcel(o.id, machine, o.status === "READY");
        d.verified = this.demo && events.some(
          (e) => e.orderId === o.id && (e.type === "PICKUP_VERIFIED" || e.type === "AUTO_COLLECTED"),
        );
      }
    }
    if (!reset)
      for (const e of events) {
        const id = e.orderId,
          printer = e.payload.printerId;
        if (e.type === "PRINT_COMPLETED" && id && this.residents.has(id))
          this.parcel(id, printer ?? 1, false);
        if (e.type === "WORKER_COLLECTED_PAPERS" && id) {
          const d = this.deliveries.get(id);
          if (d?.phase === "reported") d.phase = "output";
        }
        if (e.type === "COURIER_ARRIVED" && id) {
          const resident = this.residents.get(id);
          if (resident) this.courierFor(resident, !this.demo);
        }
        if (e.type === "CUSTOMER_ARRIVED" && id) {
          const resident = this.residents.get(id);
          if (resident) resident.actor.root.visible = true;
        }
        if (e.type === "ORDER_READY_FOR_PICKUP" && id) {
          const r = this.residents.get(id);
          if (r) {
            if (!r.order.collectionAt || r.order.collectionDue) this.courierFor(r, !this.demo);
            if (!this.deliveries.has(id)) this.parcel(id, printer ?? 1, true);
          }
        }
        if ((e.type === "PICKUP_VERIFIED" || e.type === "AUTO_COLLECTED") && id && this.demo) {
          const d = this.deliveries.get(id);
          if (d) d.verified = true;
        }
        if (
          (e.type === "ORDER_COMPLETED" || e.type === "ORDER_CANCELLED") &&
          id
        ) {
          const r = this.residents.get(id);
          const d = this.deliveries.get(id);
          if (d && (!d.verified || e.type === "ORDER_CANCELLED")) {
            d.paper.removeFromParent();
            this.deliveries.delete(id);
          }
          if (r) {
            r.leaving = true;
            r.arrival = -1;
            r.depart =
              !d?.verified || e.type === "ORDER_CANCELLED" || d.phase === "received";
          }
        }
        const view =
          e.type === "PRINTER_ASSIGNED" && printer
            ? (("Printer 0" + printer) as Camera)
            : eventsToCamera[e.type];
        if (
          this.cinematic &&
          view &&
          (this.demo ||
            !["Entrance", "Customer phone", "Follow customer"].includes(view))
        ) {
          const shot = { view, order: id ?? undefined, printer };
          if (this.shots.at(-1)?.view !== view) this.shots.push(shot);
          if (this.shots.length > 9) this.shots.splice(1, 1);
        }
      }
    for (const [id, r] of this.residents)
      if (!slots.has(id) && (!this.demo || !r.leaving)) this.removeResident(id);
    this.floor = floor;
    this.host.dataset.avatars = String(floor.orders.length);
    this.host.dataset.avatarIds = floor.orders
      .filter((o) => this.residents.has(o.id))
      .map((o) => o.avatarId)
      .sort()
      .join(",");
    this.host.dataset.printing = floor.orders
      .filter((o) => o.status === "PRINTING")
      .map((o) => o.printerId)
      .join(",");
    const normal = floor.orders.filter(
      (o) => o.status === "QUEUED" && o.mode === "NORMAL",
    ).length;
    const express = floor.orders.filter(
      (o) => o.status === "QUEUED" && o.mode === "EXPRESS",
    ).length;
    this.fixtures.drawDisplays(
      floor.orders
        .slice(0, 3)
        .map((o) => o.token + "   " + o.status.replaceAll("_", " ")),
      normal,
      express,
    );
  }
  suspend() {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.renderer.domElement.remove();
    void this.audio(false).catch(() => {});
  }
  attach(
    host: HTMLDivElement,
    onSelect: (s: Selection) => void,
    onManual: () => void,
    onLoss: () => void,
  ) {
    this.host = host;
    this.onSelect = onSelect;
    this.onManual = onManual;
    this.onLoss = onLoss;
    host.appendChild(this.renderer.domElement);
    this.observer.observe(host);
    this.resize();
    this.visible = document.visibilityState !== "hidden";
    this.last = 0;
    this.frame = requestAnimationFrame(this.tick);
  }
  select(selection: Selection | null) {
    this.selected = selection;
  }
  setCamera(view: Camera, auto: boolean) {
    this.cameraMode = view;
    this.cinematic = auto;
    this.hold = 0;
    this.shots = [];
    this.shot = { view };
  }
  playback(paused: boolean, speed: number) {
    this.paused = paused;
    this.speed = speed;
  }
  quality(low: boolean) {
    this.renderer.setPixelRatio(low ? 1 : Math.min(devicePixelRatio, 1.55));
    this.renderer.shadowMap.enabled = !low;
    this.resize();
  }
  async audio(enabled: boolean) {
    if (!enabled) {
      if (this.gain) this.gain.gain.value = 0;
      if (this.sound) await this.sound.suspend();
      return;
    }
    if (!this.sound) {
      this.sound = new AudioContext();
      this.tone = this.sound.createOscillator();
      this.tone.type = "triangle";
      this.tone.frequency.value = 77;
      this.gain = this.sound.createGain();
      this.gain.gain.value = 0;
      this.tone.connect(this.gain).connect(this.sound.destination);
      this.tone.start();
    }
    await this.sound.resume();
  }
  private traffic(exclude: Person) {
    return [...this.residents.values()]
      .flatMap((r) => r.courier ? [r.actor, r.courier.actor] : [r.actor])
      .filter((a) => a !== exclude && a.root.visible)
      .map((a) => a.root.position);
  }
  private advanceCourier(r: Resident, collecting: boolean, dt: number) {
    const c = r.courier!;
    const a = c.actor;
    if (r.depart && r.leaving && c.stage !== "outside") c.stage = "exiting";
    if (c.stage === "entering") {
      a.move(entrance, this.traffic(a));
      if (a.arrived) c.stage = "waiting";
    } else if (c.stage === "exiting" || c.stage === "outside") {
      a.move(c.stage === "exiting" ? entrance : pavement, this.traffic(a));
      if (a.arrived && c.stage === "exiting") c.stage = "outside";
      else if (a.arrived) {
        a.dispose();
        r.courier = undefined;
        const d = this.deliveries.get(r.order.id);
        d?.paper.removeFromParent();
        this.deliveries.delete(r.order.id);
        return;
      }
    } else {
      a.move(collecting ? handoffPosition : c.slot, this.traffic(a));
      if (a.arrived) a.facing = collecting ? Math.PI : -Math.PI / 2;
      if (!a.reach && this.deliveries.get(r.order.id)?.phase !== "received")
        a.pose = collecting ? "phone" : "wait";
    }
    a.update(dt);
  }
  private advancePeople(dt: number) {
    let scanPosition = 0;
    const nextPickup = this.nextHandoff();
    for (const [id, r] of this.residents) {
      const a = r.actor;
      const collecting = id === nextPickup;
      if (r.courier) this.advanceCourier(r, collecting, dt);
      if (!a.root.visible) {
        if (r.leaving && r.depart && !r.courier) this.removeResident(id);
        continue;
      }
      if (this.demo) {
        if (r.arrival >= 0) {
          const index = scanPosition++;
          const scan =
            index === 0 ? v(-4.59, 0, 3.21) : v(-4.32, 0, 3.45 + index * 0.73);
          a.move(scan, this.traffic(a));
          if (a.arrived && index === 0) {
            r.arrival += dt;
            a.facing = Math.PI;
            a.pose = "phone";
            if (r.arrival > 1.45) r.arrival = -1;
          }
        } else if (r.leaving && r.depart && !r.courier) {
          a.seated = false;
          a.move(r.atDoor ? pavement : entrance, this.traffic(a));
          if (a.arrived && !r.atDoor) r.atDoor = true;
          else if (a.arrived) {
            this.removeResident(id);
            const d = this.deliveries.get(id);
            d?.paper.removeFromParent();
            this.deliveries.delete(id);
            continue;
          }
        } else if (!r.leaving || r.courier || collecting) {
          const atPickup = collecting && !r.courier;
          const target = atPickup ? handoffPosition : r.slot;
          a.move(target, this.traffic(a));
          a.seated = !!r.seat && !atPickup && a.arrived;
          if (a.arrived) a.facing = a.seated ? -Math.PI / 2 : Math.PI;
          a.pose =
            atPickup || r.order.status === "AWAITING_PAYMENT"
              ? "phone"
              : "wait";
        }
      } else {
        a.seated = !!r.seat;
        a.place(r.slot.x, r.slot.z, r.seat ? -Math.PI / 2 : Math.PI);
        a.pose = "wait";
      }
      r.label.position.y = a.seated ? 1.46 : 1.96;
      a.update(dt);
    }
    this.owner.update(dt);

    const transport =
      [...this.deliveries.values()].find((d) =>
        ["collect", "carry", "place", "retrieve", "meet", "give"].includes(
          d.phase,
        ),
      ) ??
      [...this.deliveries.values()].find(
        (d) => d.phase === "output" || (d.verified && d.phase === "counter"),
      );
    const w = this.worker;
    w.reach = undefined;
    if (transport) {
      const d = transport;
      d.age += dt;
      const approach = v(machineX(d.printer) + 0.16, 0, machineZ + 0.87);
      const reception = v(d.slot.x + 0.16, 0, -0.06);
      const recipient = this.residents.get(d.id);
      const person = recipient?.courier?.actor ?? recipient?.actor;
      const move = (p: T.Vector3) => w.move(p, []);
      if (d.phase === "output" || d.phase === "collect") {
        move(approach);
        if (w.arrived) {
          w.facing = Math.PI;
          w.reach = d.paper.position;
          if (d.phase === "output") {
            d.phase = "collect";
            d.age = 0;
          }
          if (d.age > 0.65) {
            d.phase = "carry";
            d.age = 0;
            d.from.copy(d.paper.position);
            w.pose = "carry";
          }
        }
      } else if (d.phase === "carry") {
        move(reception);
        if (w.arrived) {
          d.phase = "place";
          d.age = 0;
          w.facing = 0;
          d.from.copy(d.paper.position);
        }
      } else if (d.phase === "place") {
        w.reach = d.slot;
        d.paper.position.lerpVectors(d.from, d.slot, Math.min(1, d.age / 0.65));
        if (d.age > 0.65) {
          d.phase = "counter";
          d.age = 0;
          w.pose = "wait";
        }
      } else if (d.phase === "counter" && d.verified) {
        move(reception);
        if (w.arrived) {
          d.phase = "retrieve";
          d.age = 0;
          w.facing = 0;
        }
      } else if (d.phase === "retrieve") {
        w.reach = d.slot;
        if (d.age > 0.5) {
          d.phase = "meet";
          d.age = 0;
          d.from.copy(d.slot);
          w.pose = "carry";
        }
      } else if (d.phase === "meet") {
        move(v(1.71, 0, 0.42));
        if (
          w.arrived && person?.arrived &&
          person.root.position.distanceToSquared(handoffPosition) < 0.13 ** 2
        ) {
          d.phase = "give";
          d.age = 0;
          w.facing = 0;
          d.from.copy(d.paper.position);
        }
      } else if (d.phase === "give" && person) {
        const handoff = v(1.78, 1.13, 0.75);
        w.reach = handoff;
        person.pose = "carry";
        person.reach = handoff;
        if (d.age > 1.0) {
          d.phase = "received";
          d.age = 0;
          d.from.copy(d.paper.position);
          person.reach = undefined;
          w.pose = "wait";
          const r = this.residents.get(d.id);
          if (r) r.depart = true;
        }
      }
    } else {
      w.move(v(0.5, 0, -0.47), []);
      if (w.arrived) w.facing = 0;
      w.pose = "wait";
    }
    w.update(dt);
    if (
      transport &&
      (transport.phase === "carry" || transport.phase === "meet")
    )
      transport.paper.position.lerpVectors(
        transport.from,
        w.palm(new T.Vector3()),
        Math.min(1, transport.age / 0.4),
      );
    if (transport?.phase === "give")
      transport.paper.position.copy(w.palm(new T.Vector3()));
    for (const d of this.deliveries.values())
      if (d.phase === "received") {
        const r = this.residents.get(d.id);
        if (r) {
          d.age += dt;
          d.paper.position.lerpVectors(
            d.from,
            (r.courier?.actor ?? r.actor).palm(new T.Vector3()),
            Math.min(1, d.age / 0.32),
          );
        }
      }
  }
  get transporting() {
    return (
      [...this.residents.values()].some((r) => r.leaving) ||
      [...this.deliveries.values()].some(
        (d) => !["counter", "reported"].includes(d.phase) || d.verified,
      )
    );
  }
  private nextHandoff() {
    const parcels = [...this.deliveries.values()];
    const inHand = parcels.find((d) =>
      ["retrieve", "meet", "give"].includes(d.phase),
    );
    return (inHand ?? parcels.find((d) => d.verified && d.phase !== "received"))
      ?.id;
  }
  private direct(dt: number) {
    if (this.cameraMode === "Free camera") return;
    if (this.cinematic && !this.paused) {
      this.hold -= dt;
      if (this.hold <= 0 && this.shots.length) {
        this.shot = this.shots.shift()!;
        this.hold = 2.3;
      }
    }
    const view = this.cinematic ? this.shot.view : this.cameraMode;
    const targetOrder =
      this.selected?.kind === "order" ? this.selected.id : this.shot.order;
    const person =
      (targetOrder ? this.residents.get(targetOrder) : undefined) ??
      this.residents.values().next().value;
    const printer =
      this.selected?.kind === "printer"
        ? Number(this.selected.id)
        : (this.shot.printer ?? person?.order.printerId ?? 1);
    let focus = v(0, 0.56, 0.05),
      eye = v(8.0, 7.9, 12.6);
    if (view === "Entrance") {
      focus = v(-4.25, 1, 3.57);
      eye = v(-0.9, 2.9, 7.5);
    }
    if (view === "Owner counter") {
      focus = v(-3.12, 1.02, -0.75);
      eye = v(-0.22, 2.45, 2.12);
    }
    if (view === "Owner monitor") {
      focus = v(-2.99, 1.25, -0.32);
      eye = v(-2.28, 1.75, -1.98);
    }
    if (view === "Waiting area") {
      focus = v(0.48, 0.7, 1.45);
      eye = v(1.65, 4.5, 9.92);
    }
    if (view === "Pickup counter") {
      focus = v(0.45, 0.99, 0.56);
      eye = v(3.2, 2.85, 4.15);
    }
    if (view === "Top down") {
      focus = v(0, 0, 0.18);
      eye = v(0, 16, 0.19);
    }
    if (view.startsWith("Printer") || view === "Paper output") {
      const id = view === "Paper output" ? printer : Number(view.slice(-2));
      focus = tray(id);
      eye = focus
        .clone()
        .add(
          view === "Paper output" ? v(0.72, 0.39, 1.12) : v(1.67, 1.03, 2.37),
        );
    }
    if (
      view === "Follow worker" ||
      view === "Follow customer" ||
      view === "Customer phone"
    ) {
      const actor = view === "Follow worker"
        ? this.worker
        : view === "Follow customer"
          ? person?.courier?.actor ?? person?.actor
          : person?.actor;
      if (actor?.root.visible) {
        focus = actor.root.position
          .clone()
          .add(v(0, view === "Customer phone" ? 1.2 : 1, 0));
        eye = focus
          .clone()
          .add(
            view === "Customer phone"
              ? v(0.91, 0.37, -0.64)
              : v(2.05, 1.03, 2.55),
          );
      }
    }
    if (view === "Shop overview" || view === "Top down")
      eye
        .sub(focus)
        .multiplyScalar(Math.max(1, 1.36 / this.camera.aspect))
        .add(focus);
    const t = 1 - Math.exp(-Math.max(dt, 0.012) * 3.2);
    this.camera.position.lerp(eye, t);
    this.control.target.lerp(focus, t);
  }
  private tick = (now: number) => {
    if (this.closed) return;
    this.frame = requestAnimationFrame(this.tick);
    if (!this.visible) return;
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.36) : 0.016;
    this.last = now;
    const anim = this.paused ? 0 : dt * this.speed;
    this.age += anim;
    if (anim) this.advancePeople(anim);
    this.ring.visible = false;
    const sel = this.selected;
    if (sel?.kind === "order") {
      const r = this.residents.get(sel.id);
      if (r && (r.courier || r.actor.root.visible)) {
        this.ring.visible = true;
        this.ring.position.copy((r.courier?.actor ?? r.actor).root.position);
        this.ring.position.y = 0.032;
      }
    }
    if (sel?.kind === "printer") {
      this.ring.visible = true;
      this.ring.position.set(
        machineX(Number(sel.id)),
        tableY + 0.012,
        machineZ,
      );
    }
    if (sel && sel.kind !== "order" && sel.kind !== "printer") {
      this.ring.visible = true;
      const anchors = {
        qr: v(-4.6, 0.04, 2.57),
        pickup: pickup.clone().add(v(0, 0.01, 0)),
        monitor: v(-2.95, 0.9, -0.32),
        queue: v(0.47, 1.98, -3.56),
      };
      this.ring.position.copy(anchors[sel.kind]);
    }
    this.ring.rotation.x = sel?.kind === "queue" ? 0 : -Math.PI / 2;
    let printing = false;
    for (const p of this.fixtures.printers) {
      const model = this.floor.printers.find((m) => m.id === p.id);
      const job = this.floor.orders.find((o) => o.printerId === p.id);
      const runs = job?.status === "PRINTING" && model?.online === true;
      p.light.material = mat(
        !model?.online ? "#c65a50" : runs ? "#47d7a2" : "#88b8a2",
      );
      p.supply.visible = model?.paperLoaded === true;
      p.drawer.position.z = model?.paperLoaded ? 0.326 : 0.4;
      p.sheet.visible = runs;
      printing ||= runs;
      if (runs && job) {
        const cycle = (this.age * 0.83) % 1;
        const length = Math.max(0.001, Math.min(1, cycle / 0.77) * 0.297);
        p.sheet.scale.z = length;
        p.sheet.position.z =
          -0.105 + length / 2 + Math.max(0, cycle - 0.77) * 0.64;
        p.sheet.position.y = 0.469 - Math.max(0, cycle - 0.7) * 0.108;
        p.sheet.rotation.x = 0.035 * Math.sin(cycle * Math.PI);
      }
      p.stack.visible = !!job && job.progress > 0 && job.status === "PRINTING";
      if (p.stack.visible)
        p.stack.scale.y = 0.005 + Math.min(0.045, job!.progress * 0.00045);
    }
    if (this.sound && this.gain && this.sound.state === "running")
      this.gain.gain.setTargetAtTime(
        printing && !this.paused ? 0.023 : 0,
        this.sound.currentTime,
        0.14,
      );
    this.direct(dt);
    this.control.update();
    this.renderer.render(this.world, this.camera);
    const parcels = [...this.deliveries.values()]
      .map((d) => d.id + "=" + d.phase)
      .join(",");
    if (this.host.dataset.parcels !== parcels)
      this.host.dataset.parcels = parcels;
    const active = [...this.residents.values()];
    const customers = active.filter(r => r.actor.root.visible);
    this.host.dataset.customers = customers.map(r => r.order.id).join(",");
    this.host.dataset.residents = String(customers.length + active.filter(r => r.courier).length);
    const couriers = active.filter((r) => r.courier).map((r) => r.order.id).join(",");
    if (this.host.dataset.couriers !== couriers) this.host.dataset.couriers = couriers;
    const seated = active.filter((r) => r.actor.seated).map((r) => r.order.id).join(",");
    if (this.host.dataset.seated !== seated) this.host.dataset.seated = seated;
    if (this.host.dataset.rendered !== "true")
      this.host.dataset.rendered = "true";
  };
  dispose() {
    this.closed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("webglcontextlost", this.contextLost);
    this.control.dispose();
    this.clear();
    this.owner.dispose();
    this.worker.dispose();
    this.world.traverse((o) => {
      if (o instanceof T.Mesh && o.userData.localGeometry) o.geometry.dispose();
      if (o instanceof T.Mesh && o.userData.localTexture) {
        o.material.map.dispose();
        o.material.dispose();
        o.geometry.dispose();
      }
    });
    this.ring.geometry.dispose();
    (this.ring.material as T.Material).dispose();
    this.keyLight.shadow.dispose();
    this.tone?.stop();
    if (this.sound) void this.sound.close();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    el.remove();
  }
}
