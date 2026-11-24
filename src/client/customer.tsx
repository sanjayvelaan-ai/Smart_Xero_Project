"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Glass } from "@/components/glass/glass";
import { brandName, brandTagline, brandVision } from "@/lib/brand";
import { ReceiptPrinter } from "@/components/ui/receipt-printer";
import { CollectionCalendar, collectionWindow } from "@/components/ui/calendar-with-time-presets";
import { useRouter } from "next/navigation";
import { BadgeCheck, Bell, Check, ChevronLeft, ChevronRight, Clock3, CloudUpload, CreditCard, FileCheck2,
  FileText, LayoutDashboard, ListOrdered, LockKeyhole, MapPin, Printer, ReceiptText, Search, ShieldCheck,
  SlidersHorizontal, TicketCheck, X, Zap } from "lucide-react";
import { compatible, defaultOptions, eventLabel, paymentLabel, rupees, statusLabel,
  type FilePrintOptions, type Method, type Mode, type Order, type Price, type PrintOptions, type Shop, type ShopEvent } from "@/domain";
import { api, apiPath, commandId, customerPath, dateLabel, demoShop, Empty, ErrorBox, Loading, Logo, message, ModeBadge,
  notify, orderPath, ownerPath, StatusBadge, timeLabel, toggleNotifications, useFeed } from "./shared";
import { PdfPreview } from "./pdf-preview";
import {BatchPicker} from "./batch-picker";
import { BatchSummary } from "./batch-summary";
import {PaymentQR,Journey} from "./order-experience";
import type {PrintFile} from "./preflight";
import { twinPath, WorkspaceSwitch } from "./shared";

type Upload = { id: string; name: string; size: number; pages: number };
type Quote = { price: Price; schedule: { leadSeconds: number; expiresAt: string }; expressAvailable: boolean; etaMinutes: number | null; normalEta: number | null; expressEta: number | null };
type CustomerFeed = { shop: Shop; orders: Order[] };
type TrackingFeed = { shop: Shop; order: Order; events: ShopEvent[] };
type Draft = { scheduled?: boolean; collectionTime?: string; deliveryAddress?: string; courier?:boolean; upload: Upload | null; options: PrintOptions; mode: Mode; method: Method | null; step: number; key: string };
type PrintNotice = { text: string; level: "success" | "warning" | "error" };
const newDraft = (): Draft => ({ upload: null, options: defaultOptions, mode: "NORMAL", method: null, step: 0, key: commandId() });
const steps = ["Upload", "Configure", "Service", "Checkout", "Tracking"];

function CustomerNav({ shopId }: { shopId: string }) {
  return <header className="customer-nav"><div className="nav-inner">
    <Logo href={customerPath(shopId)} />
    <WorkspaceSwitch shop={shopId} active="customer" />
    <span className="pill nav-mode">Customer portal</span>
  </div></header>;
}

function CustomerFooter({ shopId }: { shopId: string }) {
  return <footer className="customer-footer"><div className="footer-brand"><span><Printer size={16} aria-hidden="true" /> <strong>{brandName}</strong></span>
    <p>{brandVision}</p></div>
    <span><LockKeyhole size={14} /> Temporary, encrypted document storage</span>
    </footer>;
}

export function CustomerPage({ shopId }: { shopId: string }) {
  const { data, error, refresh } = useFeed<CustomerFeed>(shopId, "orders");
  return <div className="customer-shell">
    <CustomerNav shopId={shopId} />
    <main className="customer-wrap">
      {data ? <>
        <CustomerHero shop={data.shop} />
        <OrderForm key={shopId} shop={data.shop} refresh={refresh} />
        <MyOrders shopId={shopId} orders={data.orders} />
      </> : error ? <div className="panel single-page"><h1>Shop unavailable</h1><ErrorBox>{error}</ErrorBox>
        <button className="button outline" onClick={() => void refresh()}>Try again</button></div> : <Loading label="Connecting to the print shop…" />}
    </main>
    <CustomerFooter shopId={shopId} />
  </div>;
}

function CustomerHero({ shop }: { shop: Shop }) {
  return <section className="customer-hero" aria-labelledby="hero-title">
    <div className="hero-copy">
      <p className="shop-caption"><span className="hero-check"><BadgeCheck size={17} /></span> {shop.settings.name}</p>
      <h1 id="hero-title">{brandTagline}</h1>
      <p className="hero-description"><MapPin size={16} />{shop.settings.address}</p>
      <div className="hero-actions"><a className="button white" href="#new-order"><CloudUpload size={19} /> Upload a document</a>
        <a className="button hero-outline" href="#my-orders"><Search size={17} /> Track an order</a></div>
    </div>
    <Link className="studio-preview" href={twinPath(shop.id)}><span>Explore the 3D shop <ChevronRight size={15} /></span></Link>
    <aside className="shop-strip" aria-label="Current shop status">
      <span className={"pill " + (shop.settings.open ? "green" : "red")}><span className="dot" /> {shop.settings.open ? "Open for orders" : "Shop closed"}</span>
      <div className="shop-stats">
        <div><span><ListOrdered size={16} /> Active orders</span><strong>{shop.active}</strong></div>
        <div><span><Clock3 size={16} /> Est. Normal wait</span><strong>{shop.wait === null ? "—" : "~" + shop.wait + " min"}</strong></div>
      </div>
    </aside>
  </section>;
}

function OrderForm({ shop, refresh }: { shop: Shop; refresh: () => Promise<unknown> }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [priceError, setPriceError] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewBusy,setReviewBusy]=useState(false);
  const [notice, setNotice] = useState<PrintNotice | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ url: string; image: boolean } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const router = useRouter();
  const uploading = useRef(false);
  const storage = "printflow-draft:" + shop.id;
  const choosingTime = draft?.scheduled && draft.step === 3;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!choosingTime) return;
    const timer = window.setInterval(() => tick(n => n + 1), 15_000);
    return () => window.clearInterval(timer);
  }, [choosingTime]);
  useEffect(() => {
    let restored: Draft | null = null;
    try {
      const raw = sessionStorage.getItem(storage);
      if (raw) restored = JSON.parse(raw) as Draft;
    } catch { /* A blocked or unavailable draft leaves a fresh order. */ }
    setDraft(restored ?? newDraft());
  }, [storage]);
  useEffect(() => {
    if (!draft) return;
    try { sessionStorage.setItem(storage, JSON.stringify(draft)); } catch { /* Draft persistence is optional. */ }
  }, [draft, storage]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => {
    if (notice?.level !== "success") return;
    const timer = window.setTimeout(() => setNotice(null), 6500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const doc = draft?.upload;
  const options = draft?.options;
  const mode = draft?.mode;
  const rateSignature = JSON.stringify(shop.settings) + JSON.stringify(shop.capabilities) + shop.expressAvailable + shop.active;
  useEffect(() => {
    setQuote(null);
    setPriceError("");
    if (!doc || !options || !mode) return;
    const control = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const result = await api<Quote>(shop.id, "quote", { documentId: doc.id, options, mode }, control.signal);
        if (!control.signal.aborted) setQuote(result);
      } catch (failure) {
        if (!control.signal.aborted) {
          const text = message(failure);
          setPriceError(text);
          if (options.batch) setNotice({ text, level: "error" });
        }
      }
    }, 230);
    return () => { control.abort(); window.clearTimeout(timer); };
  }, [doc, options, mode, shop.id, rateSignature]);

  if (!draft) return <Loading label="Preparing your order…" />;
  const availableMethods: Method[] = [...(shop.demo ? ["DEMO" as const] : []), ...(shop.upi ? ["UPI" as const] : []),
    ...(shop.settings.counter ? ["COUNTER" as const] : [])];
  const collectionTime = draft.collectionTime ? new Date(draft.collectionTime + ":00+05:30") : undefined;
  const bounds = quote && collectionWindow(Date.now(), quote.schedule.leadSeconds, quote.schedule.expiresAt);
  const validSchedule = !draft.scheduled || (!!bounds && !!draft.collectionTime && draft.collectionTime >= bounds.min && draft.collectionTime <= bounds.max);
  const method = draft.method && availableMethods.includes(draft.method) ? draft.method : availableMethods[0];
  const set = (change: Partial<Draft>) => setDraft(previous => previous ? { ...previous, ...change } : previous);
  const option = <Key extends keyof PrintOptions>(key: Key, value: PrintOptions[Key]) => {
    setQuote(null);
    setNotice(null);
    setDraft(previous => previous ? { ...previous, options: { ...previous.options, [key]: value } } : previous);
    setError("");
  };
  const step = draft.step;
  const changeStep = (next: number) => { set({ step: next }); setError(""); };

  async function sendFile(file: File, items:PrintFile[]=[],useSuggestion=false) {
    if (uploading.current) return;
    setError("");
    setNotice(null);
    if (file.size > 20 * 1024 * 1024 || !/\.(pdf|png|jpe?g)$/i.test(file.name)) {
      const text = "The prepared upload exceeds 20 MB or has an unsupported file type. Try fewer files.";
      setError(text);
      setNotice({ text, level: "error" });
      return;
    }
    uploading.current = true;
    setPercent(0);
    try {
      const result = await new Promise<Upload>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", apiPath(shop.id, "documents"));
        xhr.responseType = "json";
        xhr.timeout = 90000;
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
        xhr.upload.onprogress = event => { if (event.lengthComputable) setPercent(Math.min(99, Math.round(event.loaded / event.total * 100))); };
        xhr.onload = () => xhr.status === 201 ? resolve(xhr.response) :
          reject(new Error(xhr.response?.error ?? "The document could not be uploaded."));
        xhr.onerror = () => reject(new Error("Upload interrupted. Check your connection and try again."));
        xhr.ontimeout = () => reject(new Error("The upload timed out. Try a smaller file."));
        xhr.send(file);
      });
      const image = /\.(png|jpe?g)$/i.test(file.name);
      const type = image ? (/\.png$/i.test(file.name) ? "image/png" : "image/jpeg") : "application/pdf";
      setPreview({ url: URL.createObjectURL(new Blob([file], { type })), image });
      const { confidential: _privacy, batch: _batch, ...defaults } = defaultOptions;
      const suggest = (item: PrintFile): Partial<FilePrintOptions> => ({
        layout: (item.rotation % 180 !== 0) !== item.landscape ? "LANDSCAPE" : "PORTRAIT",
        color: item.colored && shop.capabilities.some(p => p.color) ? "COLOR" : "BW",
      });
      const batch = items.length > 1 ? items.map(item => ({
        name: item.file.name.trim().slice(0, 160) || "Print document",
        pageCount: item.pages,
        settings: { ...defaults, ...(useSuggestion ? suggest(item) : {}) },
      })) : undefined;
      setDraft(prev => prev ? { ...prev, upload: result, key: commandId(), step: 0, options: {
        ...(prev.options.batch || batch ? defaults : prev.options),
        ...(useSuggestion && !batch && items[0] ? suggest(items[0]) : {}),
        confidential: prev.options.confidential || items.some(item => item.sensitive || item.textUnchecked),
        batch,
      } } : prev);
      if (items.length) setNotice({ level: "success", text: batch
        ? `${batch.length} files uploaded. Continue to settings to configure each file.`
        : "File uploaded. Continue to settings to choose how to print it." });
    } catch (failure) {
      const text = message(failure);
      setError(text);
      setNotice({ text, level: "error" });
    }
    finally {
      uploading.current = false;
      setPercent(null);

    }
  }

  async function useSample() {
    setError("");
    try {
      const response = await fetch(apiPath(shop.id, "sample"));
      if (!response.ok) throw new Error("The sample document is unavailable.");
      await sendFile(new File([await response.blob()], "Practice assignment.pdf", { type: "application/pdf" }));
    } catch (failure) { setError(message(failure)); }
  }

  async function placeOrder() {
    if (!draft?.upload || !quote || !method || busy) return;
    setBusy(true);
    setError("");
    try {
      const order = await api<Order>(shop.id, "orders", { documentId: draft.upload.id, options: draft.options, mode: draft.mode,
        key: draft.key, collectionAt: draft.scheduled ? collectionTime?.toISOString() : undefined, deliveryAddress:draft.courier?draft.deliveryAddress?.trim():undefined, method, confirmedTotal: quote.price.total });
      try { sessionStorage.removeItem(storage); } catch { /* Storage may be unavailable. */ }
      router.replace(orderPath(shop.id, order.token));
    } catch (failure) {
      setError(message(failure));
      setNotice({ text: message(failure), level: "error" });
      void refresh();
      try {
        const next = await api<Quote>(shop.id, "quote", { documentId: draft.upload.id, options: draft.options, mode: draft.mode });
        setQuote(next);
      } catch { /* Keep the original order error and allow a different service selection. */ }
      setBusy(false);
    }
  }

  return <section className="order-section" id="new-order" aria-labelledby="new-order-title">
    {notice && <div className={"toast print-notice " + notice.level} role={notice.level === "success" ? "status" : "alert"}>
      <Bell size={17} aria-hidden /><span>{notice.text}</span>
      <button className="icon-button" aria-label="Dismiss print notice" onClick={() => setNotice(null)}><X size={17} /></button>
    </div>}
    <div className="section-title"><div><h2 id="new-order-title">Place a print order</h2>
      <p>Set up your print job and get an instant quote.</p></div></div>
    {!shop.settings.open && <ErrorBox>The shop is closed for new orders. Existing orders can still be tracked.</ErrorBox>}
    <div className="customer-grid">
      <div className="panel wizard glass-host"><Glass />
        <ol className="stepper" aria-label="Order progress">
          {steps.map((label, index) => <li key={label} className={index === step ? "current" : index < step ? "done" : ""}
            aria-current={index === step ? "step" : undefined}>
            <button type="button" disabled={index >= step} onClick={() => changeStep(index)}>
              <span>{index < step ? <Check size={14} /> : index + 1}</span><b>{label}</b>
            </button>
          </li>)}
        </ol>
        <div className="wizard-body">
          {step === 0 && <>
            <div className="wizard-title"><span className="icon-block purple"><CloudUpload size={22} /></span>
              <div><h3>Upload your documents</h3><p>Choose files or a folder of PDFs, JPGs and PNGs. Up to 20 MB combined.</p></div></div>
            {doc ? <div className="file-card"><span className="icon-block green"><FileCheck2 size={23} /></span>
              <div><strong>{doc.name}</strong><p>{doc.pages} {doc.pages === 1 ? "page" : "pages"} · {(doc.size / 1024).toFixed(1)} KB</p></div>
              {preview && <button className="button quiet" onClick={() => setPreviewOpen(open => !open)}>{previewOpen ? "Hide preview" : draft.options.confidential ? "View private preview" : "Preview"}</button>}
              <button className="icon-button" title="Remove document" aria-label="Remove document" onClick={() => { set({ upload: null, step: 0 }); setPreview(null); setPreviewOpen(false); }}><X size={18} /></button>
            </div> : <BatchPicker confidential={draft.options.confidential} disabled={!shop.settings.open||percent!==null}
              onPrepare={sendFile} onBusy={setReviewBusy} onAlert={(text, level) => setNotice({ text, level })} />}
            {!previewOpen && preview && draft.options.confidential&&<div className="private-preview"><strong>Private document</strong><span>Staff previews are concealed</span></div>}
            {previewOpen && preview && <div className="preview">
              {preview.image ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={preview.url} alt="Your uploaded image" />
                : <PdfPreview key={preview.url} url={preview.url} pages={doc?.pages ?? 1} />}
            </div>}
            <label className="check-label"><input type="checkbox" checked={draft.options.confidential} onChange={e=>{option("confidential",e.target.checked);setPreviewOpen(false);}}/> Confidential document · conceal staff previews</label>
            {shop.demo && !doc && percent === null && <div className="sample-note"><FileText size={17} /><span>Try a four-page document.</span>
              <button className="text-button" onClick={() => void useSample()} disabled={!shop.settings.open||reviewBusy}>Use a sample PDF</button></div>}
          </>}
          {step === 1 && <>
            <div className="wizard-title"><span className="icon-block purple"><SlidersHorizontal size={22} /></span>
              <div><h3>{draft.options.batch ? "Configure each file" : "Configure your print"}</h3><p>Choose options supported by the shop’s available printers.</p></div></div>
            {draft.options.batch ? <>
              <p className="muted">Set color, paper, copies, and pages for each file. All files go through one checkout.</p>
              <div className="batch-settings">{draft.options.batch.map((file, index) => (
                <details key={index} className="batch-settings-file" open={index === 0}>
                  <summary><strong>{index + 1}. {file.name}</strong><small>{file.pageCount} {file.pageCount === 1 ? "page" : "pages"} · {file.settings.copies || 0} {file.settings.copies === 1 ? "copy" : "copies"}</small></summary>
                  <div role="group" aria-label={"Settings for " + file.name}>
                    <DocumentSettings shop={shop} settings={file.settings} change={settings => option("batch",
                      draft.options.batch!.map((entry, i) => i === index ? { ...entry, settings } : entry))} />
                  </div>
                </details>
              ))}</div>
            </> : <DocumentSettings shop={shop} settings={draft.options} change={settings => {
              setQuote(null);
              set({ options: { ...settings, confidential: draft.options.confidential } });
            }} />}
            <label className="check-label batch-privacy"><input type="checkbox" checked={draft.options.confidential}
              onChange={e => option("confidential", e.target.checked)} /> Mark as confidential</label>
          </>}
          {step === 2 && <>
            <div className="wizard-title"><span className="icon-block purple"><Zap size={22} /></span>
              <div><h3>Choose a service</h3><p>Pickup estimates reflect the current queue and your print settings.</p></div></div>
            <div className="choice-list" role="group" aria-label="Service priority">
              <Choice name="Normal" description={eta(quote?.normalEta) + " · Standard queue"} selected={draft.mode === "NORMAL"}
                icon={<ListOrdered size={22} />} detail="Standard price" onClick={() => set({ mode: "NORMAL" })} />
              <Choice name="Express" description={quote?.expressAvailable ? eta(quote.expressEta) + " · Priority queue" : "Availability depends on printer capacity"}
                selected={draft.mode === "EXPRESS"} icon={<Zap size={22} />} detail={"+" + rupees(shop.settings.priority)}
                disabled={draft.mode !== "EXPRESS" && !quote?.expressAvailable} onClick={() => set({ mode: "EXPRESS" })} />
            </div>
          </>}
          {step === 3 && <>
            <div className="wizard-title"><span className="icon-block purple"><CreditCard size={22} /></span>
              <div><h3>Checkout</h3><p>Choose how to receive your prints and pay.</p></div></div>
            {(shop.demo || shop.upi) && <fieldset className="fulfillment">
              <legend>Print timing</legend>
              <label className="field"><span>When do you need your prints?</span>
                <select value={draft.scheduled ? "scheduled" : "now"} onChange={e => set({ scheduled: e.target.value === "scheduled", method: shop.demo ? "DEMO" : "UPI" })}>
                  <option value="now">Print as soon as possible</option><option value="scheduled">Schedule collection</option>
                </select>
              </label>
              {draft.scheduled && (bounds
                ? <CollectionCalendar {...bounds} value={draft.collectionTime ?? ""} onChange={collectionTime => set({ collectionTime })} />
                : <p role="status">{priceError || "Checking collection times…"}</p>)}
            </fieldset>}
            {shop.demo && <fieldset className="fulfillment">
              <legend>Receive your prints</legend>
              <div className="fulfillment-options">
                <label className="fulfillment-option">
                  <input type="radio" name="receive" checked={!draft.courier} onChange={() => set({ courier: false })} />
                  <span><strong>Shop pickup</strong><small>Collect at the print counter</small></span>
                </label>
                <label className="fulfillment-option">
                  <input type="radio" name="receive" checked={!!draft.courier} onChange={() => set({ courier: true, method: "DEMO" })} />
                  <span><strong>Blinkit home delivery</strong><small>Simulated courier drop-off</small></span>
                </label>
              </div>
              {draft.courier && <>
                <Field label="Delivery address" wide><textarea rows={2} maxLength={400} value={draft.deliveryAddress ?? ""}
                  onChange={e => set({ deliveryAddress: e.target.value })} placeholder="House number, street, city and PIN code" /></Field>
                <p className="muted">Prepay for your prints and share the collection code with the simulated rider.</p>
              </>}
            </fieldset>}
            <div className="choice-list" role="group" aria-label="Payment method">
              {availableMethods.includes("DEMO") && <Choice name="Simulated payment" description="Get an order-specific QR code. Simulated payments do not move money."
                selected={method === "DEMO"} onClick={() => set({ method: "DEMO" })} icon={<CreditCard size={22} />} />}
              {availableMethods.includes("UPI") && <Choice name="Pay with UPI" description="Continue to Razorpay after placing your order."
                selected={method === "UPI"} onClick={() => set({ method: "UPI" })} icon={<CreditCard size={22} />} />}
              {!draft.courier && !draft.scheduled && availableMethods.includes("COUNTER") && <Choice name="Pay at counter" description={"Pay the shop when you collect your prints."}
                selected={method === "COUNTER"} onClick={() => set({ method: "COUNTER" })} icon={<ReceiptText size={22} />} />}
              {!availableMethods.length && <ErrorBox>The shop has no active payment method.</ErrorBox>}
            </div>
          </>}
          <ErrorBox>{error || (step > 0 ? priceError : "")}</ErrorBox>
        </div>
        <div className="wizard-actions">
          {step > 0 ? <button className="button outline" onClick={() => changeStep(step - 1)} disabled={busy}><ChevronLeft size={17} /> Back</button>
            : <span className="file-security"><LockKeyhole size={15} /> Encrypted upload</span>}
          {step < 3 ? <button className="button primary" onClick={() => changeStep(step + 1)}
            disabled={!shop.settings.open || !doc || percent !== null || (step > 0 && !quote)}>{["Continue to settings", "Continue to service", "Continue to payment"][step]} <ChevronRight size={17} /></button>
            : <button className="button primary" onClick={() => void placeOrder()} disabled={!validSchedule || !shop.settings.open || !quote || !method || busy || (!!draft.courier && (draft.deliveryAddress?.trim().length??0)<10)}>
              {busy ? "Placing order…" : "Place order"} <ChevronRight size={17} /></button>}
        </div>
      </div>
      <aside className="order-aside">
        <div className="panel summary-card glass-host"><Glass />
          <h3><ReceiptText size={20} /> Order summary</h3>
          <div className="summary-content">
            {doc ? <div className="summary-file"><FileText size={18} /><span><strong>{doc.name}</strong>
              <small>{draft.options.batch ? `${draft.options.batch.length} files · ${quote ? quote.price.impressions + " printed pages" : "Individual settings"}`
                : `${draft.options.copies || 1} ${(draft.options.copies || 1) === 1 ? "copy" : "copies"} · ${draft.options.size} · ${draft.options.color === "BW" ? "B&W" : "Color"}`}</small></span></div>
              : <p className="muted">Upload a document to see your estimated total.</p>}
            <dl className="price-lines"><PriceLine label="Printing" amount={quote?.price.base} />
              <PriceLine label="Finishing" amount={quote?.price.finishing} />
              <PriceLine label="Express priority" amount={quote?.price.express} />
              {quote && quote.price.discount > 0 && <PriceLine label="Discount" amount={-quote.price.discount} />}
              {quote && quote.price.tax > 0 && <PriceLine label="Tax" amount={quote.price.tax} />}
            </dl>
            <div className="summary-total"><span>Estimated total</span><strong>{quote ? rupees(quote.price.total) : "—"}</strong></div>
            {quote && <p className="summary-eta"><Clock3 size={16} /> {eta(quote.etaMinutes)}</p>}
          </div>
        </div>
        <div className="rate-card"><span><FileText size={17} /> A4 printing from <strong>{rupees(shop.settings.bw)}/page</strong></span>
          <span><Zap size={17} /> Express priority <strong>+{rupees(shop.settings.priority)}</strong></span></div>
        <div className="privacy-note"><ShieldCheck size={21} />
          <div><strong>Your files stay private</strong><p>Uploads are encrypted and the temporary copy is removed after collection, cancellation, or expiry.</p></div></div>
      </aside>
    </div>
  </section>;
}

function eta(minutes: number | null | undefined) {
  return minutes == null ? "Pickup estimate unavailable" : `About ${minutes} min to pickup`;
}

function DocumentSettings({ shop, settings, change }: {
  shop: Shop; settings: FilePrintOptions; change: (settings: FilePrintOptions) => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const option = <Key extends keyof FilePrintOptions>(key: Key, value: FilePrintOptions[Key]) =>
    change({ ...settings, [key]: value });
  const can = <Key extends keyof FilePrintOptions>(key: Key, value: FilePrintOptions[Key]) =>
    shop.capabilities.some(printer => compatible(printer, { ...settings, [key]: value }));
  return <>
    <div className="form-grid">
      <Field label="Color mode"><select value={settings.color} onChange={e => option("color", e.target.value as FilePrintOptions["color"])}>
        <option value="BW">Black &amp; white</option><option value="COLOR" disabled={!can("color", "COLOR")}>Color</option></select></Field>
      <Field label="Paper size"><select value={settings.size} onChange={e => option("size", e.target.value as FilePrintOptions["size"])}>
        <option value="A4">A4</option><option value="A3" disabled={!can("size", "A3")}>A3</option></select></Field>
      <Field label="Sides"><select value={String(settings.duplex)} onChange={e => option("duplex", e.target.value === "true")}>
        <option value="false">Single-sided</option><option value="true" disabled={!can("duplex", true)}>Double-sided</option></select></Field>
      <Field label="Orientation"><select value={settings.layout} onChange={e => option("layout", e.target.value as FilePrintOptions["layout"])}>
        <option value="PORTRAIT">Portrait</option><option value="LANDSCAPE">Landscape</option></select></Field>
      <Field label="Copies"><input type="number" min={1} max={50} value={settings.copies || ""} onChange={e => option("copies", Number(e.target.value))} /></Field>
      <Field label="Pages"><input value={settings.pages} maxLength={200} placeholder="All pages, or e.g. 1-3, 5" onChange={e => option("pages", e.target.value)} /></Field>
    </div>
    <button className="text-button advanced-toggle" onClick={() => setAdvanced(value => !value)} aria-expanded={advanced}>
      {advanced ? "Hide finishing and paper options" : "Finishing and paper options"} <ChevronRight size={15} /></button>
    {advanced && <div className="form-grid advanced-fields">
      <Field label="Paper quality"><select value={settings.paper} onChange={e => option("paper", e.target.value as FilePrintOptions["paper"])}>
        <option value="STANDARD">Standard paper</option><option value="PREMIUM" disabled={!can("paper", "PREMIUM")}>Premium paper</option></select></Field>
      <Field label="Finishing"><select value={settings.finishing} onChange={e => option("finishing", e.target.value as FilePrintOptions["finishing"])}>
        <option value="NONE">None</option><option value="STAPLE" disabled={!shop.settings.stapleEnabled}>Staple</option>
        <option value="BIND" disabled={!shop.settings.bindEnabled}>Binding</option></select></Field>
      <label className="check-label"><input type="checkbox" checked={settings.collate} onChange={e => option("collate", e.target.checked)} /> Collate copies</label>
      <Field label="Special instructions" wide><textarea rows={2} maxLength={300} value={settings.instructions} onChange={e => option("instructions", e.target.value)} /></Field>
    </div>}
  </>;
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label className={"field" + (wide ? " wide" : "")}><span>{label}</span>{children}</label>;
}

function Choice({ name, description, icon, detail, selected, disabled, onClick }: {
  name: string; description: string; icon: ReactNode; detail?: string; selected: boolean; disabled?: boolean; onClick: () => void;
}) {
  return <button className={"choice " + (selected ? "chosen" : "")} onClick={onClick} aria-pressed={selected} disabled={disabled}>
    <span className="icon-block purple">{icon}</span><span><strong>{name}</strong><small>{description}</small></span>
    {detail && <b className="choice-price">{detail}</b>}<span className="choice-radio">{selected && <Check size={13} />}</span>
  </button>;
}

function PriceLine({ label, amount }: { label: string; amount?: number }) {
  return <div><dt>{label}</dt><dd>{amount === undefined ? "—" : rupees(amount)}</dd></div>;
}

function MyOrders({ shopId, orders }: { shopId: string; orders: Order[] }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  function lookup(event: FormEvent) {
    event.preventDefault();
    const normalized = token.trim().toUpperCase();
    if (!/^PF-\d{4,10}$/.test(normalized)) { setError("Enter a reference like PF-1001."); return; }
    setError("");
    router.push(orderPath(shopId, normalized));
  }
  return <section id="my-orders" className="order-section" aria-labelledby="orders-heading">
    <div className="section-title"><div><h2 id="orders-heading">Track an order</h2>
      <p>View orders placed from this browser.</p></div>
      <form className="track-search" onSubmit={lookup}><input aria-label="Order reference" placeholder="Order reference, e.g. PF-1001"
        value={token} onChange={e => setToken(e.target.value)} /><button className="button outline"><Search size={17} /> Find order</button></form></div>
    <ErrorBox>{error}</ErrorBox>
    <div className="panel">
      {orders.length === 0 ? <Empty title="No orders yet" detail="Your orders will appear here after checkout." />
        : <div className="customer-orders">{orders.map(order => <Link key={order.id} className="customer-order-row" href={orderPath(shopId, order.token)}>
          <span className="icon-block purple"><FileText size={20} /></span>
          <span><strong>{order.token}</strong><small>{dateLabel(order.createdAt)} · {timeLabel(order.createdAt)}</small></span>
          <ModeBadge mode={order.mode} /><StatusBadge status={order.status} /><strong>{rupees(order.price.total)}</strong><ChevronRight size={17} />
        </Link>)}</div>}
    </div>
  </section>;
}

type RazorpayOptions = Record<string, unknown> & { handler: () => void };
declare global { interface Window { Razorpay?: new (options: RazorpayOptions) => { open: () => void } } }
let razorpayScript: Promise<void> | undefined;
function loadRazorpay() {
  razorpayScript ??= new Promise<void>((resolve, reject) => {
    if (window.Razorpay) { resolve(); return; }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => { script.remove(); reject(new Error("The payment window could not load.")); };
    document.head.appendChild(script);
  }).catch(error => { razorpayScript = undefined; throw error; });
  return razorpayScript;
}

export function TrackPage({ shopId, orderId }: { shopId: string; orderId: string }) {
  const { data, error, connected, refresh } = useFeed<TrackingFeed>(shopId, "orders/" + encodeURIComponent(orderId));
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState(false);
  const previous = useRef<{ status: Order["status"]; payment: Order["payment"]; eta: number | null } | null>(null);
  const order = data?.order;
  useEffect(() => {
    if (!order) return;
    const last = previous.current;
    if (last && last.status !== order.status) notify(order.token, statusLabel[order.status]);
    if (last && last.payment !== order.payment && order.payment === "PAID") notify(order.token, "Payment verified");
    if (last && order.status === "QUEUED" && last.eta !== null && (order.etaMinutes === null || order.etaMinutes > last.eta + 2))
      notify(order.token, order.etaMinutes === null ? "Printing delayed. A new estimate is pending." : eta(order.etaMinutes));
    previous.current = { status: order.status, payment: order.payment, eta: order.etaMinutes };
  }, [order]);

  async function action(name: string) {
    if (!order || busy) return;
    setBusy(name); setActionError(""); setNotice("");
    try {
      if (name === "checkout") {
        const [gateway] = await Promise.all([api<Record<string, unknown>>(shopId, "orders/" + order.id + "/checkout", {}), loadRazorpay()]);
        if (!window.Razorpay) throw new Error("Online checkout could not be loaded.");
        const checkout = new window.Razorpay({ ...gateway, method: { upi: true, card: false, netbanking: false, wallet: false },
          handler: () => {
            setNotice("Checking payment with Razorpay…");
            void api(shopId, "orders/" + order.id + "/reconcile", {}).then(refresh).catch(failure => setActionError(message(failure)));
          },
        });
        checkout.open();
      } else {
        await api(shopId, "orders/" + order.id + "/" + name, {});
        await refresh();
        setConfirm(false);
      }
    } catch (failure) { setActionError(message(failure)); }
    finally { setBusy(""); }
  }

  return <div className="customer-shell"><CustomerNav shopId={shopId} />
    <main className="customer-wrap single-page">
      <Link href={customerPath(shopId) + "#my-orders"} className="back-link"><ChevronLeft size={18} /> Back to dashboard</Link>
      {order && data ? <>
        <div className="page-heading"><div><p className="eyebrow">ORDER PLACED</p><h1>{order.token}</h1>
          <p>{data.shop.settings.name} · {dateLabel(order.createdAt)} at {timeLabel(order.createdAt)}</p></div>
          <span className={"pill " + (connected ? "green" : "amber")}><span className="dot" />{connected ? "Live updates" : "Reconnecting"}</span></div>
        <ErrorBox>{actionError || error}</ErrorBox>
        <div className="customer-grid">
          <div className="stack">
            <section className="panel tracking-card waiting-room" aria-labelledby="waiting-room-title">
              <div className="waiting-room-heading">
                <h2 id="waiting-room-title">Print waiting room</h2>
                <ModeBadge mode={order.mode} />
              </div>
              {order.collectionAt && <p className="queue-note">Collection {dateLabel(order.collectionAt)} · {timeLabel(order.collectionAt)} IST · Planned print start {timeLabel(order.printAt!)} IST</p>}
              <Journey order={order} events={data.events} />
              <div className="tracking-status" aria-live="polite"><div><h3>{statusLabel[order.status]}</h3><p>{order.reason ??
                (order.status === "READY" ? (order.courier ? "Share your collection OTP with the rider." : data.shop.demo && order.payment === "PAID" ? "Your customer will collect the prints automatically in the live shop." : "Show the collection code at the print counter.") :
                  order.status === "COMPLETED" ? (order.courier?(order.deliveredAt?"Your prints were delivered.":"Your rider is taking the prints to your address."):"Your order has been collected.") :
                  order.status === "AWAITING_PAYMENT" ? "The order enters the queue after payment is verified." : order.status === "ASSIGNED" ? "Printer " + order.printerId + " is assigned. Printing starts next." : order.status === "SCHEDULED" ? "Payment confirmed. The shop will start your job when its print window opens and a compatible printer is free." : eta(order.etaMinutes))}</p></div></div>
              {order.queuePosition !== null && <p className="queue-note"><ListOrdered size={17} /> Position {order.queuePosition} in the {order.mode === "NORMAL" ? "Normal" : "Express"} queue</p>}
              {order.status === "PRINTING" && <div className="print-progress"><progress value={order.progress} max={100} aria-label="Printing progress" /><span>{order.progress}%</span></div>}
              {order.status === "READY" && order.pickupPin && <div className="pickup-code"><TicketCheck size={24} />
                <div><span>{order.courier?"Courier collection OTP":"Collection code"}</span><strong aria-label="Collection code">{order.pickupPin}</strong></div></div>}
              {order.paymentReference&&<PaymentQR shop={shopId} reference={order.paymentReference}/>}
              {order.courier&&<div className="delivery-note"><strong>Blinkit home delivery · simulated</strong><p>{order.deliveryAddress}</p>{order.status==="COMPLETED"&&!order.deliveredAt&&<button className="button outline" disabled={!!busy} onClick={()=>void action("received")}>Confirm home delivery</button>}</div>}
              {order.status === "AWAITING_PAYMENT" && <div className="inline-actions">
                {order.method === "DEMO" ? <button className="button primary" disabled={!!busy} onClick={() => void action("demo-payment")}>
                  <CreditCard size={17} /> {busy ? "Processing…" : "Simulate payment"}</button>
                  : <><button className="button primary" disabled={!!busy} onClick={() => void action("checkout")}><CreditCard size={17} /> Pay with UPI</button>
                    <button className="button outline" disabled={!!busy} onClick={() => void action("reconcile")}>Check payment</button></>}
              </div>}
              <div className="inline-actions"><Link className="button outline small" href={"/customer/orders/" + order.id + "/replay?shop=" + encodeURIComponent(shopId)}>Replay my order in 3D</Link></div>
              {notice && order.payment === "PENDING" && <p className="muted" role="status">{notice}</p>}
              {["AWAITING_PAYMENT", "SCHEDULED", "QUEUED"].includes(order.status) && <div className="inline-actions">
                {confirm ? <><span>Cancel this print order?</span><button className="button danger" disabled={!!busy} onClick={() => void action("cancel")}>Confirm cancellation</button>
                  <button className="button quiet" onClick={() => setConfirm(false)}>Keep order</button></>
                  : <button className="text-button muted" onClick={() => setConfirm(true)}>Cancel order</button>}
              </div>}
            </section>
            <section className="panel tracking-card">
              <div className="section-title"><div><h2>Order activity</h2></div><button className="button outline small" onClick={async () => {
                const result = await toggleNotifications();
                setNotice(result === "granted" ? "Browser notifications enabled." : "Browser notifications are unavailable or blocked.");
              }}><Bell size={16} /> Enable alerts</button></div>
              {notice && !notice.startsWith("Checking") && <p className="muted" role="status">{notice}</p>}
              <ol className="timeline">{data.events.filter(event => eventLabel[event.type] && event.type !== "PAYMENT_PENDING")
                .map(event => <li key={event.id}><span className="timeline-dot" /><div><strong>{eventLabel[event.type]}</strong>
                  <small>{dateLabel(event.at)} · {timeLabel(event.at)}{event.payload.simulated ? " · Simulated" : ""}</small></div></li>)}</ol>
            </section>
          </div>
          <OrderReceipt key={order.id} order={order} shop={data.shop} busy={!!busy && order.status === "AWAITING_PAYMENT"} />
        </div>
      </> : error ? <div className="panel tracking-card"><h1>Order unavailable</h1><ErrorBox>{error}</ErrorBox>
        <button className="button outline" onClick={() => void refresh()}>Try again</button></div> : <Loading label="Finding your order…" />}
    </main><CustomerFooter shopId={shopId} /></div>;
}

function OrderReceipt({ order, shop, busy }: { order: Order; shop: Shop; busy: boolean }) {
  const paid = order.payment === "PAID";
  const summary = <div className="summary-content">
    {paid && <header className="receipt-paper-heading"><h2>Order receipt</h2><p>{shop.settings.name}</p></header>}
    <dl className="receipt-order-meta">
      <div><dt>Order</dt><dd>{order.token}</dd></div>
      <div><dt>Placed</dt><dd>{dateLabel(order.createdAt)} · {timeLabel(order.createdAt)} IST</dd></div>
      <div><dt>Service</dt><dd>{order.mode === "EXPRESS" ? "Express" : "Normal"}</dd></div>
      <div><dt>Collection</dt><dd>{order.courier ? "Blinkit rider · simulated" : "Shop pickup"}{order.collectionAt && <><br />{dateLabel(order.collectionAt)} · {timeLabel(order.collectionAt)} IST</>}</dd></div>
    </dl>
    <div className="summary-file">
      <FileText size={18} />
      <span><strong>{order.fileName ?? "Print documents"}</strong>
        {order.options.batch
          ? <small>{order.options.batch.length} files · {order.price.impressions} printed pages · {order.price.sheets} sheets</small>
          : <>
            <small>{order.price.pages} pages · {order.options.copies} copies · {order.price.sheets} sheets</small>
            <small>{order.options.size} · {order.options.color === "BW" ? "B&W" : "Color"} · {order.options.duplex ? "Double-sided" : "Single-sided"}</small>
          </>}
      </span>
    </div>
    {order.options.batch && <BatchSummary files={order.options.batch} />}
    <dl className="price-lines">
      <PriceLine label="Printing" amount={order.price.base} />
      <PriceLine label="Finishing" amount={order.price.finishing} />
      <PriceLine label="Express priority" amount={order.price.express} />
      {order.price.discount > 0 && <PriceLine label="Discount" amount={-order.price.discount} />}
      {order.price.tax > 0 && <PriceLine label="Tax" amount={order.price.tax} />}
    </dl>
    <div className="summary-total"><span>{paid ? "Total paid" : "Order total"}</span><strong>{rupees(order.price.total)}</strong></div>
    <p className="summary-eta"><CreditCard size={17} /> {order.method === "DEMO" ? "Simulated payment" : order.method === "UPI" ? "UPI" : "Pay at counter"}</p>
    <p className="summary-eta"><ShieldCheck size={17} /> {order.privacy === "PURGED" ? "Temporary file removed" :
      order.privacy === "PURGE_FAILED" ? "Cleanup will retry" : order.privacy === "PURGE_REQUESTED" ? "Cleanup pending" : "Temporary file encrypted"}</p>
  </div>;
  return <aside className="tracking-summary">
    <ReceiptPrinter paid={paid} busy={busy} status={paid ? "Payment confirmed" : busy ? "Checking payment…" : paymentLabel[order.payment]}
      reference={order.token} amount={rupees(order.price.total)} home={customerPath(shop.id)}>
      {paid && summary}
    </ReceiptPrinter>
    {!paid && <section className="panel summary-card receipt-unpaid">
      <h3><ReceiptText size={20} /> Order summary</h3>{summary}
    </section>}
  </aside>;
}
