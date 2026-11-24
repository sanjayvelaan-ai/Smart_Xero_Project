import assert from "node:assert/strict";
import { test } from "node:test";
import { type ShopEvent, defaultOptions } from "../src/domain";
import {
  cameras,
  liveFloor,
  orderedEvents,
  replayFloor,
  type Profile,
  type Snapshot,
} from "../src/twin/state";
import { waitingSlots } from "../src/twin/scene";

const profile: Profile = {
  id: "order",
  avatarId: "customer-order",
  createdAt: "2026-01-01T00:00:00Z",
  token: "PF-1001",
  mode: "EXPRESS",
  method: "DEMO",
  total: 2200,
  print: {
    ...defaultOptions,
    type: "PDF",
    range: "1-2",
    impressions: 2,
    sheets: 2,
  },
};
const snapshot: Snapshot = {
  shopId: "test",
  name: "test",
  demo: true,
  sequence: 9,
  catalog: [profile],
  orders: [],
  printers: [
    {
      id: 2,
      name: "Color",
      model: "Color",
      online: true,
      paperLoaded: true,
      a3: true,
      duplex: true,
      color: true,
      jobId: null,
    },
  ],
};
function event(
  sequence: number,
  type: ShopEvent["type"],
  payload: ShopEvent["payload"] = {},
): ShopEvent {
  return {
    sequence,
    id: "e" + sequence,
    orderId: "order",
    shopId: "test",
    at: profile.createdAt,
    actorId: "demo",
    correlationId: "1",
    version: 1,
    type,
    payload,
  };
}
test("overlapping event pages replay once in order and seeking never changes a snapshot", () => {
  const start = event(1, "ORDER_CREATED"),
    assign = event(4, "PRINTER_ASSIGNED", { printerId: 2 });
  const log = orderedEvents(
    [assign, start, event(2, "PAYMENT_CONFIRMED")],
    [
      assign,
      event(3, "ORDER_QUEUED"),
      event(5, "PRINT_STARTED", { printerId: 2 }),
      event(6, "PRINT_PROGRESS_UPDATED", { progress: 65 }),
      event(7, "PRINT_COMPLETED", { printerId: 2 }),
      event(8, "ORDER_READY_FOR_PICKUP"),
      event(9, "ORDER_COMPLETED"),
    ],
  );
  assert.deepEqual(
    log.map((e) => e.sequence),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  const original = JSON.stringify(snapshot);
  const print = replayFloor(snapshot, log, 6);
  assert.equal(print.orders[0].status, "PRINTING");
  assert.equal(print.printers[0].jobId, "order");
  assert.equal(print.orders[0].progress, 65);
  assert.equal(replayFloor(snapshot, log, 1).orders[0].payment, "PENDING");
  assert.equal(replayFloor(snapshot, log, 8).orders[0].payment, "PAID");
  assert.equal(replayFloor(snapshot, log, 8).printers[0].jobId, null);
  assert.deepEqual(replayFloor(snapshot, log, 9).orders, []);
  assert.equal(JSON.stringify(snapshot), original);
});
test("replay restores printer outages, loads and recovery independently of order events", () => {
  const events = [
    {
      ...event(1, "PRINTER_OFFLINE", { printerId: 2, paperLoaded: false }),
      orderId: null,
    },
    {
      ...event(2, "PRINTER_ONLINE", { printerId: 2, paperLoaded: true }),
      orderId: null,
    },
  ];
  assert.equal(replayFloor(snapshot, events, 1).printers[0].online, false);
  assert.equal(replayFloor(snapshot, events, 1).printers[0].paperLoaded, false);
  assert.equal(replayFloor(snapshot, events, 2).printers[0].paperLoaded, true);
});
test("active snapshots preserve distinct avatars and queue places at different shop loads", () => {
  for (const count of [1, 5, 10, 20, 50]) {
    const catalog = Array.from({ length: count }, (_, i) => ({
      ...profile,
      id: "id" + i,
      avatarId: "customer-" + i,
      mode: (i % 3 === 0 ? "EXPRESS" : "NORMAL") as Profile["mode"],
    }));
    const orders = catalog.map((p, i) => ({
      ...p,
      progress: 0,
      status: "QUEUED" as const,
      payment: "PAID" as const,
      privacy: "AVAILABLE" as const,
      printerId: null,
      queuePosition: i + 1,
      etaMinutes: i + 2,
    }));
    const floor = liveFloor({ ...snapshot, catalog, orders });
    const slots = waitingSlots(floor.orders);
    assert.equal(new Set(floor.orders.map((o) => o.avatarId)).size, count);
    assert.equal(
      new Set(Array.from(slots.values(), (v) => v.toArray().join(","))).size,
      count,
    );
    assert.deepEqual(
      [...waitingSlots([...floor.orders].reverse())],
      [...slots],
    );
  }
  assert.equal(new Set(cameras).size, 15);
});
