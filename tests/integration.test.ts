import { strict as assert } from "node:assert";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { before, test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { defaultOptions, defaultSettings } from "../src/domain";
import { transaction } from "../src/server/db";
import { inspectDocument, samplePdf } from "../src/server/documents";
import { validGatewaySignature, webhook } from "../src/server/gateway";
import { DEMO_SHOP, REAL_SHOP, identity, seed, signIn, type Identity } from "../src/server/identity";
import { changePrinter, command, createOrder, customerCancel, customerOrders, demoPayment, quote, runScheduler, shopInfo,
  qrPayment, workflowProjection, staffSnapshot, updateSettings, upload } from "../src/server/operations";
import { eventRows } from "../src/server/records";

let directory: string;
let owner: Identity;
let realOwner: Identity;
let worker: Identity;
before(async () => {
  await mkdir(path.resolve(".printflow/tests"), { recursive: true });
  directory = await mkdtemp(path.resolve(".printflow/tests/run-"));
  process.env.PRINTFLOW_DATA_DIR = directory;
  delete process.env.DATABASE_URL;
  process.env.PRINTFLOW_OWNER_PASSWORD = "test-only-password-123";
  process.env.PRINTFLOW_WORKER_PASSWORD = "test-worker-password-123";
  process.env.PRINTFLOW_DOCUMENT_KEY = Buffer.alloc(32, 1).toString("base64");
  process.env.RAZORPAY_KEY_ID = "test-key";
  process.env.RAZORPAY_KEY_SECRET = "test-secret";
  process.env.RAZORPAY_WEBHOOK_SECRET = "test-webhook";
  await seed();
  const local=JSON.parse(await readFile(path.join(directory,"staff-access.json"),"utf8"));
  owner = await staff(DEMO_SHOP, "ram",local.ram);
  worker = await staff(DEMO_SHOP, "meena",local.meena);
  realOwner = await staff(REAL_SHOP, "ram", process.env.PRINTFLOW_OWNER_PASSWORD);
});

function fakeRequest(cookie: string) { return new Request("http://localhost", { headers: { cookie: cookie.split(";")[0] } }); }
async function staff(shop: string, username: string, password: string) {
  const result = await signIn(shop, username, password);
  return (await identity(fakeRequest(result.cookie), shop, true))!;
}
async function document(shop = DEMO_SHOP, confidential = false) {
  const result = await upload(shop, null, samplePdf(4), confidential ? "restricted-filename.pdf" : "assignment.pdf");
  const user = (await identity(fakeRequest(result.cookie!), shop))!;
  return { doc: result.document, user, options: { ...defaultOptions, confidential } };
}
async function submit(sample: Awaited<ReturnType<typeof document>>, mode = "NORMAL" as "NORMAL" | "EXPRESS",
  method = "DEMO" as "DEMO" | "UPI" | "COUNTER") {
  const q = await quote(sample.user, { documentId: sample.doc.id, options: sample.options, mode });
  const input = { documentId: sample.doc.id, options: sample.options, mode, method, confirmedTotal: q.price.total, key: randomUUID() };
  const order = await createOrder(sample.user, input);
  return { order, input };
}
const run = (actor: Identity, id: string, input: Parameters<typeof command>[3], key = randomUUID()) => command(actor, id, key, input);

test("paid scheduled pickups wait, release once, print when a device is free and collect at the booked time", async () => {
  const sample = await document();
  const base = { documentId: sample.doc.id, options: sample.options, mode: "NORMAL" as const };
  const bulk = { ...base, options: { ...base.options, copies: 50 } };
  const bulkQuote = await quote(sample.user, bulk);
  assert.ok(bulkQuote.schedule.leadSeconds > 600);
  for (const invalidTime of [Date.now() + 600_000, Date.parse(bulkQuote.schedule.expiresAt)]) {
    await assert.rejects(createOrder(sample.user, {
      ...bulk, key: randomUUID(), method: "DEMO", confirmedTotal: bulkQuote.price.total,
      collectionAt: new Date(invalidTime).toISOString(),
    }), /Choose a collection time/);
  }
  const booking = { ...base, method: "DEMO" as const, key: randomUUID(),
    confirmedTotal: (await quote(sample.user, base)).price.total,
    collectionAt: new Date(Date.now() + 3600000).toISOString() };
  await assert.rejects(createOrder(sample.user, {...booking, method: "COUNTER"}), /prepayment/);
  const job = await createOrder(sample.user, booking);
  const read = async () => (await customerOrders(sample.user, job.id)).order!;
  await run(owner, job.id, {action:"settle_demo"});
  await runScheduler(DEMO_SHOP);
  assert.equal((await read()).status, "SCHEDULED");
  await assert.rejects(run(owner,job.id,{action:"print_on_idle",printerId:1}), /current order state/);
  const update = (sql: string) => transaction(tx => tx.rows(sql,[job.id]));
  await update("UPDATE orders SET print_at=now(),collection_at=now()+interval '9 minutes' WHERE id=$1");
  const devices = (await staffSnapshot(owner)).printers;
  for (const p of devices) await changePrinter(owner,p.id,{online:false,error:"Inspection"});
  await runScheduler(DEMO_SHOP);
  assert.equal((await read()).status, "QUEUED");
  await update("UPDATE orders SET queued_at=now()-interval '2 hours' WHERE id=$1");
  for (const p of devices) await changePrinter(owner,p.id,{online:true,error:null});
  await runScheduler(DEMO_SHOP);
  assert.equal((await read()).status, "PRINTING");
  await update("UPDATE orders SET started_at=now()-interval '2 minutes' WHERE id=$1");
  await runScheduler(DEMO_SHOP);
  assert.equal((await read()).status, "FINISHING");
  await update("UPDATE orders SET printed_at=now()-interval '1 minute' WHERE id=$1");
  await runScheduler(DEMO_SHOP);
  assert.equal((await read()).status, "READY");
  await update("UPDATE orders SET ready_at=now()-interval '1 minute' WHERE id=$1");
  await update("UPDATE payments SET paid_at=now()-interval '2 minutes' WHERE order_id=$1");
  await runScheduler(DEMO_SHOP);
  assert.equal((await read()).status,"READY");
  await update("UPDATE orders SET collection_at=now() WHERE id=$1");
  await Promise.all([runScheduler(DEMO_SHOP),runScheduler(DEMO_SHOP)]);
  assert.equal((await read()).status,"COMPLETED");
  const events = await transaction(tx => eventRows(tx,DEMO_SHOP,0,job.id));
  for (const type of ["COLLECTION_REMINDER","WAIT_ALERT","ORDER_QUEUED","AUTO_COLLECTED","ORDER_COMPLETED"])
    assert.equal(events.filter(e => e.type === type).length, 1, type);
});

test("scheduled delivery sends one rider alert at collection time and requires the customer's code", async () => {
  const sample = await document(DEMO_SHOP,true);
  const base = {documentId:sample.doc.id,mode:"NORMAL" as const,options:sample.options};
  const order = await createOrder(sample.user,{...base, key:randomUUID(), method:"DEMO",
    collectionAt:new Date(Date.now()+3600000).toISOString(),deliveryAddress:"Apartment 10, Chennai",
    confirmedTotal:(await quote(sample.user,base)).price.total});
  await demoPayment(sample.user,order.id);
  const update = (sql:string) => transaction(tx=>tx.rows(sql,[order.id]));
  await update("UPDATE orders SET print_at=now(),collection_at=now()+interval '5 minutes' WHERE id=$1");
  await runScheduler(DEMO_SHOP);
  await update("UPDATE orders SET started_at=now()-interval '1 minute' WHERE id=$1");
  await runScheduler(DEMO_SHOP);
  await run(owner,order.id,{action:"ready"});
  const history = () => transaction(tx=>eventRows(tx,DEMO_SHOP,0,order.id));
  assert.equal((await history()).some(e=>e.type==="COURIER_ARRIVED"),false);
  await assert.rejects(run(owner,order.id,{action:"pickup",pin:order.pickupPin!}),/booked collection time/);
  await update("UPDATE orders SET ready_at=now()-interval '2 hours',collection_at=now()-interval '1 hour' WHERE id=$1");
  await runScheduler(DEMO_SHOP);
  await runScheduler(DEMO_SHOP);
  const events=await history();
  for (const type of ["COURIER_WAIT","COURIER_ARRIVED"]) assert.equal(events.filter(e=>e.type===type).length,1);
  assert.equal(events.some(e=>e.type==="CUSTOMER_ARRIVED" || e.type==="AUTO_COLLECTED"),false);
  assert.equal((await customerOrders(sample.user,order.id)).order!.status,"READY");
  await run(owner,order.id,{action:"pickup",pin:order.pickupPin!});
  assert.ok((await history()).some(e=>e.type==="COURIER_COLLECTED"));
});

test("safe upload checks PDF page count, rejects invalid content, and stores encrypted bytes", async () => {
  const sample = await document();
  assert.equal(sample.doc.pages, 4);
  assert.equal((await inspectDocument(samplePdf(20), "report.PDF")).pages, 20);
  await assert.rejects(inspectDocument(Buffer.from("bad"), "fake.pdf"), /valid PDF/);
  await assert.rejects(inspectDocument(Buffer.from("%PDF-1.7 /JavaScript"), "script.pdf"), /static PDF/);
  const withAttachment = await PDFDocument.create();
  withAttachment.addPage();
  await withAttachment.attach(new Uint8Array([1, 2, 3]), "supplement.bin");
  await assert.rejects(inspectDocument(Buffer.from(await withAttachment.save()), "attachment.pdf"), /static PDF/);
  const encrypted = await readFile(path.join(directory, "documents", sample.doc.id + ".enc"));
  assert.equal(encrypted.includes(Buffer.from("%PDF-")), false);
  await assert.rejects(quote(sample.user, { documentId: sample.doc.id, options: { ...sample.options, pages: "1-99" }, mode: "NORMAL" }), /between 1 and 4/);
});

test("a demo job traverses payment, assignments, printing, pickup and deletion with safe replay data", async () => {
  const sample = await document(DEMO_SHOP, true);
  const other = await document();
  const { order, input } = await submit(sample, "EXPRESS");
  assert.equal(order.status, "AWAITING_PAYMENT");
  const duplicates = await Promise.all([createOrder(sample.user, input), createOrder(sample.user, input)]);
  assert.ok(duplicates.every(value => value.id === order.id));
  await assert.rejects(createOrder(sample.user, { ...input, key: randomUUID() }), /already attached/);
  await assert.rejects(customerOrders(other.user, order.token), /unavailable/);
  await assert.rejects(workflowProjection(other.user, order.id), /unavailable/);
  assert.deepEqual((await workflowProjection(sample.user, order.id)).catalog.map(value => value.id), [order.id]);
  await assert.rejects(run(realOwner, order.id, { action: "start" }), /not found/);
  await assert.rejects(run(owner, order.id, { action: "start" }), /current order state/);
  const reference = (await customerOrders(sample.user, order.id)).order!.paymentReference!;
  assert.equal((await qrPayment(DEMO_SHOP, reference, false)).paid, false);
  await Promise.all([qrPayment(DEMO_SHOP, reference, true), qrPayment(DEMO_SHOP, reference, true)]);
  await demoPayment(sample.user, order.id);
  const [queued] = (await staffSnapshot(owner)).orders.filter(item => item.id === order.id);
  assert.equal(queued.status, "QUEUED");
  assert.equal(queued.payment, "PAID");
  assert.equal(queued.queuePosition, 1);
  assert.equal(queued.pickupPin, undefined);
  assert.equal((await staffSnapshot(worker)).orders.find(item => item.id === order.id)?.fileName, undefined);
  await run(owner, order.id, { action: "assign", printerId: 1 });
  const sameCommand = randomUUID();
  await Promise.all([run(owner, order.id, { action: "start" }, sameCommand), run(owner, order.id, { action: "start" }, sameCommand)]);
  await assert.rejects(run(owner, order.id, { action: "printed" }), /automatically/);
  await assert.rejects(run(owner, order.id, { action: "ready" }), /current order state/);
  await transaction(tx => tx.rows("UPDATE orders SET started_at=now()-interval '1 minute' WHERE id=$1", [order.id]));
  await runScheduler(DEMO_SHOP);
  await run(owner, order.id, { action: "ready" });
  const ready = (await customerOrders(sample.user, order.token)).order!;
  assert.equal(ready.status, "READY");
  assert.equal(ready.avatarId, order.avatarId);
  const badPin = ready.pickupPin === "123456" ? "654321" : "123456";
  await assert.rejects(run(owner, order.id, { action: "pickup", pin: badPin }), /does not match/);
  await run(worker, order.id, { action: "pickup", pin: ready.pickupPin! });
  await runScheduler(DEMO_SHOP);
  const history = await customerOrders(sample.user, order.token);
  assert.equal(history.order?.status, "COMPLETED");
  assert.equal(history.order?.privacy, "PURGED");
  assert.equal(history.order?.pickupPin, undefined);
  assert.equal(history.events?.find(event => event.type === "PRINT_COMPLETED")?.payload.simulated, true);
  await assert.rejects(stat(path.join(directory, "documents", sample.doc.id + ".enc")), { code: "ENOENT" });
  const events = await transaction(tx => eventRows(tx, DEMO_SHOP, 0, order.id));
  assert.equal(events.filter(e => e.type === "PRINT_STARTED").length, 1);
  assert.equal(events.filter(e => e.type === "PAYMENT_CONFIRMED").length, 1);
  assert.equal(events.filter(e => e.type === "DOCUMENT_PURGED").length, 1);
  assert.deepEqual(events.map(e => e.sequence), events.map(e => e.sequence).sort((a, b) => a - b));
  assert.ok(events.every(event => event.version === 1 && event.correlationId));
  assert.doesNotMatch(JSON.stringify(events), /restricted-filename|pickup_pin|customer_id|document_id/);
});

test("automatic dispatch reserves compatible devices and printer failure cannot become a successful print", async () => {
  const a = await document(); const b = await document();
  const normal = await submit(a, "NORMAL", "COUNTER");
  const express = await submit({ ...b, options: { ...b.options, color: "COLOR", duplex: true } }, "EXPRESS", "COUNTER");
  await assert.rejects(run(owner, express.order.id, { action: "assign", printerId: 1 }), /supports these settings/);
  await assert.rejects(updateSettings(worker, { ...defaultSettings, automatic: true }), /Only an owner/);
  await updateSettings(owner, { ...defaultSettings, automatic: true });
  await runScheduler(DEMO_SHOP);
  const snapshot = await staffSnapshot(owner);
  assert.equal(snapshot.orders.find(order => order.id === normal.order.id)?.printerId, 1);
  assert.equal(snapshot.orders.find(order => order.id === express.order.id)?.printerId, 2);
  await run(owner, express.order.id, { action: "start" });
  await changePrinter(owner, 2, { online: false, error: "Paper jam" });
  await runScheduler(DEMO_SHOP);
  const failed = (await customerOrders(b.user, express.order.token)).order!;
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.reason, "Paper jam");
  assert.equal(failed.progress, 0);
  assert.equal((await staffSnapshot(owner)).printers.find(p => p.id === 2)?.jobId, null);
  await assert.rejects(run(owner, failed.id, { action: "ready" }), /current order state/);
  await run(owner, failed.id, { action: "retry" });
  await runScheduler(DEMO_SHOP);
  assert.equal((await customerOrders(b.user, failed.token)).order?.status, "QUEUED");
  await changePrinter(owner, 2, { online: true, error: null });
  await runScheduler(DEMO_SHOP);
  assert.equal((await customerOrders(b.user, failed.token)).order?.status, "ASSIGNED");
  await updateSettings(owner, defaultSettings);
});

test("new orders require an authoritative quote and an eligible service", async () => {
  const sample = await document();
  const result = await quote(sample.user, { documentId: sample.doc.id, options: sample.options, mode: "NORMAL" });
  await assert.rejects(createOrder(sample.user, { documentId: sample.doc.id, options: sample.options, mode: "NORMAL", method: "COUNTER",
    confirmedTotal: result.price.total - 1, key: randomUUID() }), /price changed/);
  await updateSettings(owner, { ...defaultSettings, expressLimit: 1 });
  await assert.rejects(quote(sample.user, { documentId: sample.doc.id, options: sample.options, mode: "EXPRESS" }), /at capacity/);
  await updateSettings(owner, defaultSettings);
});

test("worker-assisted printing requires explicit confirmation and payment at pickup", async () => {
  const sample = await document(REAL_SHOP);
  const { order } = await submit(sample, "NORMAL", "COUNTER");
  assert.equal((await shopInfo(REAL_SHOP)).demo, false);
  await assert.rejects(demoPayment(sample.user, order.id), /unavailable/);
  await run(realOwner, order.id, { action: "assign", printerId: 1 });
  await run(realOwner, order.id, { action: "start" });
  await transaction(tx => tx.rows("UPDATE orders SET started_at=now()-interval '1 minute' WHERE id=$1", [order.id]));
  await runScheduler(REAL_SHOP);
  assert.equal((await customerOrders(sample.user, order.token)).order?.status, "PRINTING");
  await run(realOwner, order.id, { action: "printed" });
  await run(realOwner, order.id, { action: "ready" });
  await assert.rejects(run(realOwner, order.id, { action: "pickup", pin: order.pickupPin! }), /outstanding payment/);
  await run(realOwner, order.id, { action: "collect_cash" });
  await run(realOwner, order.id, { action: "pickup", pin: order.pickupPin! });
  assert.equal((await customerOrders(sample.user, order.token)).order?.status, "COMPLETED");
  assert.equal((await staffSnapshot(owner)).orders.some(row => row.id === order.id), false);
});

test("only a verified and amount-matched gateway capture queues a real online order", async () => {
  const sample = await document(REAL_SHOP);
  const { order } = await submit(sample, "NORMAL", "UPI");
  const gatewayOrder = "order_unit_example";
  await transaction(tx => tx.rows("UPDATE payments SET provider_order=$2 WHERE order_id=$1", [order.id, gatewayOrder]));
  const callback = (amount: number, status: string) => JSON.stringify({ event: "payment.captured", payload: { payment: {
    entity: { id: "pay_unit_example", order_id: gatewayOrder, amount, currency: "INR", status },
  } } });
  const sign = (raw: string) => createHmac("sha256", "test-webhook").update(raw).digest("hex");
  const body = callback(order.price.total, "captured");
  assert.equal(validGatewaySignature(body, sign(body), "test-webhook"), true);
  await assert.rejects(webhook(REAL_SHOP, body, "invalid"), /Invalid payment signature/);
  const wrongAmount = callback(order.price.total + 1, "captured");
  await webhook(REAL_SHOP, wrongAmount, sign(wrongAmount));
  const authorized = callback(order.price.total, "authorized");
  await webhook(REAL_SHOP, authorized, sign(authorized));
  assert.equal((await customerOrders(sample.user, order.token)).order?.payment, "PENDING");
  await webhook(REAL_SHOP, body, sign(body));
  await webhook(REAL_SHOP, body, sign(body));
  const result = await customerOrders(sample.user, order.token);
  assert.equal(result.order?.payment, "PAID");
  assert.equal(result.order?.status, "QUEUED");
  assert.equal(result.events?.filter(e => e.type === "PAYMENT_CONFIRMED").length, 1);
  await customerCancel(sample.user, order.id);
  assert.equal((await customerOrders(sample.user, order.token)).order?.payment, "REFUND_PENDING");
});

test("expiry removes an unpaid document and cancels its pending order", async () => {
  const sample = await document();
  const { order } = await submit(sample);
  await transaction(tx => tx.rows("UPDATE documents SET expires_at=now()-interval '1 second' WHERE id=$1", [sample.doc.id]));
  await runScheduler(DEMO_SHOP);
  const result = await customerOrders(sample.user, order.token);
  assert.equal(result.order?.status, "CANCELLED");
  assert.equal(result.order?.payment, "VOID");
  assert.equal(result.order?.privacy, "PURGED");
  assert.ok(result.events?.some(event => event.type === "DOCUMENT_PURGED"));
  await assert.rejects(stat(path.join(directory, "documents", sample.doc.id + ".enc")), { code: "ENOENT" });
});
