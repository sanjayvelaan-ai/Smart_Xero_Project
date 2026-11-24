import { randomUUID } from "node:crypto";
import { isClosed, queueProjection, type Order, type Printer, type PrinterConfig, type ShopEvent, type EventType, type Shop, type StaffSnapshot } from "../domain";
import { type DocumentRow } from "./documents";
import { type Sql } from "./db";
import { type Identity, type ShopRow } from "./identity";
import { shopDisplayName } from "../lib/brand";

export type OrderRow = {
  id: string; customer_id: string; document_id: string; token: string;
  mode: Order["mode"]; status: Order["status"]; method: Order["method"]; payment: Order["payment"];
  price: Order["price"]; options: Order["options"]; printer_id: number | null; progress: number; reason: string | null;
  collection_at: Date | null; print_at: Date | null; printed_at: Date | null;
  delivery_address: string|null; delivered_at: Date|null; payment_reference:string;
  pickup_pin: string; pickup_failures: number; pickup_retry_at: Date | null; accepted_at: Date | null;
  privacy: Order["privacy"]; file_name: string; media_type: string; pages: number; expires_at: Date; retries: number;
  created_at: Date; queued_at: Date | null; started_at: Date | null; completed_at: Date | null; ready_at: Date | null;
  provider_order: string | null; provider_payment: string | null; paid_at: Date | null; job_id: string | null;
};

export async function orderRows(tx: Sql, shop: string, filter = "", args: unknown[] = []) {
  return tx.rows<OrderRow>(`SELECT o.*, d.privacy, d.file_name, d.media_type, d.pages, d.expires_at, p.method, p.state AS payment,
    p.provider_order, p.provider_payment, p.paid_at, j.printer_id, j.id AS job_id
    FROM orders o JOIN documents d ON d.id=o.document_id JOIN payments p ON p.order_id=o.id
    LEFT JOIN print_jobs j ON j.order_id=o.id AND j.finished_at IS NULL
    WHERE o.shop_id=$1 ${filter} ORDER BY o.created_at DESC, o.token DESC`, [shop, ...args]);
}

export async function printerRows(tx: Sql, shop: string) {
  const rows = await tx.rows<{ id: number; online: boolean; error: string | null; config: PrinterConfig; normal_passed: number; order_id: string | null }>(
    `SELECT p.*,j.order_id FROM printers p LEFT JOIN print_jobs j
    ON p.shop_id=j.shop_id AND p.id=j.printer_id AND j.finished_at IS NULL WHERE p.shop_id=$1 ORDER BY p.id`, [shop]);
  return rows.map(p => ({ ...p.config, id: p.id, online: p.online, error: p.error, normalPassed: p.normal_passed, jobId: p.order_id }));
}

export function projectOrder(row: OrderRow, member?: "OWNER" | "WORKER" | "CUSTOMER"): Order {
  const order: Order = {
    id: row.id, token: row.token, avatarId: "customer-" + row.id, mode: row.mode, status: row.status,
    createdAt: row.created_at.toISOString(), queuedAt: row.queued_at?.toISOString() ?? null,
    acceptedAt: row.accepted_at?.toISOString() ?? null, startedAt: row.started_at?.toISOString() ?? null, completedAt: row.completed_at?.toISOString() ?? null,
    printAt: row.print_at?.toISOString(), collectionAt: row.collection_at?.toISOString(),
    courier: !!row.delivery_address || !!row.delivered_at, deliveredAt:row.delivered_at?.toISOString(),
    readyAt: row.ready_at?.toISOString() ?? null, price: row.price, options: row.options, reason: row.reason,
    method: row.method, payment: row.payment, printerId: row.printer_id, progress: row.progress, retries: row.retries,
    privacy: row.privacy, originalPages: row.pages, etaMinutes: row.status === "FINISHING" ? 2 : null, queuePosition: null,
  };
  if (row.options.batch && member !== "CUSTOMER" && (row.options.confidential || !member)) {
    order.options = { ...row.options, batch: row.options.batch.map((file, index) => ({
      ...file, name: "Document " + (index + 1),
      settings: { ...file.settings, instructions: member ? file.settings.instructions : "" },
    })) };
  }
  if (member === "CUSTOMER" && !isClosed(row.status)) order.pickupPin = row.pickup_pin;
  if(member && row.delivery_address) order.deliveryAddress=row.delivery_address;
  if(member==="CUSTOMER" && row.method==="DEMO" && row.status==="AWAITING_PAYMENT")order.paymentReference=row.payment_reference;
  if (member === "CUSTOMER" || (member && !row.options.confidential)) {
    order.fileName = row.file_name;
  }
  if (member === "OWNER" || member === "WORKER") {
    order.fileAvailable = (member === "OWNER" || !row.options.confidential) && row.privacy === "AVAILABLE" &&
      row.expires_at.getTime() > Date.now() && ["ASSIGNED", "PRINTING", "HELD"].includes(row.status);
  }
  return order;
}

export function withEstimates(orders: Order[], printers: Printer[], shop: ShopRow) {
  const estimates = queueProjection(orders, printers, shop.settings);
  return orders.map(order => ({ ...order, ...estimates.get(order.id) }));
}

export async function documentRow(tx: Sql, shopId: string, id: string) {
  const [doc] = await tx.rows<DocumentRow>("SELECT * FROM documents WHERE shop_id=$1 AND id=$2", [shopId, id]);
  return doc;
}

export type Actor = { shopId: string; actorId: string; correlationId: string };
export const actor = (identity: Identity, correlationId: string = randomUUID()): Actor =>
  ({ shopId: identity.shopId, actorId: identity.staff?.id ?? identity.id, correlationId });
export const system = (shopId: string): Actor => ({ shopId, actorId: "system", correlationId: randomUUID() });

export async function emit(tx: Sql, who: Actor, type: EventType, orderId: string | null,
  payload: ShopEvent["payload"] = {}) {
  const [row] = await tx.rows<{ sequence: number }>("UPDATE shops SET sequence=sequence+1 WHERE id=$1 RETURNING sequence", [who.shopId]);
  await tx.rows(`INSERT INTO order_events(id,shop_id,sequence,order_id,type,actor_id,correlation_id,payload)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
  [randomUUID(), who.shopId, row.sequence, orderId, type, who.actorId, who.correlationId, payload]);
}

export async function eventRows(tx: Sql, shop: string, after: number | null, orderId?: string) {
  const rows = await tx.rows<Omit<ShopEvent, "at"> & { at: Date }>(`SELECT id,shop_id AS "shopId",order_id AS "orderId",sequence,at,
    type,actor_id AS "actorId",correlation_id AS "correlationId",version,payload FROM order_events WHERE shop_id=$1
    AND ($2::int IS NULL OR sequence>$2) AND ($3::uuid IS NULL OR order_id=$3)
    ORDER BY sequence ${after === null ? "DESC" : "ASC"} LIMIT ${after === null ? 40 : 200}`, [shop, after, orderId ?? null]);
  return rows.map(row => ({ ...row, at: row.at.toISOString() }));
}

export function metrics(rows: OrderRow[], printers: Printer[], jobs: { printer_id: number; started_at: Date; finished_at: Date | null }[]) {
  const day = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const hour = (date: Date) => Number(date.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }));
  const todayKey = day(new Date());
  const today = rows.filter(row => day(row.created_at) === todayKey);
  const active = rows.filter(row => !isClosed(row.status));
  const queue = active.filter(row => row.status === "QUEUED");
  const paid = rows.filter(row => ["PAID", "REFUND_PENDING"].includes(row.payment) && row.paid_at);
  const paidToday = paid.filter(row => day(row.paid_at!) === todayKey);
  const completed = rows.filter(row => row.completed_at && day(row.completed_at) === todayKey);
  const avg = (values: number[]) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length / 6000) / 10 : 0;
  const bins = Array<number>(24).fill(0);
  today.forEach(row => { bins[hour(row.created_at)]++; });
  const sum = (orders: OrderRow[], field: "total" | "express") => orders.reduce((value, row) => value + row.price[field], 0);
  const chart: StaffSnapshot["chart"] = {
    hours: bins,
    days: Array.from({ length: 7 }, (_, i) => {
      const date = day(new Date(Date.now() - (6 - i) * 86400000));
      return { date, total: sum(paid.filter(row => day(row.paid_at!) === date), "total") };
    }),
    normal: today.filter(row => row.mode === "NORMAL").length,
    express: today.filter(row => row.mode === "EXPRESS").length,
    printers: printers.map(p => {
      const periods = jobs.filter(job => job.printer_id === p.id);
      return { id: p.id, jobs: periods.length, minutes: Math.round(periods.reduce((total, j) =>
        total + Math.max(0, (j.finished_at?.getTime() ?? Date.now()) - j.started_at.getTime()), 0) / 6000) / 10 };
    }),
    service: { normal: sum(paidToday.filter(row => row.mode === "NORMAL"), "total"), express: sum(paidToday.filter(row => row.mode === "EXPRESS"), "total") },
  };
  const result: StaffSnapshot["metrics"] = {
    today: today.length, normal: queue.filter(row => row.mode === "NORMAL").length, express: queue.filter(row => row.mode === "EXPRESS").length,
    printing: active.filter(row => row.status === "PRINTING").length, ready: active.filter(row => row.status === "READY").length,
    completed: completed.length, cancelled: today.filter(row => row.status === "CANCELLED").length,
    failed: today.filter(row => row.status === "FAILED").length, online: printers.filter(p => p.online).length,
    offline: printers.filter(p => !p.online).length, sales: sum(paidToday, "total"), expressSales: sum(paidToday, "express"),
    processing: avg(completed.filter(row => row.started_at && row.ready_at).map(row => row.ready_at!.getTime() - row.started_at!.getTime())),
    wait: avg(rows.filter(row => row.started_at && row.queued_at && day(row.started_at) === todayKey)
      .map(row => Math.max(0, row.started_at!.getTime() - row.queued_at!.getTime()))),
    retries: today.reduce((total, row) => total + row.retries, 0),
  };
  return { metrics: result, chart };
}

export function publicShop(row: ShopRow, orders: Order[], printers: Printer[], expressAvailable: boolean, wait: number | null, upi: boolean): Shop {
  return {
    id: row.id, demo: row.demo, settings: { ...row.settings, name: shopDisplayName(row.settings.name) },
    active: orders.filter(order => !isClosed(order.status) && !["FAILED", "AWAITING_PAYMENT"].includes(order.status)).length,
    wait, expressAvailable, capabilities: printers.filter(p => p.online && p.paperLoaded)
      .map(p => ({ color: p.color, duplex: p.duplex, a3: p.a3, premium: p.premium, paperLoaded: p.paperLoaded })), upi,
  };
}
