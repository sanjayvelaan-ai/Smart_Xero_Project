import { createHmac, timingSafeEqual } from "node:crypto";
import { DomainError } from "../domain";
import { shopDisplayName } from "../lib/brand";
import { transaction } from "./db";
import { shopRow, type Identity } from "./identity";
import { gatewayReady, paymentConfirmed } from "./operations";
import { emit, orderRows, system } from "./records";

type GatewayPayment = { id: string; order_id: string; amount: number; currency: string; status: string };
type GatewayRefund = { id: string; payment_id: string; amount: number; currency: string; status: string };
type GatewayOrder = { id: string; amount: number; currency: string };

async function gateway<T>(path: string, payload?: Record<string, unknown>) {
  if (!gatewayReady()) throw new DomainError("UPI checkout is not configured.", 503);
  const token = Buffer.from(process.env.RAZORPAY_KEY_ID + ":" + process.env.RAZORPAY_KEY_SECRET).toString("base64");
  let response: Response;
  try {
    response = await fetch("https://api.razorpay.com/v1/" + path, {
      headers: { Authorization: "Basic " + token, "Content-Type": "application/json" },
      method: payload ? "POST" : "GET", body: payload ? JSON.stringify(payload) : undefined,
      cache: "no-store", signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new DomainError("The payment service is temporarily unavailable. Please try again.", 502);
  }
  if (!response.ok) throw new DomainError("The payment service could not complete this request. Please try again.", 502);
  return await response.json() as T;
}

export function validGatewaySignature(data: string, supplied: string, secret: string) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
  return timingSafeEqual(createHmac("sha256", secret).update(data).digest(), Buffer.from(supplied, "hex"));
}

export async function checkout(identity: Identity, id: string) {
  return transaction(async tx => {
    const shop = await shopRow(tx, identity.shopId, true);
    const [order] = await orderRows(tx, shop.id, "AND o.id=$2 AND o.customer_id=$3", [id, identity.id]);
    if (shop.demo || !order || order.method !== "UPI") throw new DomainError("Online checkout is unavailable for this order.", 404);
    if (order.status !== "AWAITING_PAYMENT" || order.payment !== "PENDING") throw new DomainError("This order has no outstanding online payment.", 409);
    let gatewayId = order.provider_order;
    if (!gatewayId) {
      const result = await gateway<GatewayOrder>("orders", { amount: order.price.total, currency: "INR", receipt: order.id });
      if (result.amount !== order.price.total || result.currency !== "INR") throw new DomainError("The payment amount could not be validated.", 502);
      gatewayId = result.id;
      await tx.rows("UPDATE payments SET provider_order=$2 WHERE order_id=$1", [id, gatewayId]);
    }
    return { key: process.env.RAZORPAY_KEY_ID, order_id: gatewayId, amount: order.price.total, currency: "INR", name: shopDisplayName(shop.settings.name) };
  });
}

async function applyPayment(shopId: string, payment: GatewayPayment, failed = false) {
  await transaction(async tx => {
    const shop = await shopRow(tx, shopId, true);
    if (shop.demo) throw new DomainError("The demo shop has no live payments.", 404);
    const [order] = await orderRows(tx, shop.id, "AND p.provider_order=$2", [payment.order_id]);
    if (!order || order.method !== "UPI" || payment.currency !== "INR" || payment.amount !== order.price.total) return;
    const who = system(shop.id);
    if (failed && payment.status === "failed" && order.payment === "PENDING") {
      const [existing] = await tx.rows("SELECT 1 FROM payment_callbacks WHERE id=$1", ["failed:" + payment.id]);
      if (!existing) {
        await tx.rows("INSERT INTO payment_callbacks(id,order_id) VALUES ($1,$2)", ["failed:" + payment.id, order.id]);
        await emit(tx, who, "PAYMENT_FAILED", order.id, { token: order.token, mode: order.mode });
      }
    } else if (payment.status === "captured") await paymentConfirmed(tx, who, order, payment.id);
  });
}

async function applyRefund(shopId: string, refund: GatewayRefund) {
  await transaction(async tx => {
    const shop = await shopRow(tx, shopId, true);
    if (shop.demo) throw new DomainError("The demo shop has no live refunds.", 404);
    const [order] = await orderRows(tx, shop.id, "AND p.provider_payment=$2", [refund.payment_id]);
    if (!order || order.method !== "UPI" || order.payment !== "REFUND_PENDING" || refund.currency !== "INR" ||
      refund.amount !== order.price.total || refund.status !== "processed") return;
    await tx.rows("UPDATE payments SET state='REFUNDED',refunded_at=now() WHERE order_id=$1", [order.id]);
    await emit(tx, system(shop.id), "REFUND_COMPLETED", order.id, { token: order.token, mode: order.mode });
  });
}

export async function reconcile(identity: Identity, id: string) {
  const [order] = await transaction(tx => orderRows(tx, identity.shopId,
    identity.staff ? "AND o.id=$2" : "AND o.id=$2 AND o.customer_id=$3", identity.staff ? [id] : [id, identity.id]));
  if (!order?.provider_order || order.method !== "UPI") throw new DomainError("Open the online checkout first.", 409);
  if (order.provider_payment && order.payment === "REFUND_PENDING") {
    const result = await gateway<{ items: GatewayRefund[] }>("payments/" + encodeURIComponent(order.provider_payment) + "/refunds");
    for (const item of result.items) await applyRefund(identity.shopId, item);
    return;
  }
  const result = await gateway<{ items: GatewayPayment[] }>("orders/" + encodeURIComponent(order.provider_order) + "/payments");
  for (const item of result.items.filter(payment => payment.status === "captured")) await applyPayment(identity.shopId, item);
}

export async function webhook(shopId: string, raw: string, signature: string) {
  if (!validGatewaySignature(raw, signature, process.env.RAZORPAY_WEBHOOK_SECRET ?? ""))
    throw new DomainError("Invalid payment signature.", 401);
  type Payload = { event: string; payload?: { payment?: { entity: GatewayPayment }; refund?: { entity: GatewayRefund } } };
  const event = JSON.parse(raw) as Payload;
  const payment = event.payload?.payment?.entity;
  const refund = event.payload?.refund?.entity;
  if (payment && ["payment.captured", "payment.failed", "order.paid"].includes(event.event)) {
    await applyPayment(shopId, payment, event.event === "payment.failed");
  }
  if (refund && event.event === "refund.processed") await applyRefund(shopId, refund);
}
