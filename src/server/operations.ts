import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { shopDisplayName } from "../lib/brand";
import { compatible, DomainError, duration, expressEligible, isClosed, pickNext, priceOrder, printOptions,
  printerConfig, queueProjection, settingsSchema, type Mode, type PrintOptions, type Printer, type Status } from "../domain";
import { transaction, type Sql } from "./db";
import { inspectDocument, removeDocument, saveDocument, type DocumentRow } from "./documents";
import { newSession, shopRow, type Identity, type ShopRow } from "./identity";
import { actor, documentRow, emit, eventRows, metrics, orderRows, printerRows, projectOrder, publicShop,
  system, withEstimates, type Actor, type OrderRow } from "./records";

export const quoteInput = z.object({
  documentId: z.uuid(), options: printOptions, mode: z.enum(["NORMAL", "EXPRESS"]),
});
export const createInput = quoteInput.extend({
  key: z.uuid(),
  method: z.enum(["DEMO", "COUNTER", "UPI"]),
  collectionAt: z.iso.datetime().optional(),
  deliveryAddress: z.string().trim().min(10).max(400).optional(),
  confirmedTotal: z.number().int().nonnegative(),
});
const reason = z.string().trim().min(3).max(140);
export const staffCommand = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["accept", "start", "hold", "resume", "printed", "ready", "retry", "collect_cash", "settle_demo", "refund"]) }),
  z.object({ action: z.enum(["assign", "reassign", "print_on_idle"]), printerId: z.number().int().positive() }),
  z.object({ action: z.enum(["fail", "cancel"]), reason }),
  z.object({ action: z.literal("pickup"), pin: z.string().regex(/^\d{6}$/) }),
  z.object({ action: z.literal("progress"), value: z.number().int().min(1).max(99) }),
]);
export const printerCommand = z.object({ online: z.boolean(), error: z.string().trim().max(140).nullable(), config: printerConfig.optional() });

export const gatewayReady = () =>
  Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET);

async function orderData(tx: Sql, shop: ShopRow) {
  const rows = await orderRows(tx, shop.id);
  const printers = await printerRows(tx, shop.id);
  const projected = rows.map(row => projectOrder(row));
  const placeholder = pendingEstimate(projected, printers, shop, "NORMAL");
  const info = publicShop(shop, projected, printers, expressEligible(projected, printers, shop.settings),
    shop.settings.open ? placeholder : null, !shop.demo && gatewayReady());
  return { rows, printers, projected, info };
}

function pendingEstimate(orders: ReturnType<typeof projectOrder>[], printers: Printer[], shop: ShopRow, mode: Mode,
  options?: PrintOptions, pages?: number) {
  const opts: PrintOptions = options ?? {
    color: "BW", size: "A4", layout: "PORTRAIT", duplex: false, copies: 1, pages: "",
    collate: true, paper: "STANDARD", finishing: "NONE", instructions: "", confidential: false,
  };
  const probe: ReturnType<typeof projectOrder> = {
    id: "estimate", avatarId: "", token: "", status: "QUEUED", mode, options: opts,
    price: priceOrder(opts, pages ?? 1, mode, shop.settings), method: "COUNTER", payment: "COUNTER_DUE",
    privacy: "AVAILABLE", progress: 0, originalPages: pages ?? 1, retries: 0, reason: null,
    printerId: null, acceptedAt: null, startedAt: null, readyAt: null, completedAt: null, etaMinutes: null, queuePosition: null,
    createdAt: new Date().toISOString(), queuedAt: new Date().toISOString(),
  };
  return queueProjection([...orders, probe], printers, shop.settings).get(probe.id)?.etaMinutes ?? null;
}

export const shopInfo = (shopId: string) => transaction(async tx => (await orderData(tx, await shopRow(tx, shopId))).info);

export async function staffSnapshot(identity: Identity) {
  return transaction(async tx => {
    const shop = await shopRow(tx, identity.shopId);
    // Synchronize projection and event cursor against one consistent shop state.
    await tx.rows("SELECT id FROM shops WHERE id=$1 FOR SHARE", [shop.id]);
    const [latest] = await tx.rows<{ sequence: number }>("SELECT sequence FROM shops WHERE id=$1", [shop.id]);
    const { info, rows, printers } = await orderData(tx, await shopRow(tx, shop.id));
    const jobs = await tx.rows<{ printer_id: number; started_at: Date; finished_at: Date | null }>(`SELECT printer_id,started_at,finished_at
      FROM print_jobs WHERE shop_id=$1 AND started_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`, [shop.id]);
    return { shop: info, user: { name: identity.staff!.name, role: identity.staff!.role }, printers,
      orders: withEstimates(rows.map(row => projectOrder(row, identity.staff!.role)), printers, shop),
      events: await eventRows(tx, shop.id, null), sequence: latest.sequence, ...metrics(rows, printers, jobs) };
  });
}

export async function workflowProjection(identity: Identity, ownId?:string) {
  if (!identity.staff && !ownId) throw new DomainError("Staff access required.", 403);
  return transaction(async tx => {
    await tx.rows("SELECT id FROM shops WHERE id=$1 FOR SHARE", [identity.shopId]);
    const shop = await shopRow(tx, identity.shopId);
    const { projected, printers, rows } = await orderData(tx, shop);
    const media = new Map(rows.map(row => [row.id, row.media_type]));
    if(ownId && !rows.some(r=>r.id===ownId && r.customer_id===identity.id))throw new DomainError("Order unavailable in this session.",404);
    const visible=ownId?projected.filter(o=>o.id===ownId):projected;
    const catalog = visible.map(order => ({
      id: order.id, avatarId: order.avatarId, token: order.token, mode: order.mode, method: order.method,
      ...(order.collectionAt ? { collectionAt: order.collectionAt } : {}), ...(order.courier?{courier:true}:{}), total: order.price.total, createdAt: order.createdAt,
      print: { type: media.get(order.id) === "application/pdf" ? "PDF" : "Image", color: order.options.color,
        size: order.options.size, duplex: order.options.duplex, layout: order.options.layout, copies: order.options.copies,
        paper: order.options.paper, range: order.options.pages || "All pages", collate: order.options.collate,
        confidential: order.options.confidential, impressions: order.price.impressions, sheets: order.price.sheets,
        finishing: order.options.finishing },
    }));
    const active = withEstimates(visible, printers, shop).filter(order => !isClosed(order.status));
    return {
      shopId: shop.id, name: shopDisplayName(shop.settings.name), demo: shop.demo, sequence: shop.sequence, catalog,
      orders: active.map(order => ({
        id: order.id, token: order.token, avatarId: order.avatarId, mode: order.mode,
        ...(order.collectionAt ? { collectionDue: order.payment === "PAID" && Date.parse(order.collectionAt) <= Date.now() } : {}),
        status: order.status, payment: order.payment, printerId: order.printerId, progress: order.progress,
        queuePosition: order.queuePosition, etaMinutes: order.etaMinutes, privacy: order.privacy,
        print: { color: order.options.color, size: order.options.size, duplex: order.options.duplex,
          impressions: order.price.impressions, sheets: order.price.sheets, finishing: order.options.finishing },
      })),
      printers: printers.map(p => ({ id: p.id, name: p.name, model: p.model, color: p.color, duplex: p.duplex, a3: p.a3,
        online: p.online, paperLoaded: p.paperLoaded, jobId: ownId && p.jobId!==ownId?null:p.jobId })),
    };
  });
}

export async function customerOrders(identity: Identity, requested?: string) {
  return transaction(async tx => {
    const shop = await shopRow(tx, identity.shopId);
    const { rows, printers, info } = await orderData(tx, shop);
    const own = rows.filter(row => row.customer_id === identity.id);
    const all = withEstimates(rows.map(row => projectOrder(row, row.customer_id === identity.id ? "CUSTOMER" : undefined)), printers, shop);
    if (!requested) return { shop: info, orders: all.filter(order => own.some(row => row.id === order.id)) };
    const match = own.find(row => row.id === requested || row.token === requested.toUpperCase());
    if (!match) throw new DomainError("This order is unavailable in your current session.", 404);
    const events = await eventRows(tx, shop.id, null, match.id);
    return { shop: info, order: all.find(order => order.id === match.id)!, events: events.map(({ actorId: _actorId, ...event }) => event) };
  });
}

export async function upload(shopId: string, session: Identity | null, data: Buffer, filename: string) {
  const inspected = await inspectDocument(data, filename);
  const id = randomUUID();
  let wrote = false;
  try {
    return await transaction(async tx => {
      const shop = await shopRow(tx, shopId, true);
      if (!shop.settings.open) throw new DomainError("The shop is closed for new orders.", 409);
      const guest = session ? { id: session.id, cookie: undefined } : await newSession(tx, shop, null);
      const who = actor({ id: guest.id, shopId, staff: null });
      if (!session) await emit(tx, who, "CUSTOMER_SESSION_STARTED", null);
      const document = await saveDocument(tx, shopId, guest.id, !shop.demo, inspected, id);
      wrote = true;
      await emit(tx, who, "DOCUMENT_VALIDATED", null);
      return { document, cookie: guest.cookie };
    });
  } catch (error) {
    if (wrote) await removeDocument(id).catch(() => {});
    throw error;
  }
}

async function validatedQuote(tx: Sql, shop: ShopRow, identity: Identity, input: z.infer<typeof quoteInput>) {
  if (!shop.settings.open) throw new DomainError("This shop is currently closed.", 409);
  const doc = await documentRow(tx, shop.id, input.documentId);
  if (!doc || doc.customer_id !== identity.id || doc.privacy !== "AVAILABLE" || doc.expires_at.getTime() <= Date.now())
    throw new DomainError("The document is unavailable. Upload it again.", 404);
  const { projected, printers } = await orderData(tx, shop);
  const devices = printers.filter(p => p.online && p.paperLoaded && compatible(p, input.options));
  if (!devices.length)
    throw new DomainError("No available printer supports that combination of options.", 409);
  const price = priceOrder(input.options, doc.pages, input.mode, shop.settings);
  const expressPrice = priceOrder(input.options, doc.pages, "EXPRESS", shop.settings);
  const expressAvailable = expressEligible(projected, printers, shop.settings, input.options, { price: expressPrice, options: input.options });
  if (input.mode === "EXPRESS" && !expressAvailable) throw new DomainError("Express is at capacity. Select Normal or try again shortly.", 409);
  return {
    price, expressAvailable,
    schedule: {
      leadSeconds: Math.max(600, ...devices.map(p => duration({ price, options: input.options }, p) + 120)),
      expiresAt: doc.expires_at.toISOString(),
    },
    etaMinutes: pendingEstimate(projected, printers, shop, input.mode, input.options, doc.pages),
    expressEta: expressAvailable ? pendingEstimate(projected, printers, shop, "EXPRESS", input.options, doc.pages) : null,
    normalEta: pendingEstimate(projected, printers, shop, "NORMAL", input.options, doc.pages),
  };
}

export const quote = (identity: Identity, input: z.infer<typeof quoteInput>) =>
  transaction(async tx => validatedQuote(tx, await shopRow(tx, identity.shopId), identity, input));

export async function createOrder(identity: Identity, input: z.infer<typeof createInput>) {
  return transaction(async tx => {
    const shop = await shopRow(tx, identity.shopId, true);
    const [existing] = await orderRows(tx, shop.id, "AND o.customer_id=$2 AND o.request_key=$3", [identity.id, input.key]);
    if (existing) return projectOrder(existing, "CUSTOMER");
    if (input.method === "DEMO" && !shop.demo || input.method === "UPI" && (shop.demo || !gatewayReady()) ||
      input.method === "COUNTER" && !shop.settings.counter) throw new DomainError("That payment method is unavailable.", 409);
    if(input.deliveryAddress && (!shop.demo || input.method==="COUNTER"))throw new DomainError("Courier simulation requires prepaid checkout in the virtual shop.");
    const [inUse] = await tx.rows("SELECT id FROM orders WHERE document_id=$1 AND shop_id=$2", [input.documentId, shop.id]);
    if (inUse) throw new DomainError("This upload is already attached to an order. Upload again to place another order.", 409);
    const result = await validatedQuote(tx, shop, identity, input);
    let printAt: Date | null = null;
    if (input.collectionAt) {
      if (input.method === "COUNTER") throw new DomainError("Scheduled orders require prepayment.");
      const collection = Date.parse(input.collectionAt);
      const lead = result.schedule.leadSeconds;
      if (!Number.isFinite(collection) || collection < Date.now() + lead * 1000 || collection >= Date.parse(result.schedule.expiresAt))
        throw new DomainError("Choose a collection time at least " + Math.ceil(lead / 60) + " minutes ahead and before the upload expires.");
      printAt = new Date(collection - lead * 1000);
    }
    if (result.price.total !== input.confirmedTotal) throw new DomainError("The price changed. Review the updated quote and try again.", 409);
    const [count] = await tx.rows<{ token_counter: number }>("UPDATE shops SET token_counter=token_counter+1 WHERE id=$1 RETURNING token_counter", [shop.id]);
    const id = randomUUID();
    const token = "PF-" + count.token_counter;
    const who = actor(identity, input.key);
    const status = input.method === "COUNTER" ? "QUEUED" : "AWAITING_PAYMENT";
    await tx.rows(`INSERT INTO orders(id,shop_id,customer_id,document_id,token,request_key,mode,status,price,options,pickup_pin,queued_at,delivery_address)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $8='QUEUED' THEN now() ELSE NULL END,$12)`,
    [id, shop.id, identity.id, input.documentId, token, input.key, input.mode, status, result.price, input.options, String(randomInt(100000, 1000000)),input.deliveryAddress??null]);
    if (printAt) await tx.rows("UPDATE orders SET collection_at=$2,print_at=$3 WHERE id=$1", [id, input.collectionAt, printAt]);
    await tx.rows("INSERT INTO payments(order_id,method,state,amount) VALUES ($1,$2,$3,$4)",
      [id, input.method, input.method === "COUNTER" ? "COUNTER_DUE" : "PENDING", result.price.total]);
    const payload = { token, mode: input.mode, total: result.price.total };
    await emit(tx, who, "ORDER_CREATED", id, payload);
    await emit(tx, who, "SERVICE_MODE_SELECTED", id, payload);
    await emit(tx, who, "PRICE_CALCULATED", id, payload);
    await emit(tx, who, "PAYMENT_PENDING", id, payload);
    if (status === "QUEUED") await queueEvents(tx, who, id, payload);
    await emit(tx, who, "OWNER_NOTIFIED", id, payload);
    const [order] = await orderRows(tx, shop.id, "AND o.id=$2", [id]);
    return projectOrder(order, "CUSTOMER");
  });
}

async function queueEvents(tx: Sql, who: Actor, id: string, payload: { token: string; mode: Mode }) {
  const safe = { token: payload.token, mode: payload.mode };
  await emit(tx, who, "ORDER_QUEUED", id, safe);
  if (safe.mode === "EXPRESS") await emit(tx, who, "EXPRESS_PRIORITY_ASSIGNED", id, safe);
}

export async function paymentConfirmed(tx: Sql, who: Actor, row: OrderRow, providerPayment?: string) {
  if (row.payment === "PAID" || row.payment === "REFUNDED" || row.payment === "REFUND_PENDING") return;
  if (!["COUNTER_DUE", "PENDING", "VOID"].includes(row.payment)) throw new DomainError("This payment cannot be confirmed.", 409);
  if (row.payment === "VOID" && !providerPayment) throw new DomainError("This payment was voided.", 409);
  // A capture arriving after cancellation still has to be accounted for and refunded.
  const cancelled = row.status === "CANCELLED";
  await tx.rows("UPDATE payments SET state=$3,provider_payment=COALESCE($2,provider_payment),paid_at=now() WHERE order_id=$1",
    [row.id, providerPayment ?? null, cancelled ? "REFUND_PENDING" : "PAID"]);
  await emit(tx, who, "PAYMENT_CONFIRMED", row.id, { token: row.token, mode: row.mode, simulated: row.method === "DEMO", total: row.price.total });
  if (cancelled) await emit(tx, who, "REFUND_INITIATED", row.id, { token: row.token, mode: row.mode });
  if (row.status === "AWAITING_PAYMENT") {
    if (row.print_at && row.print_at.getTime() > Date.now()) {
      await tx.rows("UPDATE orders SET status='SCHEDULED' WHERE id=$1", [row.id]);
      await emit(tx, who, "ORDER_SCHEDULED", row.id, { token: row.token, mode: row.mode });
      return;
    }
    await tx.rows("UPDATE orders SET status='QUEUED',queued_at=now() WHERE id=$1", [row.id]);
    await queueEvents(tx, who, row.id, row);
  }
}

export async function demoPayment(identity: Identity, id: string) {
  return transaction(async tx => {
    const shop = await shopRow(tx, identity.shopId, true);
    const [row] = await orderRows(tx, shop.id, "AND o.id=$2 AND o.customer_id=$3", [id, identity.id]);
    if (!row || !shop.demo || row.method !== "DEMO") throw new DomainError("Demo payment is unavailable for this order.", 404);
    if(row.payment!=="PAID")guard(row,"AWAITING_PAYMENT");
    await paymentConfirmed(tx, actor(identity), row);
  });
}

export async function qrPayment(
  shopId: string,
  reference: string,
  confirm: boolean,
  customerId?: string,
) {
  return transaction(async (tx) => {
    const shop = await shopRow(tx, shopId, confirm);
    const [row] = await orderRows(tx, shopId, "AND o.payment_reference=$2", [
      reference,
    ]);
    if (!shop.demo || !row || row.method !== "DEMO")
      throw new DomainError("Payment link unavailable.", 404);
    if (confirm && row.payment !== "PAID") {
      guard(row, "AWAITING_PAYMENT");
      await paymentConfirmed(tx, system(shopId), row);
    }
    return {
      token: row.token,
      total: row.price.total,
      paid: confirm || row.payment === "PAID",
      available: row.status === "AWAITING_PAYMENT",
      canTrack: customerId === row.customer_id,
    };
  });
}
export async function confirmDelivery(identity: Identity, id: string) {
  return transaction(async (tx) => {
    await shopRow(tx, identity.shopId, true);
    const [row] = await orderRows(
      tx,
      identity.shopId,
      "AND o.id=$2 AND o.customer_id=$3",
      [id, identity.id],
    );
    if (!row) throw new DomainError("Order unavailable.", 404);
    if (row.delivered_at) return;
    if (!row.delivery_address || row.status !== "COMPLETED")
      throw new DomainError("Courier collection is still pending.", 409);
    await tx.rows(
      "UPDATE orders SET delivered_at=now(), delivery_address=NULL WHERE id=$1",
      [id],
    );
    await emit(tx, actor(identity), "DELIVERY_RECEIVED", id, {
      token: row.token,
    });
  });
}
function guard(row: OrderRow, ...allowed: Status[]) {
  if (!allowed.includes(row.status)) throw new DomainError("This action is unavailable in the current order state.", 409);
}

async function closeJob(tx: Sql, row: OrderRow, result: string) {
  if (row.job_id) await tx.rows("UPDATE print_jobs SET finished_at=now(),result=$2 WHERE id=$1 AND finished_at IS NULL", [row.job_id, result]);
}

async function assign(tx: Sql, shop: ShopRow, who: Actor, row: OrderRow, printer: Printer) {
  if (!printer.online || !printer.paperLoaded || printer.jobId || !compatible(printer, row.options))
    throw new DomainError("Choose an idle online printer that supports these settings and has paper.", 409);
  if (row.privacy !== "AVAILABLE" || row.expires_at.getTime() <= Date.now())
    throw new DomainError("The temporary document has expired.", 409);
  await tx.rows("INSERT INTO print_jobs(id,shop_id,printer_id,order_id,simulated) VALUES ($1,$2,$3,$4,$5)",
    [randomUUID(), shop.id, printer.id, row.id, shop.demo]);
  await tx.rows("UPDATE printers SET normal_passed=CASE WHEN $3='NORMAL' THEN 0 ELSE normal_passed+1 END WHERE shop_id=$1 AND id=$2",
    [shop.id, printer.id, row.mode]);
  await tx.rows("UPDATE orders SET status='ASSIGNED',accepted_at=COALESCE(accepted_at,now()),progress=0,reason=NULL WHERE id=$1", [row.id]);
  await emit(tx, who, "PRINTER_ASSIGNED", row.id, { token: row.token, mode: row.mode, printerId: printer.id, simulated: shop.demo });
}

async function start(tx: Sql, shop: ShopRow, who: Actor, row: OrderRow) {
  if (row.privacy !== "AVAILABLE" || row.expires_at.getTime() <= Date.now()) throw new DomainError("The temporary document has expired.", 409);
  const target = (await printerRows(tx, shop.id)).find(p => p.id === row.printer_id);
  if (!target?.online || !target.paperLoaded) throw new DomainError("The assigned printer is unavailable.", 409);
  await tx.rows("UPDATE print_jobs SET started_at=COALESCE(started_at,now()) WHERE id=$1 AND finished_at IS NULL", [row.job_id]);
  await tx.rows("UPDATE orders SET status='PRINTING',started_at=now() WHERE id=$1", [row.id]);
  await emit(tx, who, "PRINT_STARTED", row.id, { token: row.token, mode: row.mode, printerId: target.id, simulated: shop.demo });
}

async function fail(tx: Sql, shop: ShopRow, who: Actor, row: OrderRow, message: string) {
  await closeJob(tx, row, "FAILED");
  await tx.rows("UPDATE orders SET status='FAILED',reason=$2 WHERE id=$1", [row.id, message]);
  await emit(tx, who, "PRINT_FAILED", row.id, {
    token: row.token, mode: row.mode, printerId: row.printer_id ?? undefined, simulated: shop.demo,
  });
}

async function printed(tx: Sql, shop: ShopRow, who: Actor, row: OrderRow) {
  await closeJob(tx, row, "PRINTED");
  await tx.rows("UPDATE orders SET status='FINISHING',printed_at=now(),progress=100 WHERE id=$1", [row.id]);
  await emit(tx, who, "PRINT_COMPLETED", row.id, { token: row.token, mode: row.mode, printerId: row.printer_id ?? undefined, simulated: shop.demo });
}

async function startAssigned(tx: Sql, shop: ShopRow, who: Actor, id: string) {
  const [assigned] = await orderRows(tx, shop.id, "AND o.id=$2", [id]);
  await start(tx, shop, who, assigned);
}

async function markReady(tx: Sql, who: Actor, row: OrderRow) {
  const payload = { token: row.token, mode: row.mode };
  await tx.rows("UPDATE orders SET status='READY',ready_at=now() WHERE id=$1", [row.id]);
  await emit(tx, who, "WORKER_COLLECTED_PAPERS", row.id, payload);
  await emit(tx, who, "ORDER_READY_FOR_PICKUP", row.id, payload);
  if (row.delivery_address && (!row.collection_at || row.collection_at.getTime() <= Date.now())) await emit(tx, who, "COURIER_ARRIVED", row.id, payload);
}

async function collected(tx: Sql, who: Actor, row: OrderRow, automatic: boolean) {
  const payload = { token: row.token, mode: row.mode, simulated: automatic };
  await tx.rows("UPDATE orders SET status='COMPLETED',completed_at=now() WHERE id=$1", [row.id]);
  if (row.delivery_address) await emit(tx, who, "COURIER_COLLECTED", row.id, payload);
  await emit(tx, who, automatic ? "AUTO_COLLECTED" : "PICKUP_VERIFIED", row.id, payload);
  await emit(tx, who, "ORDER_COMPLETED", row.id, payload);
  await requestPurge(tx, who, row);
}

async function requestPurge(tx: Sql, who: Actor, row: OrderRow) {
  if (row.privacy !== "AVAILABLE") return;
  await tx.rows("UPDATE documents SET privacy='PURGE_REQUESTED',retry_at=now() WHERE id=$1", [row.document_id]);
  await emit(tx, who, "DOCUMENT_PURGE_REQUESTED", row.id, { token: row.token, mode: row.mode });
}

async function cancel(tx: Sql, who: Actor, row: OrderRow, message: string) {
  await closeJob(tx, row, "CANCELLED");
  await tx.rows("UPDATE orders SET status='CANCELLED',reason=$2 WHERE id=$1", [row.id, message]);
  await emit(tx, who, "ORDER_CANCELLED", row.id, { token: row.token, mode: row.mode });
  if (row.payment === "PAID") {
    await tx.rows("UPDATE payments SET state='REFUND_PENDING' WHERE order_id=$1", [row.id]);
    await emit(tx, who, "REFUND_INITIATED", row.id, { token: row.token, mode: row.mode });
  } else if (row.payment === "PENDING" || row.payment === "COUNTER_DUE") {
    await tx.rows("UPDATE payments SET state='VOID' WHERE order_id=$1", [row.id]);
  }
  await requestPurge(tx, who, row);
}

export async function customerCancel(identity: Identity, id: string) {
  return transaction(async tx => {
    const shop = await shopRow(tx, identity.shopId, true);
    const [row] = await orderRows(tx, shop.id, "AND o.id=$2 AND o.customer_id=$3", [id, identity.id]);
    if (!row) throw new DomainError("Order not found.", 404);
    if (row.status === "CANCELLED") return;
    guard(row, "AWAITING_PAYMENT", "SCHEDULED", "QUEUED");
    await cancel(tx, actor(identity), row, "Cancelled by customer.");
  });
}

export async function command(identity: Identity, id: string, key: string, input: z.infer<typeof staffCommand>) {
  if (!identity.staff) throw new DomainError("Staff access required.", 403);
  const problem = await transaction(async tx => {
    const shop = await shopRow(tx, identity.shopId, true);
    const who = actor(identity, key);
    const [row] = await orderRows(tx, shop.id, "AND o.id=$2", [id]);
    if (!row) throw new DomainError("Order not found.", 404);
    const [seen] = await tx.rows("SELECT id FROM commands WHERE shop_id=$1 AND actor_id=$2 AND id=$3", [shop.id, who.actorId, key]);
    if (seen) return;
    const payload = { token: row.token, mode: row.mode, printerId: row.printer_id ?? undefined, simulated: shop.demo };
    switch (input.action) {
      case "accept":
        guard(row, "QUEUED");
        if (!row.accepted_at) {
          await tx.rows("UPDATE orders SET accepted_at=now() WHERE id=$1", [id]);
          await emit(tx, who, "ORDER_ACCEPTED", id, payload);
        }
        break;
      case "print_on_idle":
      case "assign":
      case "reassign": {
        guard(row, input.action === "reassign" ? "ASSIGNED" : "QUEUED");
        const target = (await printerRows(tx, shop.id)).find(p => p.id === input.printerId);
        if (!target) throw new DomainError("Printer not found.", 404);
        if (input.action === "reassign" && row.printer_id === target.id) break;
        const queued = (await orderRows(tx, shop.id, "AND o.status='QUEUED'")).map(order => projectOrder(order));
        const next = pickNext([...queued.filter(order => order.id !== id), projectOrder(row)], target, shop.settings, Date.now());
        if (input.action === "print_on_idle" && next?.id !== row.id)
          throw new DomainError("The queue has changed. Refresh the printer and try its next job.", 409);
        if (compatible(target, row.options) && target.online && target.paperLoaded && !target.jobId &&
            next && next.id !== id && row.mode === "EXPRESS" && next.mode === "NORMAL")
          throw new DomainError("A Normal order has reached its priority protection. Assign that order first.", 409);
        await closeJob(tx, row, "REASSIGNED");
        await assign(tx, shop, who, row, target);
        if (input.action === "print_on_idle" && shop.demo) await startAssigned(tx, shop, who, row.id);
        break;
      }
      case "start":
        guard(row, "ASSIGNED");
        await start(tx, shop, who, row);
        break;
      case "hold":
        guard(row, "PRINTING");
        if (!shop.demo) throw new DomainError("Printer pause is only available in the simulated shop.", 409);
        await tx.rows("UPDATE orders SET status='HELD' WHERE id=$1", [id]);
        await emit(tx, who, "PRINT_HELD", id, payload);
        break;
      case "resume":
        guard(row, "HELD");
        await start(tx, shop, who, row);
        break;
      case "printed":
        guard(row, "PRINTING");
        if (shop.demo) throw new DomainError("The demo printer reports completion automatically.", 409);
        await printed(tx, shop, who, row);
        break;
      case "progress":
        guard(row, "PRINTING");
        if (shop.demo || input.value <= row.progress) throw new DomainError("Enter a higher observed progress value.", 409);
        await tx.rows("UPDATE orders SET progress=$2 WHERE id=$1", [id, input.value]);
        await emit(tx, who, "PRINT_PROGRESS_UPDATED", id, { ...payload, progress: input.value });
        break;
      case "ready":
        if (row.status === "READY") break;
        guard(row, "FINISHING");
        await markReady(tx, who, row);
        break;
      case "settle_demo":
        if (!shop.demo || row.method !== "DEMO") throw new DomainError("Simulation payment unavailable.", 409);
        if (row.payment === "PAID") break;
        guard(row, "AWAITING_PAYMENT");
        await paymentConfirmed(tx, who, row);
        break;
      case "collect_cash":
        if (row.method !== "COUNTER" || row.payment !== "COUNTER_DUE" || isClosed(row.status))
          throw new DomainError("There is no counter payment due for this order.", 409);
        await paymentConfirmed(tx, who, row);
        break;
      case "pickup":
        guard(row, "READY");
        if (shop.demo && row.collection_at && row.collection_at.getTime() > Date.now()) throw new DomainError("The booked collection time has not arrived.", 409);
        if (row.payment !== "PAID") throw new DomainError("Collect the outstanding payment before pickup.", 409);
        if (row.pickup_retry_at && row.pickup_retry_at.getTime() > Date.now())
          throw new DomainError("Pickup verification is temporarily locked. Try again in five minutes.", 429);
        if (!timingSafeEqual(Buffer.from(row.pickup_pin), Buffer.from(input.pin))) {
          await tx.rows(`UPDATE orders SET pickup_failures=CASE WHEN pickup_failures>=4 THEN 0 ELSE pickup_failures+1 END,
            pickup_retry_at=CASE WHEN pickup_failures>=4 THEN now()+interval '5 minutes' ELSE NULL END WHERE id=$1`, [id]);
          return new DomainError("The collection code does not match.", 400);
        }
        await collected(tx, who, row, false);
        break;
      case "fail":
        guard(row, "ASSIGNED", "PRINTING", "HELD");
        await fail(tx, shop, who, row, input.reason);
        break;
      case "retry":
        guard(row, "FAILED");
        if (row.privacy !== "AVAILABLE" || row.expires_at.getTime() <= Date.now()) throw new DomainError("The temporary document has expired.", 409);
        await tx.rows("UPDATE orders SET status='QUEUED',queued_at=now(),started_at=NULL,progress=0,retries=retries+1,reason=NULL WHERE id=$1", [id]);
        await queueEvents(tx, who, id, row);
        break;
      case "cancel":
        if (isClosed(row.status)) throw new DomainError("This order is already closed.", 409);
        await cancel(tx, who, row, input.reason);
        break;
      case "refund":
        if (identity.staff!.role !== "OWNER") throw new DomainError("Only an owner can refund.", 403);
        if (row.payment !== "REFUND_PENDING" || row.method === "UPI") throw new DomainError("Use the gateway workflow for online refunds.", 409);
        await tx.rows("UPDATE payments SET state='REFUNDED',refunded_at=now() WHERE order_id=$1", [id]);
        await emit(tx, who, "REFUND_COMPLETED", id, payload);
        break;
    }
    await tx.rows("INSERT INTO commands VALUES ($1,$2,$3)", [shop.id, who.actorId, key]);
  });
  if (problem) throw problem;
}

export async function changePrinter(identity: Identity, printerId: number, input: z.infer<typeof printerCommand>) {
  if (!identity.staff) throw new DomainError("Staff access required.", 403);
  if (input.config && identity.staff.role !== "OWNER") throw new DomainError("Only an owner can change printer capabilities.", 403);
  return transaction(async tx => {
    const shop = await shopRow(tx, identity.shopId, true);
    const who = actor(identity);
    const p = (await printerRows(tx, shop.id)).find(printer => printer.id === printerId);
    if (!p) throw new DomainError("Printer not found.", 404);
    if (p.jobId) {
      const [row] = await orderRows(tx, shop.id, "AND o.id=$2", [p.jobId]);
      if (input.config && !compatible(input.config, row.options))
        throw new DomainError("Finish or reassign the current job before changing these capabilities.", 409);
      if (!input.online || input.config?.paperLoaded === false) {
        if (row.status === "ASSIGNED") {
          await closeJob(tx, row, "REQUEUED");
          await tx.rows("UPDATE orders SET status='QUEUED',progress=0 WHERE id=$1", [row.id]);
          await queueEvents(tx, who, row.id, row);
        } else await fail(tx, shop, who, row, input.error || "The printer became unavailable. Check output before retrying.");
      }
    }
    await tx.rows("UPDATE printers SET online=$3,error=$4,config=COALESCE($5,config) WHERE shop_id=$1 AND id=$2",
      [shop.id, p.id, input.online, input.online ? null : input.error || "Marked offline by staff.", input.config ?? null]);
    await emit(tx, who, input.online === p.online ? "PRINTER_UPDATED" : input.online ? "PRINTER_ONLINE" : "PRINTER_OFFLINE",
      null, { printerId: p.id, paperLoaded: input.config?.paperLoaded ?? p.paperLoaded, simulated: shop.demo });
  });
}

export async function updateSettings(identity: Identity, input: z.infer<typeof settingsSchema>) {
  if (identity.staff?.role !== "OWNER") throw new DomainError("Only an owner can change shop settings.", 403);
  await transaction(async tx => {
    await shopRow(tx, identity.shopId, true);
    await tx.rows("UPDATE shops SET settings=$2 WHERE id=$1", [identity.shopId, input]);
    await emit(tx, actor(identity), "SHOP_SETTINGS_UPDATED", null);
  });
}

export async function runScheduler(shopId: string) {
  await transaction(async tx => {
    const shop = await shopRow(tx, shopId, true);
    const who = system(shopId);
    const now = Date.now();
    const documents = await tx.rows<DocumentRow>(`SELECT * FROM documents WHERE shop_id=$1 AND privacy<>'PURGED' AND
      ((privacy='AVAILABLE' AND expires_at<=now()) OR (privacy IN ('PURGE_REQUESTED','PURGE_FAILED') AND retry_at<=now())) LIMIT 30`, [shop.id]);
    for (const doc of documents) {
      const [linked] = await orderRows(tx, shop.id, "AND o.document_id=$2", [doc.id]);
      if (doc.privacy === "AVAILABLE") {
        if (linked && ["AWAITING_PAYMENT", "SCHEDULED", "QUEUED", "ASSIGNED"].includes(linked.status)) await cancel(tx, who, linked, "The temporary document expired.");
        else if (linked && ["PRINTING", "HELD"].includes(linked.status)) await fail(tx, shop, who, linked, "The temporary document expired.");
        if (!linked || !["AWAITING_PAYMENT", "SCHEDULED", "QUEUED", "ASSIGNED"].includes(linked.status))
          await emit(tx, who, "DOCUMENT_PURGE_REQUESTED", linked?.id ?? null, linked ? { token: linked.token } : {});
      }
      try {
        await removeDocument(doc.id);
      } catch {
        await tx.rows(`UPDATE documents SET privacy='PURGE_FAILED',purge_attempts=purge_attempts+1,
          retry_at=now()+interval '30 seconds' * LEAST(120,purge_attempts+1) WHERE id=$1`, [doc.id]);
        await emit(tx, who, "DOCUMENT_PURGE_FAILED", linked?.id ?? null, linked ? { token: linked.token } : {});
        continue;
      }
      await tx.rows("UPDATE documents SET privacy='PURGED',purged_at=now(),retry_at=NULL WHERE id=$1", [doc.id]);
      await emit(tx, who, "DOCUMENT_PURGED", linked?.id ?? null, linked ? { token: linked.token } : {});
    }
    const due = await orderRows(tx, shop.id, "AND o.status='SCHEDULED' AND o.print_at<=now() AND p.state='PAID'");
    for (const row of due) {
      await tx.rows("UPDATE orders SET status='QUEUED',queued_at=now() WHERE id=$1", [row.id]);
      await queueEvents(tx, who, row.id, row);
    }
    const open = "AND o.status NOT IN ('COMPLETED','CANCELLED','AWAITING_PAYMENT')";
    const reminders = await orderRows(tx, shop.id, open + " AND o.collection_at<=now()+interval '10 minutes' AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id=o.id AND e.type='COLLECTION_REMINDER')");
    for (const row of reminders) await emit(tx, who, "COLLECTION_REMINDER", row.id, { token: row.token });
    const overdue = await orderRows(tx, shop.id, "AND o.status IN ('AWAITING_PAYMENT','QUEUED','ASSIGNED','HELD') AND (o.print_at IS NULL OR o.print_at<=now()) AND COALESCE(o.queued_at,o.created_at) <= now()-$2*interval '1 minute' AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id=o.id AND e.type='WAIT_ALERT')", [shop.settings.normalWait]);
    for (const row of overdue) await emit(tx, who, "WAIT_ALERT", row.id, { token: row.token });
    if (shop.demo) {
      const arrivals = await orderRows(tx, shop.id, open + " AND o.collection_at<=now() AND (o.delivery_address IS NULL OR o.status='READY') AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id=o.id AND e.type IN ('CUSTOMER_ARRIVED','COURIER_ARRIVED'))");
      for (const row of arrivals) await emit(tx, who, row.delivery_address ? "COURIER_ARRIVED" : "CUSTOMER_ARRIVED", row.id, { token: row.token });
    }
    const waitingRiders = await orderRows(tx, shop.id, "AND o.status='READY' AND o.delivery_address IS NOT NULL AND GREATEST(o.ready_at,o.collection_at)<=now()-$2*interval '1 minute' AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id=o.id AND e.type='COURIER_WAIT')", [shop.settings.normalWait]);
    for (const row of waitingRiders) await emit(tx, who, "COURIER_WAIT", row.id, { token: row.token });
    if (shop.demo) {
      const finishing = await orderRows(tx, shop.id, "AND o.status='FINISHING' AND COALESCE(o.printed_at,o.started_at)<=now()-interval '6 seconds'");
      for (const row of finishing) await markReady(tx, who, row);
      const pickups = await orderRows(tx, shop.id, "AND o.status='READY' AND p.state='PAID' AND o.delivery_address IS NULL AND GREATEST(o.ready_at,p.paid_at)<=now()-interval '15 seconds' AND (o.collection_at IS NULL OR o.collection_at<=now())");
      for (const row of pickups) await collected(tx, who, row, true);
      const printing = await orderRows(tx, shop.id, "AND o.status='PRINTING'");
      const printers = await printerRows(tx, shop.id);
      for (const row of printing) {
        const printer = printers.find(p => p.id === row.printer_id);
        if (!printer || !row.started_at || !printer.online || !printer.paperLoaded) continue;
        const total = Math.min(28000, Math.max(10000, duration(projectOrder(row), printer) * 180));
        const progress = Math.floor((now - row.started_at.getTime()) / total * 100);
        if (progress >= 100) await printed(tx, shop, who, row);
        else if (progress >= row.progress + 10) {
          await tx.rows("UPDATE orders SET progress=$2 WHERE id=$1", [row.id, progress]);
          await emit(tx, who, "PRINT_PROGRESS_UPDATED", row.id,
            { token: row.token, mode: row.mode, printerId: printer.id, progress, simulated: true });
        }
      }
    }
    {
      const eligibility = shop.settings.automatic ? "" : " AND o.print_at IS NOT NULL";
      const rows = await orderRows(tx, shop.id, "AND o.status='QUEUED' AND d.privacy='AVAILABLE' AND d.expires_at>now()" + eligibility);
      const queued = rows.map(row => projectOrder(row));
      const printers = (await printerRows(tx, shop.id)).filter(p => p.online && p.paperLoaded && !p.jobId);
      // Reserve specialist devices by filling the least flexible compatible devices first.
      printers.sort((a, b) => Number(a.color) + Number(a.a3) + Number(a.duplex) + Number(a.premium) -
        Number(b.color) - Number(b.a3) - Number(b.duplex) - Number(b.premium) || b.ppm - a.ppm);
      for (const printer of printers) {
        const selected = pickNext(queued, printer, shop.settings, now);
        if (!selected) continue;
        await assign(tx, shop, who, rows.find(row => row.id === selected.id)!, printer);
        if (shop.demo && selected.printAt) await startAssigned(tx, shop, who, selected.id);
        queued.splice(queued.indexOf(selected), 1);
      }
    }
  });
}
