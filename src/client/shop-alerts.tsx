"use client";
import { useEffect, useRef, useState } from "react";
import { Bell, Bike, CheckCircle2, Clock3, X } from "lucide-react";
import { eventLabel, type EventType, type ShopEvent } from "../domain";
import { notify, timeLabel } from "./shared";

const signals = new Set<EventType>(["COLLECTION_REMINDER", "WAIT_ALERT", "COURIER_WAIT", "COURIER_ARRIVED", "PRINT_COMPLETED", "ORDER_COMPLETED", "PAYMENT_CONFIRMED", "ORDER_SCHEDULED", "PRINT_FAILED"]);
export const isShopSignal = (event: ShopEvent) => signals.has(event.type);

export function ShopAlerts({ events }: { events: ShopEvent[] }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<ShopEvent | null>(null);
  const last = useRef<number | null>(null);
  const notices = events.filter(isShopSignal).sort((a,b) => b.sequence - a.sequence);
  useEffect(() => {
    const latest = events.filter(isShopSignal).reduce<ShopEvent | undefined>((newest, e) =>
      !newest || e.sequence > newest.sequence ? e : newest, undefined);
    if (latest && last.current !== null && latest.sequence > last.current) {
      setCurrent(latest);
      notify(latest.payload.token ?? "Shop update", eventLabel[latest.type] ?? latest.type);
    }
    last.current = Math.max(last.current ?? 0, latest?.sequence ?? 0);
  }, [events]);
  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => setCurrent(null), 7000);
    return () => clearTimeout(timer);
  }, [current]);
  return <div className="shop-alerts">
    <button className="button outline small" aria-expanded={open} onClick={() => setOpen(!open)}><Bell size={16}/> Shop alerts</button>
    {open && <section className="signal-menu" aria-label="Recent shop alerts"><strong>Recent shop alerts</strong>
      {notices.length === 0 && <p>No recent alerts.</p>}
      {notices.slice(0,12).map(e => <Signal key={e.id} event={e}/>)}</section>}
    {current && !open && <div className="signal-toast" role="status"><Signal event={current}/><button aria-label="Dismiss shop alert" onClick={() => setCurrent(null)}><X size={16}/></button></div>}
  </div>;
}
function Signal({event}: {event: ShopEvent}) {
  const warning = ["WAIT_ALERT","COURIER_WAIT","COLLECTION_REMINDER","PRINT_FAILED"].includes(event.type);
  const Icon = warning ? Clock3 : event.type === "COURIER_ARRIVED" ? Bike : CheckCircle2;
  return <div className={"signal-row" + (warning ? " attention" : "")}><Icon size={19}/>
    <div><strong>{eventLabel[event.type] ?? event.type}</strong><small>{event.payload.token} · {timeLabel(event.at)}</small></div></div>;
}
