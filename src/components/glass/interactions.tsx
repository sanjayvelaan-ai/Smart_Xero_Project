"use client";

import { useEffect } from "react";
import { stepSpring } from "./spring";

const controls = "button:not(.nimbus-toggle),a[href],select,input:not([type=file]),textarea,summary,.choice,.fulfillment-option";
const surfaces = ".glass-host,.panel,.customer-hero,.sidebar-shop,.dropzone,.choice,.twin-title,.sidebar";

export function GlassInteractions() {
  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce), (forced-colors: active)");
    let pressed: HTMLElement | null = null;
    let lit: HTMLElement[] = [];
    let frame = 0, lightFrame = 0, last = 0, target = 1;
    let pointer: PointerEvent | null = null;
    const spring = { x: 1, v: 0 };
    let optics: SVGElement[] = [];
    function getTarget(event: PointerEvent, selector: string) {
      const el = event.target;
      return el instanceof Element && !el.closest(".scene-stage") ? el.closest<HTMLElement>(selector) : null;
    }
    function resetPress() {
      cancelAnimationFrame(frame); frame = 0;
      for (const filter of optics) filter.setAttribute("scale",filter.dataset.rest!);
      optics = [];
      pressed?.style.removeProperty("scale"); pressed = null; spring.x = 1; spring.v = 0;
    }
    function tick(now: number) {
      frame = 0;
      if (!pressed?.isConnected || reduce.matches) { resetPress(); return; }
      stepSpring(spring, target, 420, 22, Math.min(.05, (now - last) / 1000));
      last = now;
      pressed.style.scale = spring.x.toFixed(4) + " " + (1 - (1-spring.x)*1.45).toFixed(4);
      for (const filter of optics) filter.setAttribute("scale", String(Number(filter.dataset.rest) + (1-spring.x)*140));
      if (Math.abs(spring.x-target) + Math.abs(spring.v) > .001) frame = requestAnimationFrame(tick);
      else if (target === 1) resetPress();
    }
    function start() { if (!frame) { last = performance.now(); frame = requestAnimationFrame(tick); } }
    function down(event: PointerEvent) {
      if (!event.isPrimary || event.button !== 0 || reduce.matches) return;
      resetPress(); pressed = getTarget(event, controls);
      if (!pressed || pressed.matches(":disabled")) return;
      optics = Array.from(pressed.closest(".glass-host")?.querySelectorAll<SVGElement>(".glass-lens feDisplacementMap") ?? []);
      for (const filter of optics) filter.dataset.rest ??= filter.getAttribute("scale") ?? "24";
      move(event);
      target = .965; start();
    }
    function up() { if (pressed) { target = 1; start(); } }
    function clearLight() {
      for (const node of lit) for (const prop of ["--mx","--my","--spec-angle"]) node.style.removeProperty(prop);
      lit = [];
    }
    function move(event: PointerEvent) {
      if (!event.isPrimary || reduce.matches) return;
      pointer = event;
      if (lightFrame) return;
      lightFrame = requestAnimationFrame(() => {
        lightFrame = 0;
        if (!pointer) return;
        const nodes = [getTarget(pointer, surfaces), getTarget(pointer, controls)].filter((node): node is HTMLElement => !!node);
        if (nodes.length !== lit.length || nodes.some((node,i) => node !== lit[i])) clearLight();
        lit = nodes;
        for (const node of lit) {
          const r = node.getBoundingClientRect();
          const x = pointer.clientX - r.left, y = pointer.clientY - r.top;
          node.style.setProperty("--mx", x + "px"); node.style.setProperty("--my", y + "px");
          node.style.setProperty("--spec-angle", (90 + Math.atan2(y-r.height/2, x-r.width/2)*180/Math.PI) + "deg");
        }
      });
    }
    function reset() { cancelAnimationFrame(lightFrame); lightFrame = 0; clearLight(); resetPress(); }
    document.addEventListener("pointermove",move,{ passive:true });
    document.addEventListener("pointerdown",down,{ passive:true });
    window.addEventListener("pointerup",up); window.addEventListener("pointercancel",up);
    window.addEventListener("blur",reset); reduce.addEventListener("change",reset);
    return () => {
      reset(); document.removeEventListener("pointermove",move); document.removeEventListener("pointerdown",down);
      window.removeEventListener("pointerup",up); window.removeEventListener("pointercancel",up);
      window.removeEventListener("blur",reset); reduce.removeEventListener("change",reset);
    };
  }, []);
  return null;
}
