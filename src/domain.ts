import { z } from "zod";
import { defaultShopName } from "./lib/brand";

export const states = ["AWAITING_PAYMENT", "SCHEDULED", "QUEUED", "ASSIGNED", "PRINTING", "HELD", "FINISHING", "READY", "COMPLETED", "FAILED", "CANCELLED"] as const;
export type Status = typeof states[number];
export type Mode = "NORMAL" | "EXPRESS";
export type Method = "DEMO" | "COUNTER" | "UPI";
export type PaymentState = "PENDING" | "COUNTER_DUE" | "PAID" | "REFUND_PENDING" | "REFUNDED" | "VOID";
export type Privacy = "AVAILABLE" | "PURGE_REQUESTED" | "PURGE_FAILED" | "PURGED";
export type Role = "OWNER" | "WORKER";

const filePrintOptions = z.object({
  color: z.enum(["BW", "COLOR"]),
  size: z.enum(["A4", "A3"]),
  layout: z.enum(["PORTRAIT", "LANDSCAPE"]),
  duplex: z.boolean(),
  copies: z.number().int().min(1).max(50),
  pages: z.string().trim().max(200),
  collate: z.boolean(),
  paper: z.enum(["STANDARD", "PREMIUM"]),
  finishing: z.enum(["NONE", "STAPLE", "BIND"]),
  instructions: z.string().trim().max(300),
});
export const printOptions = filePrintOptions.extend({
  confidential: z.boolean(),
  batch: z.array(z.object({
    name: z.string().trim().min(1).max(160),
    pageCount: z.number().int().min(1).max(500),
    settings: filePrintOptions,
  })).min(2).max(50).optional(),
});
export type PrintOptions = z.infer<typeof printOptions>;
export type BatchFile = NonNullable<PrintOptions["batch"]>[number];
export type FilePrintOptions = BatchFile["settings"];
export const defaultOptions: PrintOptions = {
  color: "BW", size: "A4", layout: "PORTRAIT", duplex: false, copies: 1, pages: "",
  collate: true, paper: "STANDARD", finishing: "NONE", instructions: "", confidential: false,
};

const money = z.number().int().min(0).max(100000);
export const settingsSchema = z.object({
  name: z.string().trim().min(3).max(80),
  address: z.string().trim().min(3).max(140),
  open: z.boolean(),
  automatic: z.boolean(),
  counter: z.boolean(),
  express: z.boolean(),
  expressLimit: z.number().int().min(1).max(30),
  normalWait: z.number().int().min(1).max(120),
  expressBurst: z.number().int().min(1).max(10),
  bw: money, color: money, a3: money, premium: money, staple: money, bind: money, priority: money,
  duplexDiscount: z.number().int().min(0).max(100),
  discount: z.number().int().min(0).max(100),
  tax: z.number().int().min(0).max(100),
  stapleEnabled: z.boolean(),
  bindEnabled: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  name: defaultShopName, address: "Velachery, Chennai", open: true, automatic: false,
  counter: true, express: true, expressLimit: 5, normalWait: 12, expressBurst: 2,
  bw: 200, color: 800, a3: 400, premium: 150, staple: 300, bind: 2500, priority: 1000,
  duplexDiscount: 0, discount: 0, tax: 0, stapleEnabled: true, bindEnabled: true,
};

export const printerConfig = z.object({
  name: z.string().trim().min(2).max(48),
  model: z.string().trim().min(2).max(64),
  color: z.boolean(), duplex: z.boolean(), a3: z.boolean(), premium: z.boolean(), paperLoaded: z.boolean(),
  ppm: z.number().int().min(1).max(250),
});
export type PrinterConfig = z.infer<typeof printerConfig>;
export type Printer = PrinterConfig & {
  id: number; online: boolean; error: string | null; jobId: string | null;
  normalPassed: number;
};
export const defaultPrinters: PrinterConfig[] = [
  { name: "Printer 01", model: "B&W laser", color: false, duplex: false, a3: false, premium: false, paperLoaded: true, ppm: 22 },
  { name: "Printer 02", model: "Color laser", color: true, duplex: true, a3: true, premium: true, paperLoaded: true, ppm: 16 },
  { name: "Printer 03", model: "B&W multifunction", color: false, duplex: true, a3: false, premium: true, paperLoaded: true, ppm: 28 },
];

export type Price = { pages: number; impressions: number; sheets: number; base: number; finishing: number; express: number; discount: number; tax: number; total: number };
export type Order = {
  id: string; token: string; avatarId: string; createdAt: string; queuedAt: string | null;
  acceptedAt: string | null; startedAt: string | null; completedAt: string | null; readyAt: string | null;
  mode: Mode; status: Status; payment: PaymentState; method: Method; price: Price; options: PrintOptions;
  printerId: number | null; progress: number; reason: string | null; privacy: Privacy; originalPages: number;
  retries: number; etaMinutes: number | null; queuePosition: number | null; pickupPin?: string; fileName?: string;
  collectionAt?: string; printAt?: string;
  fileAvailable?: boolean; courier?: boolean; deliveryAddress?: string; deliveredAt?: string; paymentReference?: string;
};
export const eventTypes = [
  "CUSTOMER_SESSION_STARTED", "DOCUMENT_VALIDATED", "DOCUMENT_ACCESSED", "ORDER_CREATED", "SERVICE_MODE_SELECTED", "PRICE_CALCULATED",
  "PAYMENT_PENDING", "PAYMENT_CONFIRMED", "PAYMENT_FAILED", "ORDER_QUEUED", "EXPRESS_PRIORITY_ASSIGNED",
  "OWNER_NOTIFIED", "ORDER_ACCEPTED", "PRINTER_ASSIGNED", "PRINT_STARTED", "PRINT_PROGRESS_UPDATED",
  "PRINT_HELD", "PRINT_COMPLETED", "PRINT_FAILED", "WORKER_COLLECTED_PAPERS", "ORDER_READY_FOR_PICKUP",
  "PICKUP_VERIFIED", "ORDER_COMPLETED", "ORDER_CANCELLED", "REFUND_INITIATED", "REFUND_COMPLETED",
  "CUSTOMER_ARRIVED", "ORDER_SCHEDULED", "COLLECTION_REMINDER", "WAIT_ALERT", "COURIER_WAIT", "COURIER_ARRIVED", "AUTO_COLLECTED",
  "COURIER_COLLECTED", "DELIVERY_RECEIVED", "DOCUMENT_PURGE_REQUESTED", "DOCUMENT_PURGE_FAILED", "DOCUMENT_PURGED", "PRINTER_OFFLINE",
  "PRINTER_ONLINE", "PRINTER_UPDATED", "SHOP_SETTINGS_UPDATED",
] as const;
export type EventType = typeof eventTypes[number];
export type ShopEvent = {
  id: string; shopId: string; orderId: string | null; sequence: number; at: string;
  type: EventType; actorId: string; correlationId: string; version: 1;
  payload: { token?: string; mode?: Mode; printerId?: number; paperLoaded?: boolean; progress?: number; simulated?: boolean; total?: number };
};
export type Shop = {
  id: string; demo: boolean; settings: Settings; active: number; wait: number | null; expressAvailable: boolean;
  capabilities: Pick<PrinterConfig, "color" | "duplex" | "a3" | "premium" | "paperLoaded">[];
  upi: boolean;
};
export type StaffSnapshot = {
  shop: Shop; user: { name: string; role: Role }; sequence: number;
  orders: Order[]; printers: Printer[]; events: ShopEvent[];
  metrics: { today: number; normal: number; express: number; printing: number; ready: number; completed: number;
    cancelled: number; failed: number; online: number; offline: number; sales: number; expressSales: number;
    processing: number; wait: number; retries: number };
  chart: { hours: number[]; days: { date: string; total: number }[]; normal: number; express: number;
    printers: { id: number; minutes: number; jobs: number }[]; service: { normal: number; express: number } };
};

export class DomainError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export const isClosed = (status: Status) => status === "COMPLETED" || status === "CANCELLED";
export function compatible(p: Pick<PrinterConfig, "color" | "duplex" | "a3" | "premium">, o: FilePrintOptions & Pick<PrintOptions, "batch">) {
  const supports = (settings: FilePrintOptions) => (settings.color === "BW" || p.color) &&
    (settings.size === "A4" || p.a3) && (!settings.duplex || p.duplex) && (settings.paper === "STANDARD" || p.premium);
  return o.batch ? o.batch.every(file => supports(file.settings)) : supports(o);
}

export function pageNumbers(value: string, total: number): number[] {
  if (!value.trim()) return Array.from({ length: total }, (_, index) => index + 1);
  const seen = new Set<number>();
  for (const section of value.split(",")) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(section);
    if (!match) throw new DomainError("Use page numbers or ranges, for example 1–3, 5 (type a hyphen).");
    const from = Number(match[1]);
    const to = Number(match[2] ?? match[1]);
    if (from < 1 || to < from || to > total) throw new DomainError(`Choose pages between 1 and ${total}.`);
    for (let page = from; page <= to; page++) seen.add(page);
  }
  return [...seen].sort((a, b) => a - b);
}

export function selectedPages(value: string, total: number): number {
  return value.trim() ? pageNumbers(value, total).length : total;
}

function fileCharges(options: FilePrintOptions, totalPages: number, settings: Settings) {
  if (options.finishing === "STAPLE" && !settings.stapleEnabled || options.finishing === "BIND" && !settings.bindEnabled)
    throw new DomainError("That finishing service is currently unavailable.");
  const pages = selectedPages(options.pages, totalPages);
  const impressions = pages * options.copies;
  const sheets = (options.duplex ? Math.ceil(pages / 2) : pages) * options.copies;
  const pageRate = options.color === "COLOR" ? settings.color : settings.bw;
  const printCharge = Math.round(pageRate * impressions * (options.duplex ? 100 - settings.duplexDiscount : 100) / 100);
  const base = printCharge + sheets * ((options.size === "A3" ? settings.a3 : 0) + (options.paper === "PREMIUM" ? settings.premium : 0));
  const finishing = options.copies * (options.finishing === "STAPLE" ? settings.staple : options.finishing === "BIND" ? settings.bind : 0);
  return { pages, impressions, sheets, base, finishing };
}

export function priceOrder(options: PrintOptions, totalPages: number, mode: Mode, settings: Settings): Price {
  if (options.batch && options.batch.reduce((sum, file) => sum + file.pageCount, 0) !== totalPages)
    throw new DomainError("The file list does not match the uploaded document. Prepare your batch again.");
  const files = options.batch ?? [{ pageCount: totalPages, settings: options }];
  let pages = 0, impressions = 0, sheets = 0, base = 0, finishing = 0;
  for (const [index, file] of files.entries()) {
    try {
      const charge = fileCharges(file.settings, file.pageCount, settings);
      pages += charge.pages;
      impressions += charge.impressions;
      sheets += charge.sheets;
      base += charge.base;
      finishing += charge.finishing;
    } catch (error) {
      if (options.batch && error instanceof DomainError) throw new DomainError(`File ${index + 1} (${options.batch[index].name}): ${error.message}`);
      throw error;
    }
  }
  if (impressions > 2500) throw new DomainError("The shop accepts up to 2,500 printed pages per order.");
  const express = mode === "EXPRESS" ? settings.priority : 0;
  const discount = Math.round((base + finishing) * settings.discount / 100);
  const subtotal = base + finishing + express - discount;
  const tax = Math.round(subtotal * settings.tax / 100);
  return { pages, impressions, sheets, base, finishing, express, discount, tax, total: subtotal + tax };
}

export function duration(order: Pick<Order, "price" | "options">, printer: PrinterConfig): number {
  const colorPages = order.options.batch
    ? order.options.batch.reduce((sum, file) => sum + (file.settings.color === "COLOR" ? selectedPages(file.settings.pages, file.pageCount) * file.settings.copies : 0), 0)
    : order.options.color === "COLOR" ? order.price.impressions : 0;
  return 30 + Math.ceil((order.price.impressions + colorPages * 0.25) * 60 / printer.ppm);
}

export function pickNext<T extends Pick<Order, "mode" | "queuedAt" | "createdAt" | "options">>(
  orders: T[], printer: Printer, settings: Settings, now: number,
): T | undefined {
  const byTime = (a: T, b: T) => (a.queuedAt ?? a.createdAt).localeCompare(b.queuedAt ?? b.createdAt);
  const list = orders.filter(o => compatible(printer, o.options)).sort(byTime);
  const normal = list.find(o => o.mode === "NORMAL");
  const express = list.find(o => o.mode === "EXPRESS");
  if (!normal) return express;
  if (!express || printer.normalPassed >= settings.expressBurst ||
      now - Date.parse(normal.queuedAt ?? normal.createdAt) >= settings.normalWait * 60000) return normal;
  return express;
}

export function expressEligible(
  orders: Order[], printers: Printer[], settings: Settings, options?: PrintOptions,
  candidate?: Pick<Order, "price" | "options">,
) {
  if (!settings.open || !settings.express) return false;
  const capable = printers.filter(p => p.online && p.paperLoaded && (!options || compatible(p, options)));
  if (!capable.length) return false;
  const pending = orders.filter(o => (!isClosed(o.status) && !["SCHEDULED", "FAILED", "READY", "FINISHING"].includes(o.status)));
  if (pending.filter(o => o.mode === "EXPRESS").length >= settings.expressLimit) return false;
  return capable.some(p => {
    const work = pending.filter(o => o.printerId === p.id ||
      (o.mode === "EXPRESS" && o.printerId === null && compatible(p, o.options)));
    const seconds = work.reduce((sum, o) => sum + duration(o, p) * (1 - o.progress / 100), 0);
    const candidateTime = candidate ? duration(candidate, p) : 60;
    return seconds + candidateTime <= settings.normalWait * 60;
  });
}

export function queueProjection(orders: Order[], printers: Printer[], settings: Settings, now = Date.now()) {
  const readyPrinters = printers.filter(p => p.online && p.paperLoaded && !orders.some(o => o.id === p.jobId && o.status === "HELD"));
  const waiting = orders.filter(o => o.status === "QUEUED");
  const jobs = new Map<string, { etaMinutes: number; queuePosition: number | null }>();
  const pipeline = readyPrinters.map(p => {
    const job = orders.find(o => o.id === p.jobId);
    const elapsed = job?.startedAt ? Math.max(0, (now - Date.parse(job.startedAt)) / 1000) : 0;
    const seconds = job ? Math.max(15, duration(job, p) - Math.max(elapsed, duration(job, p) * job.progress / 100)) : 0;
    if (job) jobs.set(job.id, { etaMinutes: Math.max(1, Math.ceil(seconds / 60)), queuePosition: null });
    return { printer: { ...p }, seconds };
  });
  const position: Record<Mode, number> = { NORMAL: 0, EXPRESS: 0 };
  while (waiting.length) {
    const choices = pipeline.flatMap(slot => {
      const next = pickNext(waiting, slot.printer, settings, now + slot.seconds * 1000);
      return next ? [{ slot, next, end: slot.seconds + duration(next, slot.printer) }] : [];
    });
    choices.sort((a, b) => a.slot.seconds - b.slot.seconds || a.end - b.end);
    const choice = choices[0];
    if (!choice) break;
    const { next, slot, end } = choice;
    slot.seconds = end;
    slot.printer.normalPassed = next.mode === "NORMAL" ? 0 : slot.printer.normalPassed + 1;
    position[next.mode]++;
    const finishing = next.options.batch
      ? next.options.batch.some(file => file.settings.finishing !== "NONE")
      : next.options.finishing !== "NONE";
    jobs.set(next.id, { etaMinutes: Math.ceil((end + (finishing ? 120 : 0)) / 60), queuePosition: position[next.mode] });
    waiting.splice(waiting.indexOf(next), 1);
  }
  return jobs;
}

export const statusLabel: Record<Status, string> = {
  SCHEDULED: "Scheduled", AWAITING_PAYMENT: "Awaiting payment", QUEUED: "Queued", ASSIGNED: "Assigned", PRINTING: "Printing",
  HELD: "On hold", FINISHING: "Finishing", READY: "Ready for pickup", COMPLETED: "Completed",
  FAILED: "Failed", CANCELLED: "Cancelled",
};
export const paymentLabel: Record<PaymentState, string> = {
  PENDING: "Pending verification", COUNTER_DUE: "Due at counter", PAID: "Paid", REFUND_PENDING: "Refund pending",
  REFUNDED: "Refunded", VOID: "Voided",
};
export const eventLabel: Partial<Record<EventType, string>> = {
  CUSTOMER_ARRIVED: "Customer arrived for booked collection", COURIER_WAIT: "Rider is waiting for the collection code", ORDER_SCHEDULED: "Paid booking confirmed", COLLECTION_REMINDER: "Collection due within 10 minutes", WAIT_ALERT: "Customer wait exceeds the shop target", COURIER_ARRIVED: "Blinkit rider arrived for collection", AUTO_COLLECTED: "Customer collected prints automatically",
  COURIER_COLLECTED: "Courier collected the prints", DELIVERY_RECEIVED: "Customer confirmed home delivery",
  ORDER_CREATED: "Order received", PAYMENT_PENDING: "Awaiting payment", PAYMENT_CONFIRMED: "Payment verified",
  PAYMENT_FAILED: "Payment failed", ORDER_QUEUED: "Added to the queue", EXPRESS_PRIORITY_ASSIGNED: "Express priority confirmed",
  ORDER_ACCEPTED: "Accepted by the shop", PRINTER_ASSIGNED: "Printer assigned", PRINT_STARTED: "Printing started", PRINT_HELD: "Printing paused",
  PRINT_COMPLETED: "Printing completed", PRINT_FAILED: "Printing issue reported", ORDER_READY_FOR_PICKUP: "Ready for pickup",
  PICKUP_VERIFIED: "Pickup code verified", ORDER_COMPLETED: "Collection completed", ORDER_CANCELLED: "Order cancelled",
  REFUND_INITIATED: "Refund requested", REFUND_COMPLETED: "Refund completed", DOCUMENT_PURGED: "Temporary document removed",
  DOCUMENT_PURGE_FAILED: "Temporary document cleanup will retry", PRINTER_OFFLINE: "Printer went offline", PRINTER_ONLINE: "Printer is online",
};
export const rupees = (paise: number) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", minimumFractionDigits: paise % 100 === 0 ? 0 : 2, maximumFractionDigits: 2,
}).format(paise / 100);
