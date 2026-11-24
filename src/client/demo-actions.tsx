"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { FilePlus2, Play, Zap } from "lucide-react";
import { defaultOptions, type Order, type Price } from "@/domain";
import { api, apiPath, commandId, demoShop, ErrorBox, message, ModeBadge, orderPath } from "./shared";

const examples = [
  { name: "Semester assignment", pages: 20, mode: "NORMAL", options: defaultOptions },
  { name: "Urgent handout", pages: 4, mode: "EXPRESS", options: { ...defaultOptions, duplex: true } },
  { name: "Color handout", pages: 4, mode: "NORMAL", options: { ...defaultOptions, color: "COLOR" } },
] as const;

export function DemoActions() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const running = useRef(false);
  const current = useRef<{
    index: number; key: string; documentId?: string; order?: Order;
  }>({ index: 0, key: "" });
  async function populate() {
    if (running.current) return;
    running.current = true;
    setError("");
    try {
      while (current.current.index < examples.length) {
        const job = current.current;
        const example = examples[job.index];
        setProgress("Creating " + example.name.toLowerCase() + "…");
        job.key ||= commandId();
        if (!job.documentId) {
          const sample = await fetch(apiPath(demoShop, "sample?pages=" + example.pages));
          if (!sample.ok) throw new Error("Sample documents are unavailable.");
          const uploaded = await fetch(apiPath(demoShop, "documents"), {
            method: "POST", body: await sample.blob(),
            headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(example.name + ".pdf") },
          });
          const result = await uploaded.json();
          if (!uploaded.ok) throw new Error(result.error ?? "Could not upload a sample document.");
          job.documentId = result.id;
        }
        if (!job.order) {
          const input = { documentId: job.documentId, options: example.options, mode: example.mode };
          const quote = await api<{ price: Price }>(demoShop, "quote", input);
          job.order = await api<Order>(demoShop, "orders", { ...input, key: job.key, method: "DEMO", confirmedTotal: quote.price.total });
        }
        await api(demoShop, "orders/" + job.order.id + "/demo-payment", {});
        setOrders(previous => [...previous, job.order!]);
        current.current = { index: job.index + 1, key: "" };
      }
    } catch (failure) {
      setError(message(failure));
    } finally {
      setProgress("");
      running.current = false;
    }
  }
  return <section className="panel demo-generator">
    <div className="wizard-title"><span className="icon-block purple"><FilePlus2 size={22} /></span>
      <div><h2>Create sample orders</h2><p>Send a 20-page assignment, an Express handout, and a color job to the demo queue.</p></div></div>
    <button className="button primary" disabled={Boolean(progress) || orders.length === examples.length} onClick={() => void populate()}>
      <Play size={17} /> {orders.length === examples.length ? "Sample orders created" : orders.length ? "Continue creating sample orders" : "Generate sample orders"}
    </button>
    {progress && <p className="muted" role="status">{progress}</p>}
    <ErrorBox>{error}</ErrorBox>
    {orders.length > 0 && <div className="demo-orders">{orders.map(order => <Link key={order.id} href={orderPath(demoShop, order.token)}>
      <strong>{order.token}</strong><ModeBadge mode={order.mode} /> {order.mode === "EXPRESS" && <Zap size={14} className="text-violet-600" />}
    </Link>)}</div>}
  </section>;
}
