"use client";

import { useState } from "react";
import { CalendarClock, Clock3 } from "lucide-react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { Glass } from "@/components/glass/glass";

const minute = 60_000;
const indiaOffset = 330 * minute;
const shopMinute = (instant: number) => new Date(instant + indiaOffset).toISOString().slice(0, 16);

export function collectionWindow(now: number, leadSeconds: number, expiresAt: string) {
  return {
    min: shopMinute(Math.ceil((now + leadSeconds * 1000) / minute) * minute),
    max: shopMinute(Math.floor((Date.parse(expiresAt) - 1) / minute) * minute),
  };
}

// DayPicker uses browser-local dates to lay out civil days. Only the checkout
// converts the chosen shop date and time to an instant.
const civilDate = (day: string) => new Date(day + "T12:00:00");
const pad = (n: number) => String(n).padStart(2, "0");
const civilKey = (date: Date) => [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-");
const presets = Array.from({ length: 96 }, (_, i) => pad(Math.floor(i / 4)) + ":" + pad(i % 4 * 15));
const dayLabel = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" });

export function CollectionCalendar({ value, min, max, onChange }: {
  value: string; min: string; max: string; onChange: (value: string) => void;
}) {
  const first = min.slice(0, 10);
  const last = max.slice(0, 10);
  const [picked, setPicked] = useState(value.slice(0, 10) || first);
  const day = value.slice(0, 10) || (picked >= first && picked <= last ? picked : first);
  const [month, setMonth] = useState(() => civilDate(day));
  const selected = value.slice(11);
  const valid = !!value && value >= min && value <= max;
  const available = presets.filter(time => day + "T" + time >= min && day + "T" + time <= max);

  function selectDay(date: Date) {
    const next = civilKey(date);
    const candidate = next + "T" + selected;
    setPicked(next);
    onChange(selected && candidate >= min && candidate <= max ? candidate : "");
  }
  if (min > max) return <p role="status">This upload expires before the printer can finish. Upload it again to schedule collection.</p>;
  return <section className="collection-calendar glass-host" aria-label="Collection calendar">
    <Glass radius={18} />
    <div className="collection-picker">
      <DayPicker mode="single" required selected={civilDate(day)} onSelect={selectDay}
        today={civilDate(shopMinute(Date.now()).slice(0, 10))} month={month} onMonthChange={setMonth}
        startMonth={civilDate(first)} endMonth={civilDate(last)}
        disabled={[{ before: civilDate(first) }, { after: civilDate(last) }]} />
      <div className="collection-times">
        <h4><Clock3 size={15} /> Collection times</h4>
        <span>{dayLabel.format(civilDate(day))} · IST</span>
        <div className="collection-slots" role="group" aria-label="Available collection times">
          {available.map(time => <button type="button" key={time} aria-pressed={selected === time}
            onClick={() => onChange(day + "T" + time)}>{time}</button>)}
          {!available.length && <small>Use the exact time field below.</small>}
        </div>
      </div>
    </div>
    <div className="collection-footer">
      <label className="field"><span>Collection time at the shop (India time)</span>
        <input type="datetime-local" required value={value} min={min} max={max}
          aria-invalid={!!value && !valid} onChange={event => {
            const next = event.target.value;
            onChange(next);
            if (next && next >= min && next <= max) {
              setPicked(next.slice(0, 10));
              setMonth(civilDate(next.slice(0, 10)));
            }
          }} />
      </label>
      <p role="status"><CalendarClock size={17} />{valid
        ? dayLabel.format(civilDate(day)) + " at " + selected + " IST. Prepay to confirm."
        : value ? "Choose a time within the available collection window."
        : "Choose a time for you or your rider to collect the prints."}</p>
    </div>
  </section>;
}
