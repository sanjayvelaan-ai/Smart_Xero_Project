"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { fragmentShader, vertexShader } from "./hills-shaders";

export default function Hills({ dark }: { dark: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const color = useRef(new THREE.Color());
  useEffect(() => { color.current.set(dark ? "#7b91bd" : "#899fc6"); }, [dark]);
  useEffect(() => {
    const el = document.createElement("canvas");
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: el, alpha: true, antialias: false, powerPreference: "low-power" }); }
    catch { return; }
    container.current!.appendChild(el);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 500);
    camera.position.set(0,16,125);
    camera.lookAt(0,28,0);
    const uniforms = { time: { value: 0.43 }, tint: { value: color.current } };
    const geometry = new THREE.PlaneGeometry(256,256,112,112);
    const material = new THREE.RawShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent:true });
    scene.add(new THREE.Mesh(geometry, material));
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    let timer = 0;
    function draw() {
      window.clearTimeout(timer);
      if (document.hidden || renderer.getContext().isContextLost()) return;
      renderer.setClearColor(document.documentElement.dataset.theme === "dark" ? 0x192235 : 0xe8edf7, 1);
      if (!reduce.matches) uniforms.time.value += 0.004;
      renderer.render(scene,camera);
      if (!reduce.matches) timer = window.setTimeout(draw, 100);
    }
    function resize() {
      const {width,height} = el.getBoundingClientRect();
      renderer.setSize(Math.max(1,width*.65),Math.max(1,height*.65),false);
      camera.aspect = width / Math.max(1,height);
      camera.updateProjectionMatrix();
      draw();
    }
    const observer = new ResizeObserver(resize);
    const lost = () => { el.style.visibility = "hidden"; clearTimeout(timer); };
    const restored = () => { el.style.visibility = ""; resize(); };
    el.addEventListener("webglcontextlost",lost);
    el.addEventListener("webglcontextrestored",restored);
    observer.observe(el);
    const theme = new MutationObserver(() => { color.current.set(document.documentElement.dataset.theme === "dark" ? "#7b91bd" : "#899fc6"); draw(); });
    theme.observe(document.documentElement,{ attributes:true,attributeFilter:["data-theme"] });
    reduce.addEventListener("change",draw);
    document.addEventListener("visibilitychange",draw);
    resize();
    return () => {
      clearTimeout(timer); observer.disconnect(); theme.disconnect();
      reduce.removeEventListener("change",draw); document.removeEventListener("visibilitychange",draw);
      geometry.dispose(); material.dispose(); renderer.dispose(); renderer.forceContextLoss();
      el.removeEventListener("webglcontextlost",lost); el.removeEventListener("webglcontextrestored",restored); el.remove();
    };
  }, []);
  return <div ref={container} aria-hidden="true" className="hills-background" />;
}
