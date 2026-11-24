"use client";
import { ShopAlerts } from "./shop-alerts";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Box,
  Camera as CameraIcon,
  ChevronDown,
  Expand,
  History,
  Pause,
  Play,
  Printer,
  Radio,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { rupees, statusLabel, paymentLabel } from "../domain";
import {
  api, message, orderPath, customerPath,
  orderWorkspace,
  ErrorBox,
  Loading,
  Logo,
  ModeBadge,
  ownerPath,
  StatusBadge,
  timeLabel,
  twinPath,
  WorkspaceSwitch,
} from "./shared";
import { StaffLogin } from "./owner";
import { useTwinFeed, type RecordSet } from "../twin/feed";
import {
  cameras,
  eventTitle,
  filmDuration,
  liveFloor,
  replayFloor,
  type Camera,
  type Selection,
} from "../twin/state";
import type { ShopScene } from "../twin/scene";

// Keep one live room warm across same-tab workspace switches. No render loop runs while detached.
type RetainedRoom = {
  shop: string;
  scene: ShopScene;
  sequence: number;
  timer: number;
  view: Camera;
  auto: boolean;
  low: boolean;
};
let retained: RetainedRoom | undefined;
function discardRoom() {
  if (retained) {
    clearTimeout(retained.timer);
    retained.scene.dispose();
    retained = undefined;
  }
}
type ReplayEntry = { id: string; through?: number };
export function TwinPage({
  shop,
  initialOrder,
  initialReplay,
  prototypeLogin,
}: {
  prototypeLogin: boolean;
  initialReplay?: ReplayEntry;
  shop: string;
  initialOrder?: string;
}) {
  const feed = useTwinFeed(shop);
  useEffect(() => {
    if (!feed.records && feed.error) discardRoom();
  }, [feed.records, feed.error]);
  if (!feed.records && feed.needsLogin)
    return (
      <StaffLogin
        shopId={shop}
        prototypeLogin={prototypeLogin}
        twin
        initialError={feed.error}
        onSignIn={async () => feed.reconnect()}
      />
    );
  if (!feed.records && feed.error)
    return (
      <main className="panel single-page">
        <WorkspaceSwitch shop={shop} active="twin" />
        <h1>Shop floor unavailable</h1>
        <ErrorBox>{feed.error}</ErrorBox>
        <button className="button outline" onClick={feed.reconnect}>
          Reconnect
        </button>
      </main>
    );
  if (!feed.records)
    return <Loading label="Restoring the shop floor and event history…" />;
  if (
    initialReplay &&
    initialReplay.id !== "all" &&
    !feed.records.snapshot.catalog.some((o) => o.id === initialReplay.id)
  ) {
    return (
      <main className="single-page panel">
        <h1>Order replay unavailable</h1>
        <p>This reference does not belong to the current shop.</p>
        <Link className="button outline" href={twinPath(shop)}>
          Open shop floor
        </Link>
      </main>
    );
  }
  return (
    <Studio
      key={
        shop +
        ":" +
        (initialReplay?.id ?? "live") +
        ":" +
        (initialReplay?.through ?? "latest")
      }
      initialReplay={initialReplay}
      initialOrder={initialOrder}
      records={feed.records}
      connected={feed.online}
      error={feed.error}
    />
  );
}

export function PersonalReplay({ shop, id }: { shop: string; id: string }) {
  const [records, setRecords] = useState<RecordSet | null>(null),
    [failure, setFailure] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setRecords(null);
    setFailure("");
    api<RecordSet>(
      shop,
      "orders/" + encodeURIComponent(id) + "/replay",
      undefined,
      abort.signal,
    )
      .then(setRecords)
      .catch((e) => {
        if (!abort.signal.aborted) setFailure(message(e));
      });
    return () => abort.abort();
  }, [id, shop]);
  if (failure)
    return (
      <main className="panel single-page">
        <ErrorBox>{failure}</ErrorBox>
        <Link href={customerPath(shop)}>Customer portal</Link>
      </main>
    );
  if (!records) return <Loading label="Loading your order journey…" />;
  return (
    <Studio
      key={id}
      records={records}
      initialReplay={{ id }}
      personal
      connected={false}
      error=""
    />
  );
}
function Studio({
  personal=false, records,
  connected,
  error,
  initialOrder,
  initialReplay,
}: {
  initialReplay?: ReplayEntry;
  initialOrder?: string;
  personal?:boolean; records: RecordSet;
  connected: boolean;
  error: string;
}) {
  const router = useRouter();
  const cached =
    retained?.shop === records.snapshot.shopId ? retained : undefined;
  const [selection, select] = useState<Selection | null>(
      initialOrder ? { kind: "order", id: initialOrder } : null,
    ),
    [view, setView] = useState<Camera>(
      initialOrder ? "Follow customer" : (cached?.view ?? "Shop overview"),
    ),
    [auto, setAuto] = useState(
      initialReplay ? true : initialOrder ? false : (cached?.auto ?? true),
    );
  const [film, setFilm] = useState<RecordSet | null>(() =>
      initialReplay
        ? {
            snapshot: records.snapshot,
            events: records.events.filter(
              (e) =>
                e.sequence <=
                (initialReplay.through ?? records.snapshot.sequence),
            ),
          }
        : null,
    ),
    [cursor, setCursor] = useState(initialReplay ? -1 : 0),
    [scope, setScope] = useState(initialReplay?.id ?? "all");
  const [paused, setPaused] = useState(false),
    [speed, setSpeed] = useState(1),
    [epoch, reset] = useState(0);
  const [frozen, setFrozen] = useState<RecordSet | null>(null),
    [filter, setFilter] = useState("ALL"),
    [timeline, setTimeline] = useState(!!initialReplay);
  const [panel, setPanel] = useState(true),
    [muted, setMuted] = useState(true),
    [low, setLow] = useState(cached?.low ?? false),
    [retry, setRetry] = useState(0);
  const [stage, setStage] = useState<ShopScene | null>(null),
    [graphicsError, setGraphicsError] = useState("");
  const liveOptions = useRef({ available: true, view, auto, low });
  useEffect(() => {
    liveOptions.current = {
      available: !film && !frozen && !graphicsError,
      view,
      auto,
      low,
    };
  }, [film, frozen, graphicsError, view, auto, low]);
  const host = useRef<HTMLDivElement>(null),
    full = useRef<HTMLDivElement>(null);
  const last = useRef<{
    stage: ShopScene;
    epoch: number;
    sequence: number;
  } | null>(null);
  const source = film ?? frozen ?? records,
    { snapshot } = source,
    shop = snapshot.shopId;
  const history = useMemo(
    () =>
      film && scope !== "all"
        ? source.events.filter((e) => e.orderId === scope)
        : source.events,
    [source.events, film, scope],
  );
  const seq = film
    ? (history[Math.min(cursor, history.length - 1)]?.sequence ?? 0)
    : snapshot.sequence;
  const floor = useMemo(
    () =>
      film
        ? replayFloor(
            snapshot,
            source.events,
            seq,
            scope === "all" ? undefined : scope,
          )
        : liveFloor(snapshot),
    [film, snapshot, source.events, scope, seq],
  );
  const selectedOrder =
    selection?.kind === "order"
      ? floor.orders.find((o) => o.id === selection.id)
      : undefined;
  const selectedMachineJob =
    selection?.kind === "printer"
      ? floor.orders.find((o) => o.printerId === Number(selection.id))
      : undefined;
  const selectedPrinter =
    selection?.kind === "printer"
      ? floor.printers.find((p) => p.id === Number(selection.id))
      : undefined;
  const modeLookup = useMemo(
    () => new Map(snapshot.catalog.map((p) => [p.id, p.mode])),
    [snapshot.catalog],
  );
  const visibleEvents = history.filter(
    (e) =>
      e.sequence <= seq &&
      (filter === "ALL" ||
        e.payload.mode === filter ||
        (e.orderId && modeLookup.get(e.orderId) === filter)),
  );
  const [eventLimit, setEventLimit] = useState(32);
  const normal = floor.orders.filter(
    (o) => o.mode === "NORMAL" && o.status === "QUEUED",
  ).length;
  const express = floor.orders.filter(
    (o) => o.mode === "EXPRESS" && o.status === "QUEUED",
  ).length;
  const choose = (s: Selection) => {
    select(s);
    setPanel(true);
  };
  useEffect(() => {
    let dead = false,
      engine: ShopScene | undefined;
    setGraphicsError("");
    last.current = null;
    void import("../twin/scene")
      .then(({ ShopScene }) => {
        if (dead || !host.current) return;
        const manual = () => {
          setAuto(false);
          setView("Free camera");
        };
        const loss = () =>
          setGraphicsError(
            "The graphics context was interrupted. Restore the scene to continue.",
          );
        if (
          !initialReplay &&
          retained?.shop === shop &&
          !retry &&
          !retained.scene.renderer.getContext().isContextLost()
        ) {
          const room = retained;
          retained = undefined;
          clearTimeout(room.timer);
          engine = room.scene;
          engine.attach(host.current, choose, manual, loss);
          last.current = { stage: engine, epoch: 0, sequence: room.sequence };
        } else {
          discardRoom();
          engine = new ShopScene(
            host.current,
            snapshot.demo,
            shop,
            snapshot.name,
            choose,
            manual,
            loss,
          );
        }
        setStage(engine);
      })
      .catch(() => {
        if (!dead)
          setGraphicsError(
            "3D rendering is unavailable on this device. The floor list and timeline are available below.",
          );
      });
    return () => {
      dead = true;
      const previous = last.current,
        options = liveOptions.current;
      if (
        engine &&
        previous?.stage === engine &&
        options.available &&
        !engine.renderer.getContext().isContextLost()
      ) {
        discardRoom();
        engine.suspend();
        retained = {
          shop,
          scene: engine,
          sequence: previous.sequence,
          timer: window.setTimeout(discardRoom, 90000),
          ...options,
        };
      } else engine?.dispose();
      setStage(null);
    };
  }, [shop, snapshot.demo, snapshot.name, retry]);
  useEffect(() => {
    if (!stage) return;
    const previous = last.current;
    const restore =
      !previous ||
      previous.stage !== stage ||
      previous.epoch !== epoch ||
      seq < previous.sequence;
    stage.sync(
      floor,
      restore
        ? history.filter((e) => e.sequence <= seq)
        : history.filter(
            (e) => e.sequence > previous.sequence && e.sequence <= seq,
          ),
      restore,
    );
    last.current = { stage, epoch, sequence: seq };
  }, [stage, floor, history, seq, epoch]);
  useEffect(() => stage?.setCamera(view, auto), [stage, view, auto]);
  useEffect(() => stage?.select(selection), [selection, stage]);
  useEffect(() => stage?.playback(paused, speed), [paused, speed, stage]);
  useEffect(() => stage?.quality(low), [low, stage]);
  useEffect(() => {
    if (!stage) return;
    void stage.audio(!muted).catch(() => setMuted(true));
  }, [muted, stage]);
  useEffect(() => {
    if (!film || paused || !history.length) return;
    if (cursor >= history.length - 1) {
      const t = setInterval(() => {
        if (!stage?.transporting) setPaused(true);
      }, 900 / speed);
      return () => clearInterval(t);
    }
    const t = setTimeout(
      () => setCursor((c) => Math.min(c + 1, history.length - 1)),
      cursor < 0 ? 100 : (filmDuration(history[cursor]) * 1000) / speed,
    );
    return () => clearTimeout(t);
  }, [cursor, film, history, speed, paused, stage]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        select(null);
        setTimeline(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  function replay(id: string, start = -1) {
    setFilm(film ?? records);
    setFrozen(null);
    setScope(id);
    setCursor(start);
    setPaused(false);
    setTimeline(true);
    setAuto(true);
    setView("Shop overview");
    reset((n) => n + 1);
  }
  function live() {
    if(personal&&initialReplay){router.replace(orderPath(shop,initialReplay.id));return;}
    if (initialReplay) {
      router.replace(twinPath(shop));
      return;
    }
    setFilm(null);
    setFrozen(null);
    setPaused(false);
    setSpeed(1);
    reset((n) => n + 1);
  }
  function pause() {
    if (!film) setFrozen(paused ? null : records);
    if (film && paused && cursor >= history.length - 1) {
      setCursor(-1);
      reset((n) => n + 1);
    }
    setPaused(!paused);
  }
  function seek(index: number) {
    setCursor(index);
    setPaused(true);
    reset((n) => n + 1);
  }
  return (
    <div className="twin-page" ref={full}>
      <div className="floor-viewport">
      <header className="customer-nav">
        <div className="nav-inner">
          <Logo href={customerPath(shop)} />
          <WorkspaceSwitch shop={shop} active="twin" />
          <span className="pill nav-mode neutral">
            {personal?"Your order replay":"Staff workspace"}
          </span>
        </div>
      </header>
      <div className="twin-title">
        <div>
          <h1>Shop floor</h1>
          <p>
            {snapshot.name} ·{" "}
            {snapshot.demo
              ? "Simulated people and equipment"
              : "Virtual orders · staff-reported equipment"}
          </p>
        </div>
        <div className="twin-actions">
          {!film && !personal && <ShopAlerts events={records.events}/>}
          {!personal && <Link className="button outline small" href={ownerPath(shop)}>Back to dashboard</Link>}
          <span
            className={
              "pill " + (film ? "blue" : connected ? "green" : "neutral")
            }
          >
            <Radio size={14} />
            {film
              ? "Replay"
              : paused
                ? "Paused"
                : connected
                  ? "Live sync"
                  : "Reconnecting"}
          </span>
          <button
            className="button outline small"
            onClick={() => setTimeline(!timeline)}
            aria-expanded={timeline}
          >
            <History size={16} /> Timeline
          </button>
          <button
            className="icon-button"
            aria-label="Toggle fullscreen"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void full.current?.requestFullscreen?.().catch(() => {});
            }}
          >
            <Expand size={17} />
          </button>
        </div>
      </div>
      <ErrorBox>{error}</ErrorBox>
      <div className="studio-body">
        <section className="scene-column" aria-label="Shop visualization">
          <div className="scene-stage">
            <div ref={host} className="scene-host" data-testid="shop-scene" />
            {graphicsError && (
              <div className="graphics-fallback" role="status">
                <Box />
                <p>{graphicsError}</p>
                <button
                  className="button outline"
                  onClick={() => setRetry((n) => n + 1)}
                >
                  Restore 3D scene
                </button>
              </div>
            )}
            <div className="scene-stats">
              <span>
                <b data-testid="active-count">{floor.orders.length}</b>Active
                orders
              </span>
              <span>
                <b>
                  {floor.printers.filter((p) => p.online).length}/
                  {floor.printers.length}
                </b>
                Printers online
              </span>
            </div>
            <div className="scene-caption">
              {snapshot.demo ? "Shop floor" : "Virtual floor"}
              <small>{auto ? "Cinematic camera" : view}</small>
            </div>
          </div>
          <div className="camera-strip">
            <label>
              <CameraIcon size={17} />
              <select
                aria-label="Camera view"
                value={auto ? "Auto cinematic" : view}
                onChange={(e) => {
                  if (e.target.value === "Auto cinematic") {
                    setAuto(true);
                    setView("Shop overview");
                  } else {
                    setAuto(false);
                    setView(e.target.value as Camera);
                  }
                }}
              >
                <option>Auto cinematic</option>
                {cameras.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <button className="button outline small" onClick={pause}>
              {paused ? <Play size={15} /> : <Pause size={15} />}{" "}
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              className="icon-button"
              aria-label={muted ? "Enable printer sound" : "Mute printer sound"}
              aria-pressed={!muted}
              onClick={() => setMuted(!muted)}
            >
              {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>
            <label className="quality-control">
              <select
                aria-label="Graphics quality"
                value={low ? "low" : "high"}
                onChange={(e) => setLow(e.target.value === "low")}
              >
                <option value="high">Full detail</option>
                <option value="low">Low power</option>
              </select>
            </label>
            <button
              className="icon-button"
              aria-label="Reset camera"
              onClick={() => {
                setAuto(false);
                setView("Shop overview");
                stage?.setCamera("Shop overview", false);
              }}
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </section>
        <aside className="floor-inspector">
          <div className="panel-heading">
            <h2>Floor activity</h2>
            <button
              className="icon-button"
              aria-label="Toggle floor details"
              onClick={() => setPanel(!panel)}
            >
              <ChevronDown size={17} />
            </button>
          </div>
          {panel && (
            <div className="inspector-body">
              {selection && (
                <div className="object-detail">
                  <div className="panel-heading">
                    <strong>
                      {selectedOrder?.token ??
                        selectedPrinter?.name ??
                        {
                          queue: "Queue display",
                          pickup: "Pickup counter",
                          monitor: "Owner workstation",
                          qr: "Ordering QR",
                          order: "Order journey",
                          printer: "Printer",
                        }[selection.kind]}
                    </strong>
                    <button
                      className="icon-button"
                      aria-label="Close selection"
                      onClick={() => select(null)}
                    >
                      <X size={15} />
                    </button>
                  </div>
                  {selectedOrder && (
                    <>
                      <div className="inline-badges">
                        <ModeBadge mode={selectedOrder.mode} />
                        <StatusBadge status={selectedOrder.status} />
                      </div>
                      {["PRINTING", "HELD", "FINISHING", "READY"].includes(
                        selectedOrder.status,
                      ) && (
                        <p className="selected-progress">
                          <progress
                            value={selectedOrder.progress}
                            max={100}
                            aria-label="Order print progress"
                          />
                          {selectedOrder.progress}% ·{" "}
                          {snapshot.demo ? "Simulated" : "Staff reported"}
                        </p>
                      )}
                      <p>
                        {selectedOrder.print.type} ·{" "}
                        {selectedOrder.print.color === "BW" ? "B&W" : "Color"} ·{" "}
                        {selectedOrder.print.size} ·{" "}
                        {selectedOrder.print.duplex ? "Duplex" : "Simplex"} ·{" "}
                        {selectedOrder.print.layout.toLowerCase()}
                      </p>
                      <p>
                        {selectedOrder.print.copies} copies ·{" "}
                        {selectedOrder.print.range} ·{" "}
                        {selectedOrder.print.paper.toLowerCase()} ·{" "}
                        {selectedOrder.print.finishing.toLowerCase()} finishing
                      </p>
                      <p>
                        {rupees(selectedOrder.total)} ·{" "}
                        {paymentLabel[selectedOrder.payment]}
                        {selectedOrder.queuePosition
                          ? " · Queue #" + selectedOrder.queuePosition
                          : ""}
                        {selectedOrder.etaMinutes
                          ? " · ~" + selectedOrder.etaMinutes + " min"
                          : ""}
                      </p>
                      <button
                        className="button outline small"
                        onClick={() => {
                          setAuto(false);
                          setView("Follow customer");
                        }}
                      >
                        Follow order
                      </button>
                    </>
                  )}
                  {selection.kind === "order" && !film && (
                    <Link
                      className="text-button"
                      href={orderWorkspace(
                        ownerPath(shop, "orders"),
                        selection.id,
                      )}
                    >
                      Manage this order
                    </Link>
                  )}
                  {selection.kind === "order" && (
                    <button
                      className="button outline small"
                      onClick={() => replay(selection.id)}
                    >
                      Replay this order
                    </button>
                  )}
                  {selectedPrinter && (
                    <p>
                      {selectedPrinter.online ? "Online" : "Offline"} ·{" "}
                      {selectedPrinter.model} ·{" "}
                      {selectedPrinter.color ? "Color" : "B&W"} ·{" "}
                      {selectedPrinter.a3 ? "A3 / A4" : "A4"} ·{" "}
                      {selectedPrinter.duplex ? "Duplex" : "Simplex"} ·{" "}
                      {selectedPrinter.paperLoaded
                        ? "Paper loaded"
                        : "Out of paper"}
                    </p>
                  )}
                  {selectedMachineJob && (
                    <button
                      className="text-button"
                      onClick={() =>
                        choose({ kind: "order", id: selectedMachineJob.id })
                      }
                    >
                      View {selectedMachineJob.token} ·{" "}
                      {selectedMachineJob.progress}%
                    </button>
                  )}
                  {selection.kind === "monitor" && (
                    <Link
                      className="text-button"
                      href={ownerPath(shop, "orders")}
                    >
                      Open order management
                    </Link>
                  )}
                  {selection.kind === "qr" && (
                    <Link className="text-button" href={customerPath(shop)}>
                      Open customer portal
                    </Link>
                  )}
                  {selection.kind === "pickup" && (
                    <p>
                      {floor.orders
                        .filter((o) => o.status === "READY")
                        .map((o) => o.token)
                        .join(", ") || "No orders awaiting pickup."}
                    </p>
                  )}
                  {selection.kind === "queue" && (
                    <p>
                      {normal} Normal · {express} Express
                    </p>
                  )}
                </div>
              )}
              <h3>Printer fleet</h3>
              {floor.printers.map((p) => {
                const o = floor.orders.find((o) => o.id === p.jobId);
                return (
                  <button
                    className="machine-row"
                    key={p.id}
                    onClick={() => {
                      choose({ kind: "printer", id: String(p.id) });
                      setAuto(false);
                      setView(("Printer 0" + p.id) as Camera);
                    }}
                  >
                    <span className="machine-icon">
                      <Printer size={19} />
                    </span>
                    <span>
                      <b>{p.name}</b>
                      <small>
                        {o
                          ? o.token +
                            " · " +
                            statusLabel[o.status] +
                            " · " +
                            o.progress +
                            "%"
                          : p.model}
                      </small>
                    </span>
                    <i
                      className={
                        "machine-state " +
                        (!p.online || !p.paperLoaded ? "down" : o ? "busy" : "")
                      }
                    >
                      {!p.online
                        ? "Offline"
                        : !p.paperLoaded
                          ? "No paper"
                          : o
                            ? "Busy"
                            : "Idle"}
                    </i>
                  </button>
                );
              })}
              <div className="floor-queue-title">
                <h3>Order queue</h3>
                <small>
                  {normal} Normal · {express} Express
                </small>
              </div>
              <div className="floor-orders">
                {[...floor.orders]
                  .sort(
                    (a, b) =>
                      (a.queuePosition ?? 999) - (b.queuePosition ?? 999) ||
                      a.createdAt.localeCompare(b.createdAt),
                  )
                  .map((o) => (
                    <button
                      className="floor-order"
                      key={o.id}
                      data-avatar={o.avatarId}
                      onClick={() => choose({ kind: "order", id: o.id })}
                    >
                      <span>
                        <b>{o.token}</b>
                        <small>
                          {statusLabel[o.status]}
                          {o.queuePosition ? " · #" + o.queuePosition : ""}
                        </small>
                      </span>
                      <ModeBadge mode={o.mode} />
                    </button>
                  ))}
                {!floor.orders.length && (
                  <p className="muted">No active orders.</p>
                )}
              </div>
              <label className="floor-fixtures">
                Shop fixtures
                <select
                  value={
                    selection && !["order", "printer"].includes(selection.kind)
                      ? selection.kind
                      : ""
                  }
                  onChange={(e) => {
                    if (!e.target.value) {
                      select(null);
                      return;
                    }
                    const kind = e.target.value as
                      | "queue"
                      | "pickup"
                      | "qr"
                      | "monitor";
                    choose({ kind });
                    setAuto(false);
                    setView(
                      (
                        {
                          queue: "Waiting area",
                          pickup: "Pickup counter",
                          qr: "Entrance",
                          monitor: "Owner monitor",
                        } as const
                      )[kind],
                    );
                  }}
                >
                  <option value="">Select a fixture</option>
                  <option value="monitor">Owner computer</option>
                  <option value="queue">Queue display</option>
                  <option value="pickup">Pickup counter</option>
                  <option value="qr">Ordering QR</option>
                </select>
              </label>
            </div>
          )}
        </aside>
      </div>
      </div>
      <section className="twin-timeline">
        <div className="twin-timeline-head">
          <button
            className="text-button"
            onClick={() => setTimeline(!timeline)}
          >
            <History size={17} /> Event timeline{" "}
            <small>{visibleEvents.length}</small>
          </button>
          <div className="inline-actions">
            {film && !personal && (
              <Link
                className="text-button"
                href={
                  "/digital-twin/replay/" +
                  encodeURIComponent(scope) +
                  "?" +
                  new URLSearchParams({
                    shop,
                    through: String(film.events.at(-1)?.sequence ?? 0),
                  })
                }
              >
                Open replay link
              </Link>
            )}
            {film && (
              <button className="button primary small" onClick={live}>
                <Radio size={14} /> {personal?"Return to tracking":"Return to live"}
              </button>
            )}
            <button
              className="button outline small"
              disabled={!records.events.length}
              onClick={() => replay(personal&&initialReplay?initialReplay.id:"all")}
            >
              <Play size={14} /> {personal?"Restart order replay":"Replay shop"}
            </button>
          </div>
        </div>
        {timeline && (
          <>
            <div className="timeline-tools">
              <label>
                Service
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="ALL">All services</option>
                  <option>NORMAL</option>
                  <option>EXPRESS</option>
                </select>
              </label>
              <label>
                Replay scope
                <select
                  value={film ? scope : "all"}
                  onChange={(e) => replay(e.target.value)}
                >
                  {!personal&&<option value="all">Entire shop</option>}
                  {snapshot.catalog.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.token}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Speed
                <select
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                >
                  {[0.5, 1, 2, 4].map((s) => (
                    <option value={s} key={s}>
                      {s}×
                    </option>
                  ))}
                </select>
              </label>
              {film && (
                <label className="seek-label">
                  Event {cursor + 1} of {history.length}
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, history.length - 1)}
                    value={Math.max(0, cursor)}
                    onChange={(e) => seek(Number(e.target.value))}
                  />
                </label>
              )}
            </div>
            <ol className="film-log">
              {visibleEvents
                .slice(-eventLimit)
                .reverse()
                .map((e) => (
                  <li key={e.sequence}>
                    <button
                      onClick={() => {
                        if (!film)
                          replay(
                            "all",
                            records.events.findIndex(
                              (item) => item.sequence === e.sequence,
                            ),
                          );
                        else
                          seek(
                            history.findIndex(
                              (item) => item.sequence === e.sequence,
                            ),
                          );
                        setPaused(true);
                      }}
                    >
                      <time>{timeLabel(e.at)}</time>
                      <span>{eventTitle(e)}</span>
                      <b>
                        {e.payload.token ??
                          (e.payload.printerId
                            ? "Printer 0" + e.payload.printerId
                            : "Shop")}
                      </b>
                    </button>
                  </li>
                ))}
            </ol>
            {visibleEvents.length > eventLimit && (
              <button
                className="text-button"
                onClick={() => setEventLimit((n) => n + 50)}
              >
                Show earlier events
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
