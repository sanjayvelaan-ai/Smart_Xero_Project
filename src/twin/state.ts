import type { workflowProjection } from "../server/operations";
import type { ShopEvent, Status, PaymentState, Privacy } from "../domain";

export type Snapshot = Awaited<ReturnType<typeof workflowProjection>>;
export type Machine = Snapshot["printers"][number];
export type Profile = Snapshot["catalog"][number];
export type Customer = Profile & {
  collectionDue?: boolean;
  status: Status;
  payment: PaymentState;
  privacy: Privacy;
  printerId: number | null;
  progress: number;
  queuePosition: number | null;
  etaMinutes: number | null;
};
export type Floor = { orders: Customer[]; printers: Machine[] };
export type Selection =
  | { kind: "order" | "printer"; id: string }
  | { kind: "queue" | "pickup" | "monitor" | "qr" };
export const cameras = [
  "Shop overview",
  "Entrance",
  "Follow customer",
  "Customer phone",
  "Waiting area",
  "Owner counter",
  "Owner monitor",
  "Printer 01",
  "Printer 02",
  "Printer 03",
  "Paper output",
  "Follow worker",
  "Pickup counter",
  "Top down",
  "Free camera",
] as const;
export type Camera = (typeof cameras)[number];

export function liveFloor(snapshot: Snapshot): Floor {
  const profiles = new Map(snapshot.catalog.map((p) => [p.id, p]));
  return {
    printers: snapshot.printers,
    orders: snapshot.orders.map(o => ({ ...o, ...profiles.get(o.id)! })),
  };
}
export function orderedEvents(prior: ShopEvent[], next: ShopEvent[]) {
  const unique = new Map(prior.map((e) => [e.sequence, e]));
  next.forEach((e) => unique.set(e.sequence, e));
  return Array.from(unique.values()).sort((a, b) => a.sequence - b.sequence);
}
const stage: Partial<Record<ShopEvent["type"], Status>> = {
  ORDER_SCHEDULED: "SCHEDULED",
  ORDER_QUEUED: "QUEUED",
  PRINTER_ASSIGNED: "ASSIGNED",
  PRINT_STARTED: "PRINTING",
  PRINT_HELD: "HELD",
  PRINT_FAILED: "FAILED",
  PRINT_COMPLETED: "FINISHING",
  ORDER_READY_FOR_PICKUP: "READY",
  ORDER_COMPLETED: "COMPLETED",
  ORDER_CANCELLED: "CANCELLED",
};
export function replayFloor(
  snapshot: Snapshot,
  events: ShopEvent[],
  sequence: number,
  orderId?: string,
): Floor {
  const profiles = new Map(snapshot.catalog.map((p) => [p.id, p]));
  const orders = new Map<string, Customer>();
  const printers = snapshot.printers.map((p) => ({
    ...p,
    online: true,
    paperLoaded: true,
    jobId: null as string | null,
  }));
  for (const e of events) {
    if (e.sequence > sequence) break;
    const machine = printers.find((p) => p.id === e.payload.printerId);
    if (
      machine &&
      (e.type === "PRINTER_OFFLINE" || e.type === "PRINTER_ONLINE")
    )
      machine.online = e.type === "PRINTER_ONLINE";
    if (machine && e.payload.paperLoaded !== undefined)
      machine.paperLoaded = e.payload.paperLoaded;
    if (!e.orderId || (orderId && e.orderId !== orderId)) continue;
    const profile = profiles.get(e.orderId);
    if (!profile) continue;
    if (e.type === "ORDER_CREATED")
      orders.set(profile.id, {
        ...profile,
        status: "AWAITING_PAYMENT",
        payment: profile.method === "COUNTER" ? "COUNTER_DUE" : "PENDING",
        progress: 0,
        privacy: "AVAILABLE",
        printerId: null,
        etaMinutes: null,
        queuePosition: null,
      });
    const order = orders.get(profile.id);
    if (!order) continue;
    if (e.type === "CUSTOMER_ARRIVED" || e.type === "COURIER_ARRIVED") order.collectionDue = true;
    const state = stage[e.type];
    if (state) order.status = state;
    if (
      [
        "ORDER_QUEUED",
        "PRINTER_ASSIGNED",
        "PRINT_FAILED",
        "PRINT_COMPLETED",
        "ORDER_CANCELLED",
      ].includes(e.type)
    ) {
      for (const p of printers) if (p.jobId === order.id) p.jobId = null;
      order.printerId = null;
    }
    if (e.type === "PRINTER_ASSIGNED" && machine) {
      machine.jobId = order.id;
      order.printerId = machine.id;
      order.progress = 0;
    }
    if (e.type === "PRINT_PROGRESS_UPDATED")
      order.progress = e.payload.progress ?? 0;
    if (e.type === "PRINT_COMPLETED") order.progress = 100;
    if (e.type === "ORDER_QUEUED") order.progress = 0;
    if (e.type === "DOCUMENT_PURGE_REQUESTED")
      order.privacy = "PURGE_REQUESTED";
    if (e.type === "DOCUMENT_PURGE_FAILED") order.privacy = "PURGE_FAILED";
    if (e.type === "DOCUMENT_PURGED") order.privacy = "PURGED";
    if (e.type === "PAYMENT_CONFIRMED") order.payment = "PAID";
    if (
      e.type === "ORDER_CANCELLED" &&
      ["PENDING", "COUNTER_DUE"].includes(order.payment)
    )
      order.payment = "VOID";
    if (e.type === "REFUND_INITIATED") order.payment = "REFUND_PENDING";
    if (e.type === "REFUND_COMPLETED") order.payment = "REFUNDED";
    if (e.type === "ORDER_COMPLETED" || e.type === "ORDER_CANCELLED")
      orders.delete(order.id);
  }
  return { printers, orders: Array.from(orders.values()) };
}
export function eventTitle(e: ShopEvent) {
  const words = e.type.toLowerCase().replaceAll("_", " ");
  return words[0].toUpperCase() + words.slice(1);
}
export function filmDuration(e: ShopEvent) {
  switch (e.type) {
    case "ORDER_CREATED":
      return 3.8;
    case "PRINT_COMPLETED":
      return 5;
    case "ORDER_COMPLETED":
      return 4;
    case "PRINT_STARTED":
      return 2.5;
    case "OWNER_NOTIFIED":
    case "ORDER_READY_FOR_PICKUP":
      return 1.8;
    default:
      return 0.9;
  }
}
