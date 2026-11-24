import { strict as assert } from "node:assert";
import { test } from "node:test";
import { compatible, defaultOptions, defaultPrinters, defaultSettings, expressEligible, pickNext, priceOrder,
  queueProjection, selectedPages, type Order, type Printer } from "../src/domain";

const now = Date.parse("2026-11-23T09:00:00Z");
const iso = (seconds = 0) => new Date(now + seconds * 1000).toISOString();
const printers: Printer[] = defaultPrinters.map((config, index) => ({ ...config, id: index + 1, normalPassed: 0, online: true, error: null, jobId: null }));
function order(id: string, mode: Order["mode"], offset = 0, options = defaultOptions): Order {
  return {
    id, token: id, avatarId: id, mode, options, status: "QUEUED", method: "COUNTER", payment: "COUNTER_DUE",
    createdAt: iso(offset), queuedAt: iso(offset), acceptedAt: null, startedAt: null, readyAt: null, completedAt: null, privacy: "AVAILABLE",
    price: priceOrder(options, 4, mode, defaultSettings), originalPages: 4, retries: 0,
    printerId: null, progress: 0, reason: null, etaMinutes: null, queuePosition: null,
  };
}

test("page selection deduplicates ranges and rejects invalid and out-of-range pages", () => {
  assert.equal(selectedPages("", 20), 20);
  assert.equal(selectedPages("1-3, 3, 5", 8), 4);
  for (const text of ["0", "8-2", "25", "1, ", "2+3", "1--3"]) assert.throws(() => selectedPages(text, 10));
});

test("pricing uses impressions, physical sheets, copies, finish, taxes and discounts", () => {
  const price = priceOrder({ ...defaultOptions, copies: 2, color: "COLOR", size: "A3", duplex: true, paper: "PREMIUM", finishing: "STAPLE" },
    3, "EXPRESS", { ...defaultSettings, duplexDiscount: 10, tax: 5, discount: 10 });
  assert.deepEqual(price, { pages: 3, impressions: 6, sheets: 4, base: 6520, finishing: 600, express: 1000, discount: 712, tax: 370, total: 7778 });
  assert.throws(() => priceOrder({ ...defaultOptions, finishing: "BIND" }, 3, "NORMAL", { ...defaultSettings, bindEnabled: false }), /unavailable/);
});

test("compatible printers must support every requested option", () => {
  const opts = { ...defaultOptions, color: "COLOR" as const, size: "A3" as const, duplex: true };
  assert.deepEqual(printers.filter(p => compatible(p, opts)).map(p => p.id), [2]);
});

test("a mixed batch applies per-file settings, separates duplex sheets and charges Express once", () => {
  const batch: NonNullable<Order["options"]["batch"]> = [
    { name: "Notes.pdf", pageCount: 4, settings: { ...defaultOptions, duplex: true, pages: "2-4", copies: 2 } },
    { name: "Poster.pdf", pageCount: 1, settings: { ...defaultOptions, color: "COLOR", size: "A3", finishing: "STAPLE" } },
  ];
  const options = { ...defaultOptions, batch };
  assert.deepEqual(priceOrder(options, 5, "EXPRESS", defaultSettings), {
    pages: 4, impressions: 7, sheets: 5, base: 2400, finishing: 300, express: 1000, discount: 0, tax: 0, total: 3700,
  });
  assert.deepEqual(printers.filter(printer => compatible(printer, options)).map(printer => printer.id), [2]);
  assert.throws(() => priceOrder(options, 6, "NORMAL", defaultSettings), /does not match/);
  assert.throws(() => priceOrder({ ...options, batch: [batch[0], { ...batch[1], settings: { ...batch[1].settings, pages: "2" } }] },
    5, "NORMAL", defaultSettings), /File 2 \(Poster.pdf\)/);
});

test("Express goes first only until the burst or Normal aging limit is reached", () => {
  const list = [order("late", "NORMAL", -11), order("early", "NORMAL", -35), order("urgent", "EXPRESS", -4)];
  assert.equal(pickNext(list, printers[0], defaultSettings, now)?.id, "urgent");
  assert.equal(pickNext(list, { ...printers[0], normalPassed: 2 }, defaultSettings, now)?.id, "early");
  assert.equal(pickNext(list, printers[0], defaultSettings, now + 12 * 60000)?.id, "early");
});

test("Express refuses over-capacity, long or offline-only requests", () => {
  const urgent = order("urgent", "EXPRESS");
  assert.equal(expressEligible([], printers, defaultSettings), true);
  assert.equal(expressEligible([urgent], printers, { ...defaultSettings, expressLimit: 1 }), false);
  assert.equal(expressEligible([], printers.map(p => ({ ...p, online: false })), defaultSettings), false);
  assert.equal(expressEligible([], printers, defaultSettings, defaultOptions, { ...urgent, price: { ...urgent.price, impressions: 2000 } }), false);
});

test("queue estimates preserve FIFO and withhold pickup estimates when no device can print", () => {
  const list = [order("second", "NORMAL", -3), order("first", "NORMAL", -6)];
  const projection = queueProjection(list, [printers[0]], defaultSettings, now);
  assert.equal(projection.get("first")?.queuePosition, 1);
  assert.equal(projection.get("second")?.queuePosition, 2);
  assert.equal(queueProjection(list, [{ ...printers[0], paperLoaded: false }], defaultSettings, now).size, 0);
});
