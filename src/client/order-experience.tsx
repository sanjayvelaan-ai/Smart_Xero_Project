"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import {
  Bike,
  FileText,
  PackageCheck,
  Pause,
  Play,
  Printer,
} from "lucide-react";
import { rupees, type ShopEvent, type Order, type Status } from "../domain";
import { ReceiptPrinter } from "@/components/ui/receipt-printer";
import { brandName } from "@/lib/brand";
import { api, customerPath, ErrorBox, Logo, message, orderPath, WorkspaceSwitch } from "./shared";

export function PaymentQR({
  shop,
  reference,
}: {
  shop: string;
  reference: string;
}) {
  const path = "/payment/" + reference + "?shop=" + encodeURIComponent(shop);
  const [image, setImage] = useState("");
  useEffect(() => {
    let active = true;
    setImage("");
    void QRCode.toDataURL(location.origin + path, { width: 192, margin: 3 })
      .then((url) => {
        if (active) setImage(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [path]);
  return (
    <section className="pay-qr">
      {image && (
        <img
          src={image}
          width={144}
          height={144}
          alt="QR for this simulated print payment"
        />
      )}
      <div>
        <strong>Scan to pay · simulation</strong>
        <p>
          Open the code on a device that can reach this shop, then confirm
          payment.
        </p>
        <a className="text-button" href={path}>
          Open payment page
        </a>
      </div>
    </section>
  );
}
type Payment = {
  token: string;
  total: number;
  paid: boolean;
  available: boolean;
  canTrack: boolean;
};
export function PaymentPage({
  shop,
  reference,
}: {
  shop: string;
  reference: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<Payment | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [returnToken, setReturnToken] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    api<Payment>(shop, "pay/" + reference, undefined, abort.signal)
      .then(setData)
      .catch((e) => {
        if (!abort.signal.aborted) setError(message(e));
      });
    return () => abort.abort();
  }, [shop, reference]);
  useEffect(() => {
    if (!returnToken) return;
    const timer = window.setTimeout(() => router.replace(orderPath(shop, returnToken)), 4400);
    return () => window.clearTimeout(timer);
  }, [returnToken, router, shop]);
  async function pay() {
    setBusy(true);
    setError("");
    try {
      const payment = await api<Payment>(shop, "pay/" + reference, {});
      setData(payment);
      if (payment.paid && payment.canTrack) setReturnToken(payment.token);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="customer-shell">
      <header className="customer-nav"><div className="nav-inner">
        <Logo href={customerPath(shop)} /><WorkspaceSwitch shop={shop} active="customer" />
        <span className="pill nav-mode">Customer portal</span>
      </div></header>
      <main className="payment-screen receipt-payment">
        <header><h1>{brandName} payment</h1><p>Simulated transaction · no money is transferred</p></header>
        <ErrorBox>{error}</ErrorBox>
        {data ? <ReceiptPrinter paid={data.paid} busy={busy} reference={data.token} amount={rupees(data.total)}
          home={customerPath(shop)}
          status={data.paid ? "Payment confirmed" : busy ? "Confirming payment…" : data.available ? "Awaiting payment" : "This payment link is closed."}
          controls={!data.paid && data.available && <button disabled={busy} className="button primary" onClick={() => void pay()}>
            Confirm simulated payment
          </button>}>
          <div className="summary-content">
            <header className="receipt-paper-heading"><h2>Payment receipt</h2><p>{brandName} · Simulated payment</p></header>
            <dl className="receipt-order-meta"><div><dt>Order</dt><dd>{data.token}</dd></div></dl>
            <div className="summary-total"><span>Total paid</span><strong>{rupees(data.total)}</strong></div>
            {!data.canTrack && <p className="summary-eta">Track your prints on the device you ordered from.</p>}
          </div>
        </ReceiptPrinter> : !error && <p role="status">Loading payment…</p>}
        <div className="receipt-payment-links">
          {data?.canTrack && <Link className="button outline" href={orderPath(shop, data.token)}>Back to order tracking</Link>}
          <Link className="back-link" href={customerPath(shop) + "#my-orders"}>Back to dashboard</Link>
        </div>
      </main>
    </div>
  );
}
const label: Record<Status, string> = {
  SCHEDULED: "Booked for later",
  AWAITING_PAYMENT: "Waiting for payment",
  QUEUED: "In the print queue",
  ASSIGNED: "Printer assigned",
  PRINTING: "Printing your pages",
  HELD: "Printing paused",
  FINISHING: "Preparing your prints",
  READY: "Ready at the counter",
  COMPLETED: "Collected",
  CANCELLED: "Cancelled",
  FAILED: "Printer needs attention",
};
const statusEvent: Partial<Record<ShopEvent["type"], Status>> = {
  ORDER_SCHEDULED: "SCHEDULED",
  ORDER_CREATED: "AWAITING_PAYMENT",
  ORDER_QUEUED: "QUEUED",
  PRINTER_ASSIGNED: "ASSIGNED",
  PRINT_STARTED: "PRINTING",
  PRINT_PROGRESS_UPDATED: "PRINTING",
  PRINT_COMPLETED: "FINISHING",
  PRINT_HELD: "HELD",
  PRINT_FAILED: "FAILED",
  ORDER_READY_FOR_PICKUP: "READY",
  ORDER_COMPLETED: "COMPLETED",
  ORDER_CANCELLED: "CANCELLED",
};
export function Journey({
  order,
  events,
}: {
  order: Order;
  events: ShopEvent[];
}) {
  const [frame, setFrame] = useState<number | null>(null);
  const steps = events
    .filter((e) => statusEvent[e.type] || e.type === "DELIVERY_RECEIVED")
    .slice()
    .sort((a, b) => a.sequence - b.sequence);
  useEffect(() => {
    if (frame === null) return;
    const timer = setTimeout(
      () => setFrame(frame + 1 >= steps.length ? null : frame + 1),
      1400,
    );
    return () => clearTimeout(timer);
  }, [frame, steps.length]);
  const event = frame !== null ? steps[frame] : undefined,
    status = event ? (statusEvent[event.type] ?? "COMPLETED") : order.status;
  const delivered = event
    ? event.type === "DELIVERY_RECEIVED"
    : !!order.deliveredAt;
  const Icon =
    order.courier && status === "COMPLETED"
      ? Bike
      : status === "PRINTING"
        ? Printer
        : ["READY", "COMPLETED", "FINISHING"].includes(status)
          ? PackageCheck
          : FileText;
  const caption =
    status === "COMPLETED" && order.courier
      ? delivered
        ? "Delivered at home"
        : "Courier on the way"
      : label[status];
  return (
    <div className={"journey journey-" + status.toLowerCase()}>
      <div className="journey-art">
        <Icon size={40} />
        <i />
        <b />
      </div>
      <div>
        <small>
          {frame === null
            ? "Your print journey"
            : "Replaying recorded activity"}
        </small>
        <strong>{caption}</strong>
        {steps.length > 1 && (
          <button
            className="text-button"
            onClick={() => setFrame(frame === null ? 0 : null)}
          >
            {frame === null ? <Play size={13} /> : <Pause size={13} />}{" "}
            {frame === null ? "Replay progress" : "Return to current status"}
          </button>
        )}
      </div>
    </div>
  );
}
