"use client";

import { forwardRef, useEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { Glass } from "@/components/glass/glass";
import { cn } from "@/lib/utils";

const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const formatNumber = (value: number) => number.format(value);

function Counter({ value, format = formatNumber }: { value: number; format?: (value: number) => string }) {
  const position = useMotionValue(value);
  const precision = Number.isInteger(value) ? 1 : 100;
  const display = useTransform(() => format(Math.round(position.get() * precision) / precision));
  const reduce = useReducedMotion();
  const previous = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (reduce) {
      position.jump(value);
      return;
    }
    const play = (entered: boolean) => {
      if (entered) position.jump(value === 0 ? 9 : 0);
      return animate(position, value, { duration: 0.95, ease: "easeOut" });
    };
    let playback = play(previous.current === undefined || previous.current === value);
    previous.current = value;
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) { playback.stop(); playback = play(true); }
    };
    window.addEventListener("pageshow", restore);
    return () => { playback.stop(); window.removeEventListener("pageshow", restore); };
  }, [position, reduce, value]);
  return <motion.span>{display}</motion.span>;
}

interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  value: number;
  icon: ReactNode;
  change?: number;
  changeDescription?: string;
  detail?: string;
  tone?: string;
  unit?: string;
  secondaryValue?: number;
  format?: (value: number) => string;
  empty?: boolean;
}

export const StatCard = forwardRef<HTMLDivElement, StatCardProps>(function StatCard({
  title, value, icon, change, changeDescription, detail, tone = "teal", unit = "%",
  secondaryValue, format = formatNumber, empty, className, ...props
}, ref) {
  const suffix = secondaryValue === undefined ? unit : " / " + formatNumber(secondaryValue);
  const label = empty ? "—" : format(value) + suffix;
  return <div ref={ref} role="region" aria-label={title + ", " + label}
    className={cn("panel metric glass-host stat-card", className)} {...props}>
    <Glass />
    <div className="metric-head"><span>{title}</span><span className={cn("icon-block", tone)} aria-hidden="true">{icon}</span></div>
    <strong aria-hidden="true">{empty ? "—" : <>
      <Counter value={value} format={format} />
      {secondaryValue === undefined ? <span className="stat-unit">{unit}</span> :
        <><span className="stat-divider"> / </span><Counter value={secondaryValue} /></>}
    </>}</strong>
    {detail && <small>{detail}</small>}
    {change !== undefined && <small><b className={change < 0 ? "stat-down" : "stat-up"}>
      {change > 0 ? "+" : ""}{change}%</b>{changeDescription && " from " + changeDescription}</small>}
  </div>;
});
