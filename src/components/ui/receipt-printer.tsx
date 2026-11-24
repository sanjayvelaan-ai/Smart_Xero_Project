"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { CircleCheck, House, LoaderCircle, Printer, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { brandName } from "@/lib/brand";

export type ReceiptPrinterStage = "processing" | "printing" | "complete";
const feedDuration = 1750;

export function ReceiptPrinter({
  paid, busy, status, reference, amount, home, children, className, controls,
}: {
  paid: boolean;
  busy?: boolean;
  status: string;
  reference: string;
  amount: string;
  home: string;
  children?: ReactNode;
  className?: string;
  controls?: ReactNode;
}) {
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (!paid) { setFinished(false); return; }
    if (finished) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setFinished(true); return; }
    const timer = window.setTimeout(() => setFinished(true), feedDuration);
    return () => window.clearTimeout(timer);
  }, [paid, finished]);

  const feeding = paid && !finished;
  const stage: ReceiptPrinterStage = paid ? (feeding ? "printing" : "complete") : "processing";
  return <section className={cn("receipt-printer", className)} aria-label="Receipt printer" data-stage={stage}>
    <div className="receipt-machine">
      <div className="receipt-machine-header">
        <span><Printer size={17} aria-hidden="true" /> {brandName}</span>
        <div className="receipt-tools">{paid && <button type="button" className="receipt-home" disabled={feeding}
          onClick={() => setFinished(false)} aria-label="Replay receipt animation"><RotateCcw size={14} /> Replay</button>}
          <Link href={home} className="receipt-home"><House size={14} aria-hidden="true" /> Home</Link></div>
      </div>
      <div className="receipt-machine-screen">
        <div className="receipt-machine-order">
          <div><strong>Print order</strong><small>{reference}</small></div>
          <strong>{amount}</strong>
        </div>
        <div className="receipt-machine-status" role="status">
          {stage === "complete" ? <CircleCheck size={16} aria-hidden="true" /> :
            (feeding || busy) ? <LoaderCircle className="receipt-spinner" size={16} aria-hidden="true" /> :
              <span className="receipt-status-light" aria-hidden="true" />}
          {feeding ? "Printing your receipt…" : status}
        </div>
        {controls}
      </div>
      <div className="receipt-slot" aria-hidden="true" />
    </div>
    {paid && <div className="receipt-output" style={{ animationDuration: feedDuration + "ms" }}>
      <div className="receipt-feed">
        <article className="receipt-paper">
          {children}
        </article>
      </div>
    </div>}
  </section>;
}
