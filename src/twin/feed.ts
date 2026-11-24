"use client";
import { useEffect, useState } from "react";
import { api, apiPath, ApiError, message } from "../client/shared";
import type { ShopEvent } from "../domain";
import { orderedEvents, type Snapshot } from "./state";
export type RecordSet = { snapshot: Snapshot; events: ShopEvent[] };
export function useTwinFeed(shop: string) {
  const [records, setRecords] = useState<RecordSet | null>(null),
    [error, setError] = useState(""),
    [online, setOnline] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let disposed = false,
      busy = false,
      again = false,
      records: RecordSet | null = null,
      source: EventSource | undefined;
    const abort = new AbortController();
    setRecords(null);
    setError("");
    setOnline(false);
    setNeedsLogin(false);
    async function refresh() {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        do {
          again = false;
          const snap = await api<Snapshot>(
            shop,
            "staff/projection",
            undefined,
            abort.signal,
          );
          let sequence = records?.snapshot.sequence ?? 0;
          const tail: ShopEvent[] = [];
          while (sequence < snap.sequence) {
            const batch = await api<ShopEvent[]>(
              shop,
              "staff/events?after=" + sequence,
              undefined,
              abort.signal,
            );
            const end = batch.at(-1)?.sequence;
            if (!end || end <= sequence)
              throw new Error(
                "Shop history is temporarily incomplete. Reconnecting…",
              );
            tail.push(...batch.filter((e) => e.sequence <= snap.sequence));
            sequence = end;
          }
          if (disposed) return;
          if (!records || snap.sequence !== records.snapshot.sequence) {
            records = {
              snapshot: snap,
              events: orderedEvents(records?.events ?? [], tail),
            };
            setRecords(records);
          }
          setError("");
          setNeedsLogin(false);
          if (!source) {
            source = new EventSource(
              apiPath(shop, "staff/live?after=" + snap.sequence),
            );
            source.onopen = () => {
              if (!disposed) {
                setOnline(true);
                void refresh();
              }
            };
            source.onerror = () => {
              if (!disposed) setOnline(false);
            };
            source.addEventListener("change", () => void refresh());
          }
        } while (again && !disposed);
      } catch (failure) {
        if (!disposed) {
          setError(message(failure));
          if (
            failure instanceof ApiError &&
            [401, 403].includes(failure.status)
          ) {
            setNeedsLogin(true);
            source?.close();
            source = undefined;
            records = null;
            setRecords(null);
            setOnline(false);
          }
        }
      } finally {
        busy = false;
      }
    }
    void refresh();
    const wake = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    const timer = window.setInterval(wake, 15000);
    return () => {
      disposed = true;
      abort.abort();
      source?.close();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [shop, generation]);
  return {
    records: records?.snapshot.shopId === shop ? records : null,
    needsLogin,
    error,
    online,
    reconnect: () => setGeneration((g) => g + 1),
  };
}
