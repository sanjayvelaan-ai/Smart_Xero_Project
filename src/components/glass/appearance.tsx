"use client";

import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { LiquidToggle, NimbusToggleIcons } from "@/components/ui/liquid-glass-toggle";

const Hills = dynamic(() => import("./hills"), { ssr: false });
const preference = "printflow-appearance";
type Origin = { x: number; y: number };
const Theme = createContext<{ dark: boolean; select: (dark: boolean, origin: Origin) => void }>({ dark: false, select: () => {} });
export const useAppearance = () => useContext(Theme);

export function Appearance({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(false);
  const transition = useRef<ViewTransition | null>(null);
  const path = usePathname();
  function apply(value: boolean) {
    document.documentElement.dataset.theme = value ? "dark" : "light";
    setDark(value);
  }
  useLayoutEffect(() => {
    const system = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      let stored: string | null = null;
      try { stored = localStorage.getItem(preference); } catch {}
      apply(stored === "dark" || (stored !== "light" && system.matches));
    };
    sync();
    window.addEventListener("storage", sync);
    system.addEventListener("change", sync);
    return () => { window.removeEventListener("storage", sync); system.removeEventListener("change", sync); };
  }, []);
  function select(value: boolean, { x, y }: Origin) {
    const root = document.documentElement;
    function commit() {
      apply(value);
      try { localStorage.setItem(preference, value ? "dark" : "light"); } catch {}
    }
    function clear() {
      transition.current = null;
      delete root.dataset.themeTransition;
      root.style.removeProperty("--theme-origin");
      root.style.removeProperty("--theme-radius");
    }
    if (transition.current) {
      transition.current.skipTransition();
      clear();
    }
    if (matchMedia("(prefers-reduced-motion: reduce), (forced-colors: active)").matches) {
      commit();
      return;
    }
    const radius = Math.ceil(Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)));
    const center = x + "px " + y + "px";
    if (!document.startViewTransition) {
      commit();
      document.querySelector(".theme-ripple")?.remove();
      const ripple = document.createElement("span");
      ripple.className = "theme-ripple";
      ripple.setAttribute("aria-hidden", "true");
      ripple.style.setProperty("--theme-origin", center);
      ripple.style.setProperty("--theme-radius", radius + "px");
      ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
      document.body.append(ripple);
      return;
    }

    root.dataset.themeTransition = "";
    root.style.setProperty("--theme-origin", center);
    root.style.setProperty("--theme-radius", radius + "px");
    const next = document.startViewTransition(() => {
      if (transition.current === next) flushSync(commit);
    });
    transition.current = next;
    const settle = () => { if (transition.current === next) clear(); };
    void next.ready.catch(() => {});
    void next.finished.then(settle, settle);
  }
  return <Theme.Provider value={{ dark, select }}>
    {!path.startsWith("/digital-twin") && !path.endsWith("/replay") && <Hills dark={dark} />}
    {children}
  </Theme.Provider>;
}

export function ThemeSwitch() {
  const { dark, select } = useAppearance();
  const control = useRef<HTMLSpanElement>(null);
  return <span ref={control} className="theme-switch"><LiquidToggle checked={dark} onCheckedChange={value => {
    const bounds = control.current!.getBoundingClientRect();
    select(value, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
  }}
    tone={dark ? "dark" : "light"} size={28} label="Dark appearance"
    icons={{ off: NimbusToggleIcons.sun, on: NimbusToggleIcons.moon }} /></span>;
}
