"use client";

import { Fragment, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { buildMap } from "./bezel";

// Kit optics live behind the native control so its text, focus and hit area stay crisp.
export function Glass({ radius = 24 }: { radius?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const id = "bezel" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const [lens, setLens] = useState<{ width: number; height: number; map: string; single: boolean }>();
  useEffect(() => {
    const el = ref.current;
    if (!el || !window.ResizeObserver || !window.IntersectionObserver ||
        !/Chrom(?:e|ium)\//.test(navigator.userAgent) || !CSS.supports("backdrop-filter", "url(#test)")) return;
    const opaque = matchMedia("(prefers-reduced-transparency: reduce), (forced-colors: active), print");
    const nav = navigator as Navigator & { deviceMemory?: number };
    const single = (nav.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || matchMedia("(pointer: coarse)").matches;
    let visible = false;
    let timer: ReturnType<typeof setTimeout>;
    function update() {
      clearTimeout(timer);
      if (opaque.matches || !visible) { setLens(undefined); return; }
      timer = setTimeout(() => {
        const width = el!.clientWidth, height = el!.clientHeight;
        if (width < 2 || height < 2) return;
        const bezel = Math.min(18, width / 2, height / 2);
        setLens({ width, height, single, map: buildMap(width, height, radius, bezel) });
      }, 100);
    }
    const size = new ResizeObserver(update);
    const view = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); });
    size.observe(el); view.observe(el); opaque.addEventListener("change", update);
    return () => { clearTimeout(timer); size.disconnect(); view.disconnect(); opaque.removeEventListener("change", update); };
  }, [radius]);
  return <span ref={ref} aria-hidden="true" className="glass-lens"
    style={lens ? { "--bezel-filter": `url(#${id}) saturate(1.08)` } as CSSProperties : undefined}>
    {lens && <svg width="0" height="0" focusable="false"><defs>
      <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation={lens.single ? .6 : 1.5} result="frost" />
        <feImage href={lens.map} x="0" y="0" width={lens.width} height={lens.height} preserveAspectRatio="none" result="map" />
        {lens.single ? <feDisplacementMap in="frost" in2="map" scale="24" xChannelSelector="R" yChannelSelector="G" /> :
          <>{[["r",26,"1 0 0 0 0  0 0 0 0 0  0 0 0 0 0"],["g",24,"0 0 0 0 0  0 1 0 0 0  0 0 0 0 0"],["b",22,"0 0 0 0 0  0 0 0 0 0  0 0 1 0 0"]].map(([channel, scale, matrix]) =>
            <Fragment key={channel}><feDisplacementMap in="frost" in2="map" scale={scale} xChannelSelector="R" yChannelSelector="G" result={"d"+channel}/>
              <feColorMatrix in={"d"+channel} type="matrix" values={matrix + "  0 0 0 1 0"} result={String(channel)} /></Fragment>)}
            <feBlend in="r" in2="g" mode="screen" result="rg" /><feBlend in="rg" in2="b" mode="screen" />
          </>}
      </filter></defs></svg>}
  </span>;
}
