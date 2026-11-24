"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorBox, Loading, message } from "./shared";

export function PdfPreview({ url, pages }: { url: string; pages: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    setLoading(true);
    setError("");
    async function render() {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (!active || !canvas.current) return;
        pdfjs.GlobalWorkerOptions.workerSrc = "/api/pdf-worker";
        const task = pdfjs.getDocument({ url, useWasm: false, stopAtErrors: true, verbosity: 0 });
        let rendering: { cancel: () => void } | undefined;
        dispose = () => { rendering?.cancel(); void task.destroy().catch(() => {}); };
        const document = await task.promise;
        if (!active) return;
        const sheet = await document.getPage(page);
        const target = canvas.current;
        if (!active || !target) return;
        const base = sheet.getViewport({ scale: 1 });
        const scale = Math.min(1.35, 760 / base.width, 950 / base.height);
        const viewport = sheet.getViewport({ scale });
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        const job = sheet.render({ canvas: target, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE });
        rendering = job;
        await job.promise;
      } catch (failure) {
        if (active) setError(message(failure));
      } finally {
        if (active) setLoading(false);
      }
    }
    void render();
    return () => { active = false; dispose?.(); };
  }, [url, page]);
  return <div className="pdf-preview">
    <div className="preview-controls">
      <button className="button outline small" disabled={page === 1 || loading} onClick={() => setPage(value => value - 1)}>Previous page</button>
      <span>Page {page} of {pages}</span>
      <button className="button outline small" disabled={page === pages || loading} onClick={() => setPage(value => value + 1)}>Next page</button>
    </div>
    {loading && <Loading label="Rendering document preview…" />}
    <ErrorBox>{error}</ErrorBox>
    <canvas ref={canvas} hidden={loading || Boolean(error)} aria-label={"Preview of page " + page} />
  </div>;
}
