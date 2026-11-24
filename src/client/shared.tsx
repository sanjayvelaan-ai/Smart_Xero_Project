"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { LiquidNavbar, type LiquidNavItem } from "@/components/ui/liquid-glass-navbar";
import { ThemeSwitch, useAppearance } from "@/components/glass/appearance";
import { AlertCircle, Box, CircleDot, FileText, LayoutDashboard, LoaderCircle, Printer, Zap } from "lucide-react";
import { statusLabel, type Mode, type Status } from "@/domain";
import { brandName } from "@/lib/brand";

export const demoShop = "printflow-demo";
export const liveShop = "velachery";
export const twinPath = (shop: string) => "/digital-twin" + (shop === demoShop ? "" : "?shop=" + encodeURIComponent(shop));
export function orderWorkspace(path: string, id: string) {
  return path + (path.includes("?") ? "&" : "?") + "order=" + encodeURIComponent(id);
}
export function WorkspaceSwitch({ shop, active }: { shop: string; active?: "customer" | "owner" | "twin" }) {
  const { dark } = useAppearance();
  const items: LiquidNavItem[] = [
    { href: customerPath(shop), icon: <FileText size={16} />, label: "Customer portal", fx: "glow" },
    { href: ownerPath(shop), icon: <LayoutDashboard size={16} />, label: "Owner dashboard", fx: "pop" },
    { href: twinPath(shop), icon: <Box size={16} />, label: "Live 3D shop", fx: "spin" },
  ];
  return <LiquidNavbar label="Workspaces" tone={dark ? "dark" : "light"} trailing={<ThemeSwitch />} className="workspace-nav" compact={false}
    active={active ? ["customer", "owner", "twin"].indexOf(active) : -1} items={items} />;
}
export const apiPath = (shop: string, path = "") => "/api/shops/" + encodeURIComponent(shop) + (path ? "/" + path : "");
export const customerPath = (shop: string) => shop === demoShop ? "/customer" : "/shop/" + encodeURIComponent(shop);
export const orderPath = (shop: string, order: string) => "/customer/orders/" + encodeURIComponent(order) +
  (shop === demoShop ? "" : "?shop=" + encodeURIComponent(shop));
export const ownerPath = (shop: string, section = "") => "/owner" + (section ? "/" + section : "") +
  (shop === demoShop ? "" : "?shop=" + encodeURIComponent(shop));

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export async function api<T>(shop: string, path = "", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiPath(shop, path), {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal, cache: "no-store",
  });
  if (!response.ok) {
    const value = await response.json().catch(() => ({}));
    throw new ApiError(value.error ?? (brandName + " is temporarily unavailable."), response.status);
  }
  return response.json();
}

export function useFeed<T>(shop: string, path: string, staff = false, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [generation, setGeneration] = useState(0);
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    active.current?.abort();
    const abort = new AbortController();
    active.current = abort;
    try {
      const next = await api<T>(shop, path, undefined, abort.signal);
      if (!abort.signal.aborted) { setData(next); setError(""); }
      return next;
    } catch (error) {
      if (!abort.signal.aborted) {
        setError(message(error));
        if (error instanceof ApiError && error.status === 401) setData(null);
      }
    }
  }, [shop, path]);
  useEffect(() => {
    setData(null);
    setError("");
    setConnected(false);
    if (!enabled) return;
    void refresh();
    const source = new EventSource(apiPath(shop, staff ? "staff/live" : "live"));
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener("change", () => { void refresh(); });
    function resume() { if (document.visibilityState !== "hidden") void refresh(); }
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    const retry = window.setInterval(resume, 15000);
    return () => {
      active.current?.abort();
      source.close();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.clearInterval(retry);
    };
  }, [shop, staff, enabled, refresh, generation]);
  return { data, error, connected, refresh, reconnect: () => setGeneration(value => value + 1) };
}

export const message = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";
export function commandId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}
export const timeLabel = (value: string) => new Intl.DateTimeFormat("en-IN", {
  hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata",
}).format(new Date(value));
export const dateLabel = (value: string) => new Intl.DateTimeFormat("en-IN", {
  day: "numeric", month: "short", timeZone: "Asia/Kolkata",
}).format(new Date(value));

export function Logo({ href = "/customer" }: { href?: string }) {
  return <Link href={href} className="logo" aria-label={brandName + " home"}>
    <span className="brand-icon" aria-hidden="true"><Printer size={23} strokeWidth={2.3} /></span>
    <span>{brandName}</span>
  </Link>;
}

export function ModeBadge({ mode }: { mode: Mode }) {
  return <span className={"pill " + (mode === "EXPRESS" ? "amber" : "neutral")}>
    {mode === "EXPRESS" ? <Zap size={13} /> : <FileText size={13} />}
    {mode === "EXPRESS" ? "Express" : "Normal"}
  </span>;
}

export function StatusBadge({ status }: { status: Status }) {
  const tone = ["READY", "COMPLETED"].includes(status) ? "green" : ["FAILED", "CANCELLED"].includes(status) ? "red" :
    ["PRINTING", "ASSIGNED"].includes(status) ? "purple" : ["HELD", "FINISHING", "AWAITING_PAYMENT"].includes(status) ? "amber" : "blue";
  return <span className={"pill " + tone}><CircleDot size={12} />{statusLabel[status]}</span>;
}

export function ErrorBox({ children }: { children?: ReactNode }) {
  return children ? <p className="form-error" role="alert"><AlertCircle size={17} />{children}</p> : null;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="loading" role="status"><LoaderCircle className="spin" size={25} />{label}</div>;
}

export function Empty({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty">
    <span className="icon-block purple"><FileText size={23} /></span>
    <strong>{title}</strong><p>{detail}</p>{action}
  </div>;
}

export function toggleNotifications() {
  if (typeof Notification === "undefined") return Promise.resolve("unsupported");
  return Notification.requestPermission();
}

export function notify(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted" || document.visibilityState !== "hidden") return;
  try { new Notification(title, { body }); } catch { /* Delivery varies by browser. */ }
}
