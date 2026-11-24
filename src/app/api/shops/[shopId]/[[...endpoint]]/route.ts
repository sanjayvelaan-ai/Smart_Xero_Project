import { z } from "zod";
import { DomainError, settingsSchema } from "@/domain";
import { brandName } from "@/lib/brand";
import { startWorker } from "@/server/background";
import { transaction } from "@/server/db";
import { readDocument, samplePdf, uploadBytes } from "@/server/documents";
import { checkout, reconcile, webhook } from "@/server/gateway";
import { identity, limit, seed, shopRow, signIn, signInPrototype, signOut } from "@/server/identity";
import { changePrinter, command, createInput, createOrder, customerCancel, customerOrders, demoPayment,
  qrPayment,confirmDelivery,printerCommand, quote, quoteInput, shopInfo, staffCommand, staffSnapshot, updateSettings, upload, workflowProjection } from "@/server/operations";
import { actor, documentRow, emit, eventRows, orderRows } from "@/server/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ shopId: string; endpoint?: string[] }> };
const headers = { "Cache-Control": "private, no-store" };
const reply = (data: unknown, status = 200, cookie?: string) =>
  Response.json(data, { status, headers: { ...headers, ...(cookie ? { "Set-Cookie": cookie } : {}) } });
const ok = () => reply({ ok: true });
const identifier = z.uuid();
const cursorSchema = z.coerce.number().int().min(0).max(2_147_483_647);

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  // Next.js can normalize its internal request URL to localhost on a loopback binding.
  const host = request.headers.get("host") ?? url.host;
  const expected = process.env.PRINTFLOW_PUBLIC_ORIGIN || `${url.protocol}//${host}`;
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== expected))
    throw new DomainError("This request must come from the " + brandName + " site.", 403);
}

async function textBody(request: Request, max = 65536) {
  if (Number(request.headers.get("content-length")) > max)
    throw new DomainError("Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError("Request body is required.");
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new DomainError("Request is too large.", 413);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}

async function json(request: Request, max = 8192) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new DomainError("Send a JSON request.", 415);
  try { return JSON.parse(await textBody(request, max)) as unknown; }
  catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("Malformed JSON request.");
  }
}

function eventStream(request: Request, shopId: string, start: number | null, staff: boolean) {
  const utf8 = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let close: () => void;
  let closed = false;
  let previous = start;
  let round = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        request.signal.removeEventListener("abort", close);
        try { controller.close(); } catch { /* Consumer already disconnected. */ }
      };
      request.signal.addEventListener("abort", close);
      controller.enqueue(utf8.encode("retry: 1500\n\n"));
      const check = async () => {
        try {
          if (request.signal.aborted || (staff && round % 15 === 0 && !await identity(request, shopId, true))) {
            close();
            return;
          }
          const sequence = await transaction(async tx => (await shopRow(tx, shopId)).sequence);
          if (closed) return;
          if (sequence !== previous) {
            controller.enqueue(utf8.encode(`id: ${sequence}\nevent: change\ndata: {"sequence":${sequence}}\n\n`));
            previous = sequence;
          } else if (round % 12 === 0) controller.enqueue(utf8.encode(": heartbeat\n\n"));
          round++;
          timer = setTimeout(check, 900);
        } catch { close(); }
      };
      void check();
    },
    cancel() { close?.(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store, no-transform",
    "X-Accel-Buffering": "no",
  } });
}

async function route(request: Request, context: Context) {
  try {
    const { shopId, endpoint = [] } = await context.params;
    if (!/^[a-z0-9-]{2,40}$/.test(shopId)) throw new DomainError("Shop not found.", 404);
    const path = endpoint.join("/");
    const method = request.method;
    const url = new URL(request.url);
    await seed();
    startWorker();
    const ip = process.env.PRINTFLOW_TRUST_PROXY === "true"
      ? request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "unknown"
      : "local";
    if (method !== "GET" && path !== "webhook") sameOrigin(request);
    const guest = async () => {
      const session = await identity(request, shopId);
      if (!session) throw new DomainError("Upload a document or return to the browser used to place this order.", 401);
      return session;
    };
    const staff = async () => {
      const session = await identity(request, shopId, true);
      if (!session) throw new DomainError("Sign in to the shop dashboard.", 401);
      return session;
    };
    if (path.startsWith("pay/") && ["GET", "POST"].includes(method)) {
      const session = await identity(request, shopId);
      return reply(await qrPayment(shopId, identifier.parse(path.slice(4)), method === "POST", session?.id));
    }
    const orderPath = /^orders\/([^/]+)(?:\/([^/]+))?$/.exec(path);
    const staffOrder = /^staff\/orders\/([^/]+)\/(command|document|preview|reconcile)$/.exec(path);
    const staffPrinter = /^staff\/printers\/(\d+)$/.exec(path);

    if (method === "GET" && path === "") return reply(await shopInfo(shopId));
    if (method === "GET" && path === "sample") {
      const shop = await transaction(tx => shopRow(tx, shopId));
      if (!shop.demo) throw new DomainError("Sample documents are available in Demo Mode.", 404);
      const pages = url.searchParams.get("pages") === "20" ? 20 : 4;
      return new Response(Uint8Array.from(samplePdf(pages)), { headers: { ...headers, "Content-Type": "application/pdf" } });
    }
    if (method === "GET" && (path === "live" || path === "staff/live")) {
      const isStaff = path.startsWith("staff");
      if (isStaff) await staff();
      else await transaction(tx => shopRow(tx, shopId));
      const cursor = request.headers.get("last-event-id") ?? (isStaff ? url.searchParams.get("after") : null);
      return eventStream(request, shopId, cursor === null ? null : cursorSchema.parse(cursor), isStaff);
    }
    if (method === "POST" && path === "prototype-sign-in") {
      await limit("prototype-login:" + shopId + ":" + ip, 20, 60);
      const result = await signInPrototype(shopId, request.headers.get("host"));
      return reply({ ok: true }, 200, result.cookie);
    }
    if (method === "POST" && path === "sign-in") {
      const input = z.object({ username: z.string().trim().min(1).max(40), password: z.string().max(150) }).parse(await json(request));
      await limit(`login:${shopId}:${ip}:${input.username.toLowerCase()}`, 8, 300);
      const result = await signIn(shopId, input.username, input.password);
      return reply({ ok: true }, 200, result.cookie);
    }
    if (method === "POST" && path === "sign-out") return reply({ ok: true }, 200, await signOut(await staff()));
    if (method === "POST" && path === "documents") {
      const session = await identity(request, shopId);
      await limit(`upload:${shopId}:${session?.id ?? ip}`, 18, 300);
      let filename: string;
      try { filename = decodeURIComponent(request.headers.get("x-file-name") ?? "Document"); }
      catch { throw new DomainError("The document filename is invalid."); }
      const result = await upload(shopId, session, await uploadBytes(request), filename);
      return reply(result.document, 201, result.cookie);
    }
    if (method === "POST" && path === "quote") return reply(await quote(await guest(), quoteInput.parse(await json(request))));
    if (method === "POST" && path === "orders") {
      const session = await guest();
      await limit("orders:" + session.id, 20, 60);
      return reply(await createOrder(session, createInput.parse(await json(request))), 201);
    }
    if (method === "GET" && path === "orders") {
      const session = await identity(request, shopId);
      return reply(session ? await customerOrders(session) : { shop: await shopInfo(shopId), orders: [] });
    }
    if (method === "GET" && orderPath && !orderPath[2]) {
      const id = z.union([identifier, z.string().regex(/^PF-\d{4,10}$/i)]).parse(orderPath[1]);
      return reply(await customerOrders(await guest(), id));
    }
    if(method==="GET"&&orderPath?.[2]==="replay"){
      const id=identifier.parse(orderPath[1]), session=await guest();
      const snapshot=await workflowProjection(session,id);
      const events=await transaction(async tx=>{
        let after=0;
        const result=[];
        for(;;){
          const batch=await eventRows(tx,shopId,after,id);
          result.push(...batch.filter(e=>e.sequence<=snapshot.sequence).map(e=>({...e,actorId:"",correlationId:""})));
          if(batch.length<200 || batch[batch.length-1].sequence>=snapshot.sequence)break;
          after=batch[batch.length-1].sequence;
        }
        return result;
      });
      return reply({snapshot,events});
    }
    if (method === "POST" && orderPath?.[2]) {
      const session = await guest();
      const id = identifier.parse(orderPath[1]);
      await limit("customer-action:" + session.id, 35, 60);
      switch (orderPath[2]) {
        case "received": await confirmDelivery(session,id); return ok();
        case "demo-payment": await demoPayment(session, id); return ok();
        case "cancel": await customerCancel(session, id); return ok();
        case "checkout": return reply(await checkout(session, id));
        case "reconcile": await reconcile(session, id); return ok();
      }
    }
    if (method === "POST" && path === "webhook") {
      await webhook(shopId, await textBody(request, 256 * 1024), request.headers.get("x-razorpay-signature") ?? "");
      return ok();
    }
    if (method === "GET" && path === "staff") return reply(await staffSnapshot(await staff()));
    if (method === "GET" && path === "staff/projection") return reply(await workflowProjection(await staff()));
    if (method === "GET" && path === "staff/events") {
      const session = await staff();
      const after = cursorSchema.parse(url.searchParams.get("after") ?? 0);
      return reply(await transaction(tx => eventRows(tx, session.shopId, after)));
    }
    if (method === "POST" && path === "staff/settings") {
      await updateSettings(await staff(), settingsSchema.parse(await json(request)));
      return ok();
    }
    if (method === "POST" && staffPrinter) {
      await changePrinter(await staff(), Number(staffPrinter[1]), printerCommand.parse(await json(request)));
      return ok();
    }
    if (staffOrder) {
      const session = await staff();
      const id = identifier.parse(staffOrder[1]);
      if (method === "POST" && staffOrder[2] === "command") {
        const input = z.object({ key: z.uuid(), command: staffCommand }).parse(await json(request));
        await command(session, id, input.key, input.command);
        return ok();
      }
      if (method === "POST" && staffOrder[2] === "reconcile") { await reconcile(session, id); return ok(); }
      if (method === "GET" && ["document","preview"].includes(staffOrder[2])) {
        return await transaction(async tx => {
          const shop = await shopRow(tx, shopId, true);
          const [order] = await orderRows(tx, shopId, "AND o.id=$2", [id]);
          const preview = staffOrder[2] === "preview";
          const allowedStatuses = preview
            ? ["QUEUED", "ASSIGNED", "PRINTING", "HELD", "READY", "FINISHING"]
            : ["ASSIGNED", "PRINTING", "HELD"];
          const privateAccess = !preview && session.staff?.role === "OWNER";
          if (!order || !allowedStatuses.includes(order.status) ||
              (order.options.confidential && !privateAccess) || (!preview && shop.demo))
            throw new DomainError("Document access is restricted to authorized staff during printing.", 403);
          const doc = await documentRow(tx, shopId, order.document_id);
          if (!doc || doc.privacy !== "AVAILABLE" || doc.expires_at.getTime() <= Date.now())
            throw new DomainError("This temporary document has expired.", 410);
          const content = await readDocument(doc, !shop.demo);
          await emit(tx, actor(session), "DOCUMENT_ACCESSED", order.id, { token: order.token, mode: order.mode });
          return new Response(Uint8Array.from(content), {
            headers: { ...headers, "Content-Type": preview?doc.media_type:"application/octet-stream", "X-Content-Type-Options": "nosniff",
              "Content-Disposition": (preview?"inline":"attachment")+"; filename*=UTF-8''" + encodeURIComponent(doc.file_name) },
          });
        });
      }
    }
    throw new DomainError("This endpoint does not exist.", 404);
  } catch (error) {
    if (error instanceof DomainError) return reply({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return reply({ error: "Some fields are invalid. Check your selections and try again." }, 400);
    console.error("PrintFlow API error:", error instanceof Error ? error.name + ": " + error.message : "Unknown error");
    return reply({ error: brandName + " could not complete the request. Please try again." }, 500);
  }
}

export { route as GET, route as POST };
