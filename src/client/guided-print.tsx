"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import {
  defaultOptions,
  type Order,
  type Price,
  type StaffSnapshot,
} from "../domain";
import { api, apiPath, commandId, demoShop, ErrorBox, message } from "./shared";

type Tour = { key: string; document?: string; id?: string; token?: string };
const storage = "printflow-guided-demo";
export function GuidedPrint() {
  const [tour, setTour] = useState<Tour | null>(null),
    [running, setRunning] = useState(false),
    [note, setNote] = useState(""),
    [error, setError] = useState("");
  const active = useRef(false);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storage);
      if (saved) setTour(JSON.parse(saved));
    } catch {}
  }, []);
  useEffect(() => {
    if (!tour || !running) return;
    let cancelled = false;
    const current = tour;
    function remember() {
      sessionStorage.setItem(storage, JSON.stringify(current));
    }
    const delay = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    async function tick() {
      if (active.current) return;
      active.current = true;
      try {
        while (!cancelled) {
          if (!current.document) {
            setNote("Uploading a sample handout…");
            const sample = await fetch(apiPath(demoShop, "sample"));
            if (!sample.ok) throw new Error("Sample file is unavailable.");
            if (cancelled) return;
            const upload = await fetch(apiPath(demoShop, "documents"), {
              method: "POST",
              headers: { "X-File-Name": "Guided handout.pdf" },
              body: await sample.blob(),
            });
            const result = await upload.json();
            if (!upload.ok) throw new Error(result.error);
            current.document = result.id;
            remember();
          } else if (!current.id) {
            const input = {
              documentId: current.document,
              options: defaultOptions,
              mode: "NORMAL",
            };
            const quote = await api<{ price: Price }>(demoShop, "quote", input);
            if (cancelled) return;
            const order = await api<Order>(demoShop, "orders", {
              ...input,
              key: current.key,
              confirmedTotal: quote.price.total,
              method: "DEMO",
            });
            current.id = order.id;
            current.token = order.token;
            remember();
            setNote(order.token + " received");
          } else {
            const { order } = await api<{ order: Order }>(
              demoShop,
              "orders/" + current.id,
            );
            if (cancelled) return;
            const command = (body: Record<string, unknown>) =>
              api(demoShop, "staff/orders/" + order.id + "/command", {
                key: commandId(),
                command: body,
              });
            switch (order.status) {
              case "AWAITING_PAYMENT":
                await api(demoShop, "orders/" + order.id + "/demo-payment", {});
                setNote(order.token + " · Demo payment verified");
                break;
              case "QUEUED": {
                const data = await api<StaffSnapshot>(demoShop, "staff");
                if (cancelled) return;
                const printer =
                  data.printers.find(
                    (p) => p.online && p.paperLoaded && !p.jobId && !p.color,
                  ) ??
                  data.printers.find(
                    (p) => p.online && p.paperLoaded && !p.jobId,
                  );
                if (printer && !data.shop.settings.automatic) {
                  await command({ action: "assign", printerId: printer.id });
                  setNote("Assigned to " + printer.name);
                } else setNote("Waiting for an available printer");
                break;
              }
              case "ASSIGNED":
                await command({ action: "start" });
                setNote(order.token + " · Simulated printing");
                break;
              case "PRINTING":
                setNote(order.token + " · Printing " + order.progress + "%");
                break;
              case "FINISHING":
                await delay(3300);
                if (cancelled) return;
                await command({ action: "ready" });
                setNote("Papers ready at the collection counter");
                break;
              case "READY":
                await delay(2000);
                if (cancelled) return;
                await command({ action: "pickup", pin: order.pickupPin });
                setNote("Collection verified");
                break;
              case "COMPLETED":
              case "CANCELLED":
                sessionStorage.removeItem(storage);
                setNote(order.token + " · " + order.status.toLowerCase());
                setTour(null);
                setRunning(false);
                return;
              default:
                throw new Error(
                  "This order needs attention in the owner dashboard.",
                );
            }
          }
          await delay(2300);
        }
      } catch (failure) {
        if (!cancelled) {
          setError(message(failure));
          setRunning(false);
        }
      } finally {
        active.current = false;
      }
    }
    // A previous step may still be settling after a pause. Resume only after it releases ownership.
    const interval = window.setInterval(() => {
      if (!active.current) void tick();
    }, 300);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tour, running]);
  return (
    <div className="guided-print">
      <button
        className="button outline small"
        onClick={() => {
          setError("");
          if (running) {
            setRunning(false);
            setNote("Guided steps paused");
            return;
          }
          if (!tour) {
            setTour({ key: commandId() });
            setNote("Preparing sample order");
          }
          setRunning(true);
        }}
      >
        {running ? <Pause size={14} /> : <Play size={14} />}{" "}
        {running
          ? "Pause guided order"
          : tour
            ? "Resume guided order"
            : "Run guided order"}
      </button>
      {note && <p role="status">{note}</p>}
      <ErrorBox>{error}</ErrorBox>
    </div>
  );
}
