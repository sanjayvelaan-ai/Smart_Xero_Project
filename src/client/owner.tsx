"use client";
import { isShopSignal } from "./shop-alerts";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Glass } from "@/components/glass/glass";
import { StatCard } from "@/components/ui/card-10";
import { LiquidNavbar } from "@/components/ui/liquid-glass-navbar";
import { brandName } from "@/lib/brand";
import { parseOwnerSection, type Section } from "@/lib/owner-route";
import { motion, useReducedMotion } from "framer-motion";
import {StaffPreview} from "./staff-preview";
import { BatchSummary } from "./batch-summary";
import QRCode from "qrcode";
import { WorkspaceSwitch, twinPath, orderWorkspace } from "./shared";
import { Activity, ArrowUpRight, Bell, ChartNoAxesCombined, Check, ChevronRight, CircleAlert, Clock3, CloudOff,
  Download, FileText, LayoutDashboard, ListOrdered, LogOut, PackageCheck, Printer, QrCode, ReceiptText,
  Search, Settings2, SlidersHorizontal, UserRound, Volume2, X, Zap } from "lucide-react";
import { pickNext, compatible, eventLabel, paymentLabel, rupees, statusLabel,
  type Order, type PrinterConfig, type Printer as PrinterData, type Settings, type StaffSnapshot, type Status } from "@/domain";
import { api, apiPath, commandId, customerPath, dateLabel, demoShop, Empty, ErrorBox, Loading, Logo, message,
  ModeBadge, notify, ownerPath, StatusBadge, timeLabel, toggleNotifications, useFeed } from "./shared";

const sections = [
  { id: "overview", title: "Overview", icon: LayoutDashboard },
  { id: "orders", title: "Orders & queues", icon: ListOrdered },
  { id: "printers", title: "Printers", icon: Printer },
  { id: "analytics", title: "Analytics", icon: ChartNoAxesCombined },
  { id: "settings", title: "Shop settings", icon: Settings2 },
] as const;
type Queue = "active" | Status;
type Command = { action: string; printerId?: number; reason?: string; pin?: string; value?: number };
const queues: Queue[] = ["active", "AWAITING_PAYMENT", "SCHEDULED", "QUEUED", "ASSIGNED", "PRINTING", "FINISHING", "READY", "COMPLETED", "HELD", "FAILED", "CANCELLED"];

export function OwnerWorkspace({ prototypeLogin }: { prototypeLogin: boolean }) {
  const path = usePathname();
  const query = useSearchParams();
  const section = parseOwnerSection(path.split("/").filter(Boolean).slice(1));
  if (!section) return null;
  const shop = query.get("shop");
  const shopId = shop && /^[a-z0-9-]{2,40}$/.test(shop) ? shop : demoShop;
  return <OwnerPage key={shopId} shopId={shopId} section={section} initialOrder={query.get("order")}
    prototypeLogin={prototypeLogin && shopId === demoShop} />;
}

function navigateSection(href: string) {
  if (href === window.location.pathname + window.location.search) return;
  // The parent layout owns the dashboard feed. Only the active section changes.
  window.history.pushState(null, "", href);
  window.scrollTo({ top: 0, behavior: "instant" });
}

function OwnerPage({ shopId, section, initialOrder, prototypeLogin }: { shopId: string; section: Section; initialOrder: string | null; prototypeLogin: boolean }) {
  const { data, error, connected, refresh, reconnect } = useFeed<StaffSnapshot>(shopId, "staff", true);
  const [selected, setSelected] = useState(initialOrder);
  const [alerts, setAlerts] = useState(false);
  const [qr, setQr] = useState(false);
  const [toast, setToast] = useState("");
  const [unread, setUnread] = useState(0);
  const [sound, setSound] = useState(false);
  const [alertFeedback, setAlertFeedback] = useState("");
  const last = useRef<number | null>(null);
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => setSelected(initialOrder), [initialOrder]);

  useEffect(() => {
    if (!data) { last.current = null; return; }
    const previous = last.current;
    last.current = data.sequence;
    if (previous === null) return;
    const incoming = data.events.filter(event => event.sequence > previous && (event.type === "OWNER_NOTIFIED" || isShopSignal(event)));
    if (!incoming.length) return;
    if (!alerts) setUnread(current => current + incoming.length);
    const newest = incoming[0];
    const label = newest.type === "OWNER_NOTIFIED"
      ? "New " + (newest.payload.mode === "EXPRESS" ? "Express" : "Normal") + " order " + newest.payload.token
      : (eventLabel[newest.type] ?? "Order update") + " · " + newest.payload.token;
    setToast(label);
    notify(brandName + " orders", label);
    if (sound && audio.current?.state === "running") {
      const context = audio.current;
      const tone = context.createOscillator();
      const volume = context.createGain();
      tone.connect(volume).connect(context.destination);
      tone.frequency.value = 660;
      volume.gain.setValueAtTime(0.07, context.currentTime);
      volume.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.24);
      tone.start(); tone.stop(context.currentTime + 0.25);
    }
  }, [data, sound, alerts]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => () => { if (audio.current) void audio.current.close(); }, []);

  async function switchSound() {
    if (sound) { setSound(false); return; }
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      setSound(true);
      setAlertFeedback("Order chime enabled for this dashboard.");
    } catch { setAlertFeedback("This browser could not enable the order chime."); }
  }
  async function signOut() {
    try { await api(shopId, "sign-out", {}); setSelected(null); await refresh(); }
    catch (failure) { setToast(message(failure)); }
  }

  if (!data && error) return <StaffLogin shopId={shopId} prototypeLogin={prototypeLogin} onSignIn={async () => { reconnect(); }} initialError={error} />;
  if (!data) return <div className="owner-shell"><Loading label="Opening the owner dashboard…" /></div>;
  const order = data.orders.find(item => item.id === selected);
  const visibleSections = sections.filter(item => item.id !== "settings" || data.user.role === "OWNER");
  const queued = data.metrics.normal + data.metrics.express;
  return <div className="owner-shell">
    <aside className="sidebar">
      <Logo href={ownerPath(shopId)} />
      <div className="sidebar-shop"><span className="icon-block purple"><Printer size={19} /></span><div><strong>{data.shop.settings.name}</strong>
        <small>{data.shop.settings.address}</small></div></div>
      <p className="sidebar-label">WORKSPACE</p>
      <LiquidNavbar label="Owner sections" className="sidebar-nav" tone="dark" compact={false}
        active={visibleSections.findIndex(item => item.id === section)}
        onNavigate={navigateSection}
        items={visibleSections.map(({id, title, icon: Icon}) => ({
          label: title, href: ownerPath(shopId, id === "overview" ? "" : id),
          icon: <Icon size={19} />, badge: id === "orders" && queued > 0 ? queued : undefined,
        }))} />
      <div className="sidebar-bottom">
        <Link className="customer-switch" href={twinPath(shopId)}><ArrowUpRight size={17} /> Open shop floor</Link>
        <div className="staff-profile"><span className="avatar">{data.user.name.slice(0, 1)}</span><div><strong>{data.user.name}</strong>
          <small>{data.user.role === "OWNER" ? "Shop owner" : "Shop worker"}</small></div>
          <button className="icon-button" title="Sign out" aria-label="Sign out" onClick={() => void signOut()}><LogOut size={17} /></button></div>
      </div>
    </aside>
    <div className="owner-content">
      <header className="owner-top">
        <WorkspaceSwitch shop={shopId} active="owner" />
        <div className="owner-top-actions">
          <span className={"pill " + (connected ? "green" : "amber")}><span className="dot" />{connected ? "Live sync" : "Reconnecting"}</span>
          
          <button className="icon-button notification-button" title="Notifications" aria-label="Notifications" aria-expanded={alerts}
            onClick={() => { setAlerts(value => !value); setUnread(0); }}><Bell size={21} />{unread > 0 && <span />}</button>
        </div>
      </header>
      <main className="owner-main">
        {toast && <div className="toast" role="status"><Bell size={19} />{toast}<button aria-label="Dismiss notification" className="icon-button" onClick={() => setToast("")}><X size={16} /></button></div>}
        <ErrorBox>{error}</ErrorBox>
        {section === "overview" && <>
          <PageHeading eyebrow="SHOP OPERATIONS" title={`Welcome, ${data.user.name}`} detail="Monitor shop activity, print queues, and customer pickups."
            action={<button className="button primary" onClick={() => setQr(true)}><QrCode size={18} /> Shop QR code</button>} />
          <div className="metric-grid">
            <Metric icon={<FileText size={20} />} title="Orders today" value={data.metrics.today} tone="purple" detail={data.metrics.completed + " collected today"} />
            <Metric icon={<ListOrdered size={20} />} title="In queue" value={data.metrics.normal + data.metrics.express} tone="blue"
              detail={data.metrics.normal + " Normal · " + data.metrics.express + " Express"} />
            <Metric icon={<Printer size={20} />} title="Currently printing" value={data.metrics.printing} tone="teal"
              detail={data.metrics.online + " online · " + data.metrics.offline + " offline"} />
            <Metric icon={<ReceiptText size={20} />} title={data.shop.demo ? "Simulated sales today" : "Sales today"} value={data.metrics.sales} format={rupees}
              tone="amber" detail={rupees(data.metrics.expressSales) + " in Express fees"} />
          </div>
          <div className="owner-split">
            <OrderList data={data} onSelect={setSelected} overview />
            <section className="panel compact-printers">
              <div className="panel-heading"><div><h2>Printer fleet</h2><p>Capacity and active jobs</p></div>
                <OwnerSectionLink href={ownerPath(shopId, "printers")} className="icon-button" aria-label="Manage printers"><ChevronRight size={19} /></OwnerSectionLink></div>
              {data.printers.map(p => <div className="compact-printer" key={p.id}>
                <span className={"icon-block " + (p.online ? "purple" : "neutral")}><Printer size={18} /></span>
                <div><strong>{p.name}</strong><small>{p.model}</small></div><PrinterBadge printer={p} />
              </div>)}
              <div className="fleet-footer"><span className="dot" /> {data.shop.settings.automatic ? "Automatic assignment" : "Manual assignment"}</div>
            </section>
          </div>
          <div className="overview-bottom">
            <Metric icon={<PackageCheck size={20} />} title="Ready for pickup" value={data.metrics.ready} tone="green" detail="Waiting at the counter" />
            <Metric icon={<Clock3 size={20} />} title="Average print time" value={data.metrics.processing} unit=" min" tone="purple" detail="For orders collected today" />
            <Metric icon={<Clock3 size={20} />} title="Average queue wait" value={data.metrics.wait} unit=" min" tone="blue" detail="For jobs started today" />
            <Metric icon={<CircleAlert size={20} />} title="Failed / cancelled" value={data.metrics.failed} secondaryValue={data.metrics.cancelled} tone="red" detail="Today’s orders" />
          </div>
        </>}
        {section === "orders" && <>
          <PageHeading eyebrow="PRINT OPERATIONS" title="Orders & queues" detail="Assign, print, and verify pickup for customer orders."
            action={<Link href={customerPath(shopId)} className="button outline"><ArrowUpRight size={17} /> Customer portal</Link>} />
          <OrderList data={data} onSelect={setSelected} />
        </>}
        {section === "printers" && <>
          <PageHeading eyebrow="FLEET MANAGEMENT" title="Printers" detail={data.shop.demo
            ? "Manage the three virtual printers used by the shop."
            : "Manage existing printers and track staff-confirmed printing progress."} />
          <div className="printer-grid">{data.printers.map(p => <PrinterCard key={p.id} printer={p} data={data} refresh={refresh} />)}</div>
        </>}
        {section === "analytics" && <Analytics data={data} />}
        {section === "settings" && (data.user.role === "OWNER" ? <ShopSettings data={data} refresh={refresh} onQr={() => setQr(true)} />
          : <div className="panel"><Empty title="Owner access required" detail="Shop settings are available to the shop owner." /></div>)}
      </main>
    </div>
    {alerts && <Dialog title="Notifications" onClose={() => setAlerts(false)}>
      <div className="inline-actions">
        <button className="button outline small" onClick={() => void switchSound()}><Volume2 size={16} /> {sound ? "Mute chime" : "Enable chime"}</button>
        <button className="button outline small" onClick={async () => {
          const result = await toggleNotifications();
          setAlertFeedback(result === "granted" ? "Browser notifications enabled." : "Browser notifications are unavailable or blocked.");
        }}><Bell size={16} /> Browser alerts</button>
      </div>
      {alertFeedback && <p className="muted" role="status">{alertFeedback}</p>}
      <ActivityList data={data} onSelect={id => { setSelected(id); setAlerts(false); }} />
    </Dialog>}
    {order && <OrderDialog key={order.id} order={order} data={data} refresh={refresh} onClose={() => setSelected(null)} />}
    {qr && <ShopQr shopId={shopId} shopName={data.shop.settings.name} onClose={() => setQr(false)} />}
  </div>;
}

function OwnerSectionLink({ href, ...props }: React.ComponentProps<typeof Link> & { href: string }) {
  return <Link {...props} href={href} prefetch={false} onNavigate={event => {
    event.preventDefault();
    navigateSection(href);
  }} />;
}

export function StaffLogin({ shopId, onSignIn, initialError, prototypeLogin, twin = false }: {
  shopId: string;
  onSignIn: () => Promise<unknown>;
  initialError: string;
  prototypeLogin: boolean;
  twin?: boolean;
}) {
  const demo = shopId === demoShop;
  const [username, setUsername] = useState(demo ? "ram" : "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError === "Sign in to the shop dashboard." ? "" : initialError);
  async function login(prototype = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (prototype) await api(shopId, "prototype-sign-in", {});
      else await api(shopId, "sign-in", { username, password });
      await onSignIn();
    }
    catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  return <div className="login-shell">
    <header className="customer-nav"><div className="nav-inner"><Logo href={customerPath(shopId)} />
      <WorkspaceSwitch shop={shopId} active={twin ? "twin" : "owner"} />
      </div></header>
    <main className="login-main">
      <section className="panel login-card glass-host"><Glass radius={28} />
        <span className="icon-block purple"><LayoutDashboard size={25} /></span>
        <h1>{twin ? "Live 3D shop" : "Owner dashboard"}</h1>
        <p>{prototypeLogin ? "Open the local prototype as Ram, the shop owner." : "Sign in with your shop staff account."}</p>
        {prototypeLogin && <button type="button" className="button primary prototype-login" onClick={() => void login(true)} disabled={busy}>
          {busy ? "Signing in…" : "Enter demo as owner"}
        </button>}
        <form className="stack" onSubmit={(event: FormEvent) => { event.preventDefault(); void login(); }}>
          {<><label className="field"><span>Username</span><input required autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} /></label>
              <label className="field"><span>Password</span><input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label></>}
          <ErrorBox>{error}</ErrorBox>
          <button className={"button " + (prototypeLogin ? "outline" : "primary")} disabled={busy}>Sign in</button>
        </form>
      </section>
    </main>
  </div>;
}

function PageHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{detail}</p></div>{action}</div>;
}

function Metric(props: React.ComponentProps<typeof StatCard>) {
  return <StatCard unit="" {...props} />;
}

function PrinterBadge({ printer }: { printer: PrinterData }) {
  return <span className={"pill " + (!printer.online ? "red" : !printer.paperLoaded ? "amber" : printer.jobId ? "purple" : "green")}>
    <span className="dot" />{!printer.online ? "Offline" : !printer.paperLoaded ? "Out of paper" : printer.jobId ? "Busy" : "Idle"}
  </span>;
}

function OrderList({ data, onSelect, overview }: { data: StaffSnapshot; onSelect: (id: string) => void; overview?: boolean }) {
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState<Queue>("active");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("workflow");
  const [service, setService] = useState("ALL");
  const active = (status: Status) => !["COMPLETED", "CANCELLED"].includes(status);
  const filtered = data.orders.filter(order => {
    const group = tab === "active" ? active(order.status) : order.status === tab;
    return group && (service === "ALL" || service === order.mode) && (!query || (order.token + " " + (order.fileName ?? "")).toLowerCase().includes(query.trim().toLowerCase()));
  });
  if (sort === "workflow") {
    filtered.sort((a, b) =>
      queues.indexOf(a.status) - queues.indexOf(b.status) ||
      (a.queuePosition ?? Number.MAX_SAFE_INTEGER) - (b.queuePosition ?? Number.MAX_SAFE_INTEGER) ||
      (a.collectionAt ?? a.createdAt).localeCompare(b.collectionAt ?? b.createdAt));
  }
  if (sort === "oldest") filtered.reverse();
  if (sort === "priority") filtered.sort((a, b) => (a.queuePosition ?? 999) - (b.queuePosition ?? 999) || (a.etaMinutes ?? 999) - (b.etaMinutes ?? 999));
  const rows = overview ? filtered.slice(0, 7) : filtered;
  return <section className="panel order-table-panel glass-host"><Glass />
    <div className="panel-heading"><div><h2>{overview ? "Live order queue" : "Print orders"}</h2>
      <p>{overview ? "Incoming orders and work in progress" : "Search orders or switch between print queues"}</p></div>
      {overview ? <OwnerSectionLink className="button outline small" href={ownerPath(data.shop.id, "orders")}>All orders <ChevronRight size={16} /></OwnerSectionLink>
        : <div className="table-tools"><label className="search-field"><Search size={17} />
          <input placeholder="Search orders" aria-label="Search orders" value={query} onChange={e => setQuery(e.target.value)} /></label>
          <select aria-label="Sort orders" value={sort} onChange={e => setSort(e.target.value)}>
            <option value="workflow">Workflow stage</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="priority">Queue position</option>
          </select></div>}
    </div>
    <div className="queue-tabs" role="group" aria-label="Queue filters">{queues.map(stage => <button key={stage}
      onClick={() => setTab(stage)} className={tab === stage ? "chosen" : ""} aria-pressed={tab === stage}>
      {stage === tab && <motion.span className="queue-selection" aria-hidden="true" layoutId="queue-selection"
        transition={reduceMotion ? { duration:0 } : { type:"spring", stiffness:410, damping:34 }} />}
      {stage === "active" ? "All active" : statusLabel[stage]} <small>{data.orders.filter(order => stage === "active" ? active(order.status) : order.status === stage).length}</small></button>)}</div>
    <label className="service-filter">Service <select aria-label="Filter by service" value={service} onChange={event => setService(event.target.value)}>
      <option value="ALL">Normal and Express</option><option value="NORMAL">Normal</option><option value="EXPRESS">Express</option>
    </select></label>
    {rows.length === 0 ? <Empty title={query ? "No matching orders" : "No orders in this view"}
      detail={query ? "Try a different reference or file name." : "New orders will appear here as customers place them."}
      action={tab === "active" && !query ? <Link className="button outline small" href={customerPath(data.shop.id)}>Open customer portal</Link> : undefined} />
      : <div className="table-scroll"><table><thead><tr><th>Order</th><th>Service</th><th>Status</th><th>Total</th><th><span className="sr-only">View details</span></th></tr></thead>
        <tbody>{rows.map(order => <tr key={order.id} onClick={() => onSelect(order.id)}>
          <td><button className="order-link" onClick={event => { event.stopPropagation(); onSelect(order.id); }}>{order.token}</button>
            <small>{order.price.impressions} print{order.price.impressions === 1 ? "" : "s"} · {order.options.batch ? order.options.batch.length + " files" : order.options.color === "BW" ? "B&W" : "Color"}</small></td>
          <td><ModeBadge mode={order.mode} />{order.queuePosition !== null && <small>Position {order.queuePosition}</small>}</td>
          <td><StatusBadge status={order.status} />
            {order.printerId && <small>Printer {order.printerId}</small>}
            {order.status === "COMPLETED" && <small>{order.courier ? (order.deliveredAt ? "Delivered at home" : "Collected by rider") : "Collected in shop"}</small>}
            {order.collectionAt && <small>Collection {dateLabel(order.collectionAt)} · {timeLabel(order.collectionAt)}</small>}
          </td><td className="table-total">{rupees(order.price.total)}</td><td><ChevronRight size={17} /></td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = panel.current;
    dialog?.showModal();
    return () => { dialog?.close(); };
  }, []);
  return <dialog ref={panel} className="drawer" aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="drawer-inner"><div className="drawer-top"><h2>{title}</h2>
      <button className="icon-button" aria-label="Close" onClick={onClose}><X size={21} /></button></div>{children}</div>
  </dialog>;
}

function ActivityList({ data, onSelect }: { data: StaffSnapshot; onSelect: (id: string) => void }) {
  const events = data.events.filter(event => isShopSignal(event) || event.type === "OWNER_NOTIFIED" || ["PRINT_FAILED", "ORDER_READY_FOR_PICKUP",
    "ORDER_COMPLETED", "PRINTER_OFFLINE", "PAYMENT_FAILED", "DOCUMENT_PURGE_FAILED"].includes(event.type));
  if (!events.length) return <Empty title="No notifications yet" detail="Order and printer activity will appear here." />;
  return <div className="alerts-list">{events.map(event => <button className="alert-row" key={event.id}
    disabled={!event.orderId} onClick={() => { if (event.orderId) onSelect(event.orderId); }}>
    <span className="icon-block purple"><Activity size={18} /></span><span>
      <strong>{event.type === "OWNER_NOTIFIED" ? "New " + (event.payload.mode === "EXPRESS" ? "Express" : "Normal") + " order"
        : eventLabel[event.type]} {event.payload.token}</strong>
      <small>{timeLabel(event.at)}{event.payload.total === undefined ? "" : " · " + rupees(event.payload.total)}</small></span></button>)}</div>;
}

function OrderDialog({ order, data, refresh, onClose }: { order: Order; data: StaffSnapshot; refresh: () => Promise<unknown>; onClose: () => void }) {
  const [printerId, setPrinterId] = useState("");
  const [pin, setPin] = useState("");
  const [progress, setProgress] = useState("");
  const [reason, setReason] = useState("");
  const [reasonAction, setReasonAction] = useState<"fail" | "cancel" | "">("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const shopId = data.shop.id;
  const orderApi = "staff/orders/" + order.id;
  const assigned = data.printers.find(p => p.id === order.printerId);
  const available = data.printers.filter(p => p.online && p.paperLoaded && !p.jobId && compatible(p, order.options));
  const recent = data.events.filter(event => event.orderId === order.id);
  async function mutate(input: Command) {
    setError(""); setNotice(""); setBusy(input.action);
    try {
      await api(shopId, orderApi + "/command", { key: commandId(), command: input });
      await refresh();
      setReasonAction(""); setReason("");
      if (input.action === "accept") setNotice("Order accepted. Assign a printer when ready.");
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(""); }
  }
  const button = (name: string, action: string, primary = false) => <button
    className={"button " + (primary ? "primary" : "outline")} disabled={!!busy} onClick={() => void mutate({ action })}>{busy === action ? "Saving…" : name}</button>;
  async function reconcile() {
    setBusy("reconcile"); setError(""); setNotice("");
    try { await api(shopId, orderApi + "/reconcile", {}); await refresh(); setNotice("Payment status checked with Razorpay."); }
    catch (failure) { setError(message(failure)); }
    finally { setBusy(""); }
  }
  return <Dialog title={order.token} onClose={onClose}>
    <div className="order-dialog">
      <div className="inline-badges"><ModeBadge mode={order.mode} /><StatusBadge status={order.status} />
        {order.options.confidential && <span className="pill neutral">Confidential</span>}</div>
      <p className="muted">{dateLabel(order.createdAt)} · {timeLabel(order.createdAt)} · Customer {order.avatarId.slice(-6).toUpperCase()}</p>
      <dl className="detail-grid">
        <div><dt>Document</dt><dd>{order.fileName ?? "Restricted document"}</dd></div>
        <div><dt>Assigned printer</dt><dd>{assigned?.name ?? "—"}</dd></div>
        {order.options.batch ? <div><dt>Print batch</dt><dd>{order.options.batch.length} files · {order.price.impressions} printed pages · {order.price.sheets} sheets</dd></div> : <>
        <div><dt>Print settings</dt><dd>{order.options.size} · {order.options.color === "BW" ? "B&W" : "Color"} · {order.options.duplex ? "Duplex" : "Single-sided"}</dd></div>
        <div><dt>Document layout</dt><dd>{order.options.layout === "PORTRAIT" ? "Portrait" : "Landscape"} · {order.options.paper === "PREMIUM" ? "Premium" : "Standard"} paper</dd></div>
        <div><dt>Pages &amp; copies</dt><dd>{order.price.pages} of {order.originalPages} pages · {order.options.copies} {order.options.copies === 1 ? "copy" : "copies"}</dd></div>
        <div><dt>Range &amp; finishing</dt><dd>{order.options.pages || "All pages"} · {order.options.finishing === "NONE" ? "No finishing" : order.options.finishing === "STAPLE" ? "Staple" : "Bind"}{order.options.collate ? " · Collate" : ""}</dd></div>
        </>}
        {order.collectionAt && <><div><dt>Planned print start</dt><dd>{dateLabel(order.printAt!)} · {timeLabel(order.printAt!)} IST</dd></div>
          <div><dt>{order.courier ? "Courier collection" : "Shop pickup"}</dt><dd>{dateLabel(order.collectionAt)} · {timeLabel(order.collectionAt)} IST</dd></div></>}
        <div><dt>Payment</dt><dd>{rupees(order.price.total)} · {paymentLabel[order.payment]}</dd></div>
        <div><dt>Document storage</dt><dd>{order.privacy === "AVAILABLE" ? "Encrypted" : order.privacy === "PURGED" ? "Removed" : "Cleanup pending"}</dd></div>
        {order.queuePosition !== null && <div><dt>Queue position</dt><dd>{order.queuePosition} · ~{order.etaMinutes} min</dd></div>}
        {order.options.instructions && <div className="wide"><dt>Customer instructions</dt><dd>{order.options.instructions}</dd></div>}
      </dl>
      {order.reason && <ErrorBox>{order.reason}</ErrorBox>}
      {["PRINTING", "HELD"].includes(order.status) && <div className="print-progress"><progress max={100} value={order.progress} aria-label="Printing progress" /><span>{order.progress}%</span></div>}
      <Link className="text-button" href={orderWorkspace(twinPath(shopId),order.id)}>View order on shop floor <ArrowUpRight size={15}/></Link>
      <Link className="text-button" href={"/digital-twin/replay/"+order.id+"?shop="+encodeURIComponent(shopId)}>Replay order journey</Link>
      {order.options.batch && <BatchSummary files={order.options.batch} staff />}
      {!order.options.confidential && order.privacy==="AVAILABLE" && ["QUEUED","ASSIGNED","PRINTING","HELD","READY","FINISHING"].includes(order.status)&&<StaffPreview order={order} shop={shopId}/>}
      {order.options.confidential&&<div className="private-preview"><strong>Private document</strong><span>Staff preview concealed</span></div>}
      {order.courier&&<div className="delivery-note"><strong>Blinkit courier · simulated dispatch</strong><p>{order.deliveredAt?"Delivered":order.status==="COMPLETED"?"Courier has collected the prints":order.deliveryAddress}</p></div>}
      <h3>Order actions</h3>
      <ErrorBox>{error}</ErrorBox>{notice && <p className="success-text" role="status">{notice}</p>}
      {["QUEUED", "ASSIGNED"].includes(order.status) && <form className="assignment-form" onSubmit={event => {
        event.preventDefault(); void mutate({ action: order.status === "QUEUED" ? "assign" : "reassign", printerId: Number(printerId) });
      }}><label className="field"><span>{order.status === "QUEUED" ? "Compatible printer" : "Move to another printer"}</span>
        <select value={printerId} onChange={e => setPrinterId(e.target.value)}><option value="">{available.length ? "Select a printer" : "No compatible idle printer"}</option>
          {available.map(p => <option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}</select></label>
        <button className="button outline" disabled={!printerId || !!busy}>{order.status === "QUEUED" ? "Assign printer" : "Reassign"}</button></form>}
      {order.status === "READY" && <form className="assignment-form" onSubmit={event => { event.preventDefault(); void mutate({ action: "pickup", pin }); }}>
        <label className="field"><span>{order.courier?"Courier collection OTP":"Collection code"}</span><input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric" autoComplete="off" placeholder="Six digits" /></label>
        <button className="button primary" disabled={pin.length !== 6 || !!busy || order.payment !== "PAID"}>Verify pickup</button></form>}
      {!data.shop.demo && order.status === "PRINTING" && <form className="assignment-form" onSubmit={event => {
        event.preventDefault(); void mutate({ action: "progress", value: Number(progress) });
      }}><label className="field"><span>Observed progress (%)</span><input type="number" min={1} max={99} value={progress}
        onChange={e => setProgress(e.target.value)} /></label><button className="button outline" disabled={!progress || !!busy}>Update progress</button></form>}
      {reasonAction && <form className="stack reason-form" onSubmit={event => { event.preventDefault(); void mutate({ action: reasonAction, reason }); }}>
        <label className="field"><span>{reasonAction === "fail" ? "Reason for print failure" : "Reason for cancellation"}</span>
          <textarea maxLength={140} value={reason} onChange={e => setReason(e.target.value)} rows={2} required /></label>
        <div className="inline-actions"><button className="button danger" disabled={reason.trim().length < 3 || !!busy}>
          {reasonAction === "fail" ? "Confirm failure" : "Confirm cancellation"}</button>
          <button type="button" className="button quiet" onClick={() => setReasonAction("")}>Back</button></div></form>}
      <div className="inline-actions command-buttons">
        {order.status === "AWAITING_PAYMENT" && data.shop.demo && order.method === "DEMO" && button("Confirm simulated payment", "settle_demo", true)}
        {order.status === "QUEUED" && !order.acceptedAt && button("Accept order", "accept")}
        {order.status === "ASSIGNED" && button(data.shop.demo ? "Start simulated print" : "Confirm print started", "start", true)}
        {order.status === "PRINTING" && (data.shop.demo ? button("Hold simulation", "hold") : button("Confirm printed", "printed", true))}
        {order.status === "HELD" && button("Resume simulation", "resume", true)}
        {order.status === "FINISHING" && button("Mark ready for pickup", "ready", true)}
        {order.status === "FAILED" && order.privacy === "AVAILABLE" && button("Return to queue", "retry", true)}
        {order.payment === "COUNTER_DUE" && order.status !== "CANCELLED" && button(data.shop.demo ? "Record counter payment" : "Confirm counter payment received", "collect_cash")}
        {order.payment === "REFUND_PENDING" && order.method !== "UPI" && data.user.role === "OWNER" &&
          button(data.shop.demo ? "Record simulated refund" : "Confirm counter refund issued", "refund")}
        {order.payment === "REFUND_PENDING" && order.method === "UPI" && <p className="muted">Issue the refund in Razorpay, then check its status.</p>}
        {["PENDING", "REFUND_PENDING"].includes(order.payment) && order.method === "UPI" &&
          <button className="button outline" onClick={() => void reconcile()} disabled={!!busy}>Check gateway status</button>}
        {!data.shop.demo && order.fileAvailable && <a className="button outline" href={apiPath(shopId, orderApi + "/document")}><Download size={17} /> Download for printing</a>}
        {["ASSIGNED", "PRINTING", "HELD"].includes(order.status) && <button className="button outline" onClick={() => setReasonAction("fail")}>Report failure</button>}
        {!["COMPLETED", "CANCELLED"].includes(order.status) && <button className="text-button danger-text" onClick={() => setReasonAction("cancel")}>Cancel order</button>}
      </div>
      {recent.some(event => eventLabel[event.type]) && <><h3>Recent activity</h3><ol className="timeline">
        {recent.filter(event => eventLabel[event.type]).slice(0, 9).map(event => <li key={event.id}><span className="timeline-dot" />
          <div><strong>{eventLabel[event.type]}</strong><small>{timeLabel(event.at)}{event.payload.simulated ? " · Simulated" : ""}</small></div></li>)}</ol></>}
    </div>
  </Dialog>;
}

function PrinterCard({ printer, data, refresh }: { printer: PrinterData; data: StaffSnapshot; refresh: () => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [config, setConfig] = useState<PrinterConfig>(printer);
  const [offlineReason, setOfflineReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const job = data.orders.find(order => order.id === printer.jobId);
  const queued = data.orders.filter(order => order.status === "QUEUED" && compatible(printer, order.options)).length;
  const nextJob = pickNext(data.orders.filter(order => order.status === "QUEUED"), printer, data.shop.settings, Date.now());
  async function printNext() {
    if (!nextJob || busy) return;
    setBusy(true); setError("");
    try {
      await api(data.shop.id, "staff/orders/" + nextJob.id + "/command", {
        key: commandId(), command: { action: "print_on_idle", printerId: printer.id }
      });
      await refresh();
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  const checkboxes = [["color", "Color"], ["duplex", "Duplex"], ["a3", "A3"], ["premium", "Premium paper"], ["paperLoaded", "Paper loaded"]] as const;
  async function save(online: boolean, updated?: PrinterConfig) {
    setBusy(true); setError("");
    try {
      await api(data.shop.id, "staff/printers/" + printer.id, { online, error: offlineReason || null, config: updated });
      await refresh();
      setEditing(false); setOfflineReason("");
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  return <section className="panel printer-card glass-host">
    <Glass />
    <div className="printer-heading">
      <span className="icon-block" aria-hidden="true"><Printer size={21} /></span>
      <div><h2>{printer.name}</h2><p>{printer.model}{data.shop.demo ? " · Simulated" : ""}</p></div>
      <PrinterBadge printer={printer} />
    </div>
    <div className="printer-tags"><span className="pill neutral">{printer.a3 ? "A4 / A3" : "A4"}</span>
      <span className="pill neutral">{printer.color ? "Color / B&W" : "B&W"}</span><span className="pill neutral">{printer.duplex ? "Duplex" : "Simplex"}</span></div>
    <dl className="detail-grid"><div><dt>Current order</dt><dd>{job?.token ?? "—"}</dd></div>
      <div><dt>Compatible in queue</dt><dd>{queued}</dd></div><div><dt>Est. remaining</dt><dd>{job?.etaMinutes ? "~" + job.etaMinutes + " min" : "—"}</dd></div>
      <div><dt>Rated speed</dt><dd>{printer.ppm} ppm</dd></div></dl>
    {printer.online && !printer.jobId && <button className="button primary" disabled={!nextJob || !printer.paperLoaded || busy} onClick={() => void printNext()}>
      <Printer size={16}/> {nextJob ? (data.shop.demo ? "Print " : "Assign ") + nextJob.token : "No compatible order queued"}
    </button>}
    {printer.error && <ErrorBox>{printer.error}</ErrorBox>}
    <ErrorBox>{error}</ErrorBox>
    {editing && <form className="stack printer-edit" onSubmit={e => { e.preventDefault(); void save(printer.online, config); }}>
      <label className="field"><span>Printer name</span><input required value={config.name} onChange={e => setConfig({ ...config, name: e.target.value })} /></label>
      <label className="field"><span>Model</span><input required value={config.model} onChange={e => setConfig({ ...config, model: e.target.value })} /></label>
      <label className="field"><span>Pages per minute</span><input type="number" min={1} max={250} required value={config.ppm}
        onChange={e => setConfig({ ...config, ppm: Number(e.target.value) })} /></label>
      <div className="form-grid">{checkboxes.map(([key, label]) => <label key={key} className="check-label">
        <input type="checkbox" checked={config[key]} onChange={e => setConfig({ ...config, [key]: e.target.checked })} />{label}</label>)}</div>
      <div className="inline-actions"><button className="button primary" disabled={busy}>Save printer</button>
        <button type="button" className="button quiet" onClick={() => setEditing(false)}>Cancel</button></div>
    </form>}
    {printer.online && <label className="field"><span>Offline reason <small>(optional)</small></span>
      <input maxLength={140} value={offlineReason} onChange={e => setOfflineReason(e.target.value)} placeholder="e.g. Paper jam" /></label>}
    <div className="inline-actions printer-actions">
      <button className="button outline" disabled={busy} onClick={() => void save(!printer.online)}>
        {printer.online ? <CloudOff size={16} /> : <Check size={16} />}{printer.online ? "Take offline" : "Bring online"}</button>
      {data.user.role === "OWNER" && !editing && <button className="button quiet" onClick={() => { setConfig(printer); setEditing(true); }}>
        <SlidersHorizontal size={16} /> Configure</button>}
    </div>
  </section>;
}

function Bars({ values, suffix = "", money = false }: { values: { label: string; value: number }[]; suffix?: string; money?: boolean }) {
  const max = Math.max(1, ...values.map(item => item.value));
  return <div className="bars">{values.map(item => <div className="bar-row" key={item.label}>
    <span>{item.label}</span><div className="bar-track"><div style={{ width: (item.value * 100 / max) + "%" }} /></div>
    <strong>{money ? rupees(item.value) : item.value + suffix}</strong></div>)}</div>;
}

function Analytics({ data }: { data: StaffSnapshot }) {
  const { chart, metrics } = data;
  const peak = Math.max(...chart.hours);
  const peakHour = chart.hours.indexOf(peak);
  const bins = chart.hours.map((value, index) => ({ value, label: String(index).padStart(2, "0") + ":00" }));
  const printers = chart.printers.map(p => ({ value: p.minutes, label: data.printers.find(printer => printer.id === p.id)?.name ?? "Printer " + p.id }));
  return <>
    <PageHeading eyebrow="SHOP PERFORMANCE" title="Analytics" detail={data.shop.demo ? "Calculated from activity in the shop." : "Calculated from shop orders, payments, and print jobs."} />
    <div className="metric-grid">
      <Metric title="Peak demand" value={peakHour} empty={!peak} format={hour => String(hour).padStart(2, "0") + ":00"} detail={peak ? peak + " orders during this hour" : "No orders today"} icon={<Activity size={20} />} tone="purple" />
      <Metric title="Print to ready" value={metrics.processing} unit=" min" detail="Average for collections today" icon={<Clock3 size={20} />} tone="blue" />
      <Metric title="Queue wait" value={metrics.wait} unit=" min" detail="Average before printing" icon={<ListOrdered size={20} />} tone="green" />
      <Metric title="Failed / reprints" value={metrics.failed} secondaryValue={metrics.retries} detail="Today’s orders" icon={<CircleAlert size={20} />} tone="red" />
    </div>
    <div className="chart-grid">
      <section className="panel chart"><h2>Orders per hour</h2><p>Today · India Standard Time</p>
        <div className="hour-chart" role="img" aria-label={bins.map(bin => bin.label + " " + bin.value + " orders").join(", ")}>
          {bins.map((bin, index) => <div key={bin.label} title={bin.label + " • " + bin.value + " orders"}>
            <span style={{ height: Math.max(3, bin.value * 100 / Math.max(1, peak)) + "%" }} />
            {index % 4 === 0 && <small>{bin.label.slice(0, 2)}</small>}</div>)}</div>
      </section>
      <section className="panel chart"><h2>Revenue by day</h2><p>Last seven days · collected payments</p>
        <Bars values={chart.days.map(day => ({ label: dateLabel(day.date + "T12:00:00+05:30"), value: day.total }))} money /></section>
      <section className="panel chart"><h2>Service demand</h2><p>Orders placed today</p>
        <Bars values={[{ label: "Normal", value: chart.normal }, { label: "Express", value: chart.express }]} /></section>
      <section className="panel chart"><h2>Printer utilization</h2><p>Print minutes from jobs started today</p><Bars values={printers} suffix=" min" /></section>
      <section className="panel chart"><h2>Revenue by service</h2><p>Collected payments today</p>
        <Bars values={[{ label: "Normal", value: chart.service.normal }, { label: "Express", value: chart.service.express }]} money /></section>
    </div>
  </>;
}

const numericSettings = [
  ["bw", "B&W per page"], ["color", "Color per page"], ["a3", "A3 per sheet"], ["premium", "Premium paper per sheet"],
  ["staple", "Stapling per copy"], ["bind", "Binding per copy"], ["priority", "Express fee"],
] as const;
const policySettings = [["expressLimit", "Maximum active Express orders"], ["normalWait", "Normal wait target (minutes)"],
  ["expressBurst", "Max Express jobs before a waiting Normal job"], ["duplexDiscount", "Duplex discount (%)"],
  ["discount", "Order discount (%)"], ["tax", "Tax (%)"]] as const;
function ShopSettings({ data, refresh, onQr }: { data: StaffSnapshot; refresh: () => Promise<unknown>; onQr: () => void }) {
  const [form, setForm] = useState(data.shop.settings);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const signature = JSON.stringify(data.shop.settings);
  useEffect(() => { if (!dirty) setForm(JSON.parse(signature) as Settings); }, [signature, dirty]);
  function set<Key extends keyof Settings>(key: Key, value: Settings[Key]) {
    setForm(previous => ({ ...previous, [key]: value })); setDirty(true); setSaved(false);
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setSaved(false);
    try { await api(data.shop.id, "staff/settings", form); await refresh(); setDirty(false); setSaved(true); }
    catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  return <>
    <PageHeading eyebrow="SHOP ADMINISTRATION" title="Shop settings" detail="Set shop availability, pricing, and queue policy."
      action={<button className="button outline" onClick={onQr}><QrCode size={18} /> Shop QR code</button>} />
    <form className="settings-grid" onSubmit={save}>
      <section className="panel settings-card"><h2>Shop profile</h2><div className="form-grid">
        <label className="field"><span>Shop name</span><input value={form.name} maxLength={80} required onChange={e => set("name", e.target.value)} /></label>
        <label className="field"><span>Address</span><input value={form.address} maxLength={140} required onChange={e => set("address", e.target.value)} /></label>
        {([["open", "Accept new orders"], ["automatic", "Automatically assign compatible printers"], ["counter", "Enable pay at counter"],
          ["express", "Offer Express service"], ["stapleEnabled", "Offer stapling"], ["bindEnabled", "Offer binding"]] as const).map(([key, label]) =>
          <label className="check-label" key={key}><input type="checkbox" checked={form[key]} onChange={e => set(key, e.target.checked)} />{label}</label>)}
      </div></section>
      <section className="panel settings-card"><h2>Pricing in rupees</h2><div className="form-grid">
        {numericSettings.map(([key, label]) => <label className="field" key={key}><span>{label}</span>
          <input type="number" min={0} max={1000} step="0.01" required value={form[key] / 100}
            onChange={e => set(key, Math.round(Number(e.target.value) * 100))} /></label>)}
      </div></section>
      <section className="panel settings-card"><h2>Queue and discounts</h2><div className="form-grid">
        {policySettings.map(([key, label], index) => <label className="field" key={key}><span>{label}</span>
          <input type="number" min={index < 3 ? 1 : 0} max={[30, 120, 10, 100, 100, 100][index]} required value={form[key]} onChange={e => set(key, Number(e.target.value))} /></label>)}
      </div></section>
      <div className="settings-actions"><ErrorBox>{error}</ErrorBox>{saved && <p className="success-text" role="status">Settings saved.</p>}
        <button className="button primary" disabled={!dirty || busy}>{busy ? "Saving…" : "Save settings"}</button></div>
    </form>
  </>;
}

function ShopQr({ shopId, shopName, onClose }: { shopId: string; shopName: string; onClose: () => void }) {
  const [image, setImage] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const link = location.origin + "/shop/" + encodeURIComponent(shopId);
    setUrl(link);
    void QRCode.toDataURL(link, { width: 360, margin: 3, errorCorrectionLevel: "M" }).then(setImage).catch(failure => setError(message(failure)));
  }, [shopId]);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); }
    catch { setError("Copy the shop URL from the field below."); }
  }
  return <Dialog title="Shop QR code" onClose={onClose}><div className="qr-body">
    <p>{shopName}</p>{image && /* eslint-disable-next-line @next/next/no-img-element */ <img width={260} height={260} src={image} alt="QR code for this shop’s ordering page" />}
    <label className="field"><span>Customer order link</span><input readOnly value={url} onFocus={event => event.currentTarget.select()} /></label>
    {/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url) && <p className="muted">Use the shop’s network or public address to scan this code from another device.</p>}
    <div className="inline-actions">{image && <a className="button primary" download={shopId + "-qr.png"} href={image}><Download size={17} /> Save QR code</a>}
      <button className="button outline" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button></div><ErrorBox>{error}</ErrorBox>
  </div></Dialog>;
}
