import type { Worker } from "tesseract.js";
import type { PDFWorker } from "pdfjs-dist";

export type PrintFile = {
  file: File;
  pages: number;
  landscape: boolean;
  colored: boolean;
  sensitive: boolean;
  textUnchecked?: boolean;
  thumbnail: string;
  warnings: string[];
  rotation: number;
  enhance: boolean;
  pdf: boolean;
};
const privateText =
  /aadhaa?r|uidai|passport|income tax department|permanent account number|\b\d{4}[ -]\d{4}[ -]\d{4}\b/i;
function canvas(w: number, h: number) {
  const element = document.createElement("canvas");
  element.width = Math.max(1, Math.round(w));
  element.height = Math.max(1, Math.round(h));
  return element;
}
async function imagePage(file: File, full = false) {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    if (bitmap.width * bitmap.height > 32_000_000)
      throw new Error("Image exceeds the 32 megapixel limit.");
    const scale = full
      ? 1
      : Math.min(1, 1100 / Math.max(bitmap.width, bitmap.height));
    const page = canvas(bitmap.width * scale, bitmap.height * scale),
      ctx = page.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, page.width, page.height);
    ctx.drawImage(bitmap, 0, 0, page.width, page.height);
    return { page, shortSide: Math.min(bitmap.width, bitmap.height) };
  } finally {
    bitmap.close();
  }
}
async function pdfSample(bytes: ArrayBuffer, worker: PDFWorker) {
  const lib = await import("pdfjs-dist");
  lib.GlobalWorkerOptions.workerSrc = "/api/pdf-worker";
  const task = lib.getDocument({
    worker,
    data: new Uint8Array(bytes),
    useWasm: false,
    stopAtErrors: true,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 500)
      throw new Error("Print batches support up to 500 pages.");
    const [actions, attachments, fields, metadata] = await Promise.all([
      pdf.getJSActions(), pdf.getAttachments(), pdf.getFieldObjects(), pdf.getMetadata(),
    ]);
    if ("IsXFAPresent" in metadata.info && metadata.info.IsXFAPresent)
      throw new Error("Save a print copy of this dynamic form and add it again.");
    const warnings: string[] = [];
    if (fields && Object.keys(fields).length)
      warnings.push("Filled form fields will be converted to fixed print content. Check the prepared preview.");
    if (attachments?.size)
      warnings.push("Embedded attachments are excluded. Add those files separately if you want to print them.");
    if (actions && Object.keys(actions).length)
      warnings.push("Document actions will be removed from the print copy.");
    const first = await pdf.getPage(1);
    const content = await first.getTextContent();
    const native = content.items.map(i => "str" in i ? i.str : "").join(" ");
    const base = first.getViewport({ scale: 1 }),
      viewport = first.getViewport({
        scale: Math.min(2, (native.trim().length >= 12 ? 480 : 1100) / Math.max(base.width, base.height)),
      });
    const page = canvas(viewport.width, viewport.height);
    await first.render({ canvas: page, viewport }).promise;
    let otherColor = false,
      mixedOrientation = false,
      sensitive = privateText.test(native),
      markup = (await first.getAnnotations()).some(annotation => !["Link", "Widget"].includes(annotation.subtype));
    otherColor = characteristics(page).colored;
    for (let n = 2; n <= pdf.numPages; n++) {
      const sheet = await pdf.getPage(n),
        size = sheet.getViewport({ scale: 1 });
      markup ||= (await sheet.getAnnotations()).some(annotation => !["Link", "Widget"].includes(annotation.subtype));
      mixedOrientation ||=
        size.width > size.height !== base.width > base.height;
      if (!sensitive) {
        const text = await sheet.getTextContent();
        sensitive = privateText.test(
          text.items.map((i) => ("str" in i ? i.str : "")).join(" "),
        );
      }
      if (!otherColor) {
        const vp = sheet.getViewport({
            scale: 140 / Math.max(size.width, size.height),
          }),
          sample = canvas(vp.width, vp.height);
        await sheet.render({ canvas: sample, viewport: vp }).promise;
        otherColor = characteristics(sample).colored;
      }
      sheet.cleanup();
    }
    if (markup) warnings.push("PDF comments and annotation layers are excluded. Check the prepared preview.");
    return {
      page,
      native,
      pages: pdf.numPages,
      shortSide: Infinity,
      otherColor,
      mixedOrientation,
      sensitive,
      warnings,
    };
  } finally {
    await task.destroy();
  }
}
function characteristics(source: HTMLCanvasElement) {
  const sample = canvas(180, 180);
  const ctx = sample.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, 180, 180);
  const { data } = ctx.getImageData(0, 0, 180, 180);
  let color = 0,
    sum = 0,
    squares = 0,
    edges = 0,
    focus = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (Math.max(r, g, b) - Math.min(r, g, b) > 25) color++;
    const value = 0.299 * r + 0.587 * g + 0.114 * b;
    sum += value;
    squares += value * value;
    if (i % 720 > 0) edges += Math.abs(r - data[i - 4]);
  }
  for (let y = 1; y < 179; y++)
    for (let x = 1; x < 179; x++) {
      const i = 4 * (y * 180 + x),
        lap =
          4 * data[i] -
          data[i - 4] -
          data[i + 4] -
          data[i - 720] -
          data[i + 720];
      focus += lap * lap;
    }
  const n = data.length / 4;
  return {
    colored: color / n > 0.005,
    contrast: Math.sqrt(squares / n - (sum / n) ** 2),
    detail: edges / n,
    focus: focus / n,
  };
}
export async function inspectFiles(
  files: File[],
  progress: (message: string) => void,
  review: {
    include: (file: File) => boolean;
    accept: (item: PrintFile) => void;
    reject: (file: File, error: unknown) => void;
  },
  skipText: AbortSignal,
) {
  let worker: Worker | undefined;
  let pdfWorker: PDFWorker | undefined;
  const checked = new Map<string, PrintFile>();
  const stopReading = () => { void worker?.terminate(); worker = undefined; };
  skipText.addEventListener("abort", stopReading);
  try {
    for (const [index, file] of files.entries()) {
      if (!review.include(file)) continue;
      const label = (index + 1) + " of " + files.length + " · " + (file.webkitRelativePath || file.name);
      progress("Checking " + label);
      try {
        const pdf = /\.pdf$/i.test(file.name);
        const bytes = pdf ? await file.arrayBuffer() : undefined;
        let fingerprint: string | undefined;
        if (bytes && files.length > 1 && crypto.subtle) {
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          fingerprint = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
          const earlier = checked.get(fingerprint);
          if (earlier) {
            review.accept({ ...earlier, file, sensitive: earlier.sensitive || privateText.test(file.name) });
            continue;
          }
        }
        if (pdf && !pdfWorker) {
          const lib = await import("pdfjs-dist");
          lib.GlobalWorkerOptions.workerSrc = "/api/pdf-worker";
          pdfWorker = new lib.PDFWorker();
          await pdfWorker.promise;
        }
        const source = pdf
          ? await pdfSample(bytes!, pdfWorker!)
          : {
              ...(await imagePage(file)),
              pages: 1,
              native: "",
              otherColor: false,
              mixedOrientation: false,
              sensitive: false,
              warnings: [],
            };
        const { page } = source,
          { colored, contrast, detail, focus } = characteristics(page),
          warnings = source.warnings;
        let words = source.native;
        let textUnchecked = words.trim().length < 12;
        if (textUnchecked && !skipText.aborted) {
          progress("Reading text " + label);
          let cancel: (() => void) | undefined;
          try {
            const recognize = async () => {
              const { createWorker, OEM } = await import("tesseract.js");
              if (skipText.aborted) throw new Error("Skipped");
              worker ??= await createWorker("eng", OEM.LSTM_ONLY, {
                workerPath: "/api/print-assistant/worker.min.js",
                corePath: "/api/print-assistant/core.wasm.js",
                langPath: "/api/print-assistant",
                workerBlobURL: false,
              });
              if (skipText.aborted) { stopReading(); throw new Error("Skipped"); }
              return worker.recognize(page);
            };
            const stopped = new Promise<never>((_, reject) => {
              cancel = () => reject(new Error("Skipped"));
              skipText.addEventListener("abort", cancel, { once: true });
            });
            const { data } = await Promise.race([recognize(), stopped]);
            textUnchecked = false;
            words = data.text;
            if (words.trim().length > 2 && data.confidence < 65)
              warnings.push(
                "English text was hard to read. Check focus or use a clearer scan.",
              );
          } catch {
            if (!skipText.aborted) warnings.push(
              "Text recognition unavailable. Inspect the preview before printing.",
            );
          } finally { if (cancel) skipText.removeEventListener("abort", cancel); }
        }
        if (source.mixedOrientation)
          warnings.push(
            "This PDF has both portrait and landscape pages. Review the layout before checkout.",
          );
        if (!pdf && contrast > 28 && focus < 22)
          warnings.push("Edges look soft. Consider retaking the photo in focus.");
        if (source.shortSide < 1000)
          warnings.push(
            "Low resolution for a full A4 print. A larger original will print more clearly.",
          );
        if (contrast < 28 || detail < 1.8)
          warnings.push(
            "Low contrast or very little detail. Review the original.",
          );
        const ratio = Math.min(160 / page.width, 240 / page.height);
        const thumb = canvas(page.width * ratio, page.height * ratio);
        thumb.getContext("2d")!.drawImage(page, 0, 0, thumb.width, thumb.height);
        const result: PrintFile = {
          file,
          pdf,
          pages: source.pages,
          landscape: page.width > page.height,
          colored: colored || source.otherColor,
          sensitive:
            source.sensitive || privateText.test(words),
          warnings,
          textUnchecked,
          rotation: 0,
          enhance: false,
          thumbnail: thumb.toDataURL("image/jpeg", 0.8),
        };
        if (fingerprint) checked.set(fingerprint, result);
        review.accept({ ...result, sensitive: result.sensitive || privateText.test(file.name) });
      } catch (error) {
        review.reject(file, error);
      }
    }
  } finally {
    skipText.removeEventListener("abort", stopReading);
    pdfWorker?.destroy();
    await worker?.terminate();
  }
}
export async function prepareBatch(files: PrintFile[]) {
  if (files.length === 1 && !files[0].pdf && !files[0].enhance && !files[0].rotation)
    return files[0].file;
  const { PDFDocument, PDFDict, PDFName, degrees } = await import("pdf-lib"),
    packet = await PDFDocument.create();
  for (const item of files) {
    if (item.pdf) {
      let source;
      try {
        source = await PDFDocument.load(await item.file.arrayBuffer(), { updateMetadata: false });
        const form = source.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
        if (form?.has(PDFName.of("XFA"))) {
          throw new Error("Save a print copy of this dynamic form and add it again.");
        }
        if (form) source.getForm().flatten();
      } catch (error) {
        throw new Error(item.file.name + " — " + (error instanceof Error ? error.message : "Unable to prepare this PDF."));
      }
      for (const page of source.getPages()) {
        page.node.delete(PDFName.of("Annots"));
        page.node.delete(PDFName.of("AA"));
      }
      for (const p of await packet.copyPages(source, source.getPageIndices())) {
        p.setRotation(degrees((p.getRotation().angle + item.rotation) % 360));
        packet.addPage(p);
      }
    } else {
      const { page } = await imagePage(item.file, true),
        turn = item.rotation % 180 !== 0;
      const result = canvas(
          turn ? page.height : page.width,
          turn ? page.width : page.height,
        ),
        ctx = result.getContext("2d")!;
      ctx.translate(result.width / 2, result.height / 2);
      ctx.rotate((item.rotation * Math.PI) / 180);
      if (item.enhance) ctx.filter = "contrast(1.22)";
      ctx.drawImage(page, -page.width / 2, -page.height / 2);
      const jpeg = await new Promise<Blob>((resolve, reject) =>
        result.toBlob(
          (blob) =>
            blob
              ? resolve(blob)
              : reject(new Error("Unable to prepare photo.")),
          "image/jpeg",
          0.95,
        ),
      );
      const img = await packet.embedJpg(await jpeg.arrayBuffer()),
        wide = result.width > result.height;
      const sheet = packet.addPage(wide ? [842, 595] : [595, 842]);
      const fit = img.scaleToFit(sheet.getWidth() - 24, sheet.getHeight() - 24);
      sheet.drawImage(img, {
        x: (sheet.getWidth() - fit.width) / 2,
        y: (sheet.getHeight() - fit.height) / 2,
        ...fit,
      });
    }
  }
  const bytes = await packet.save();
  return new File(
    [Uint8Array.from(bytes)],
    files.length === 1
      ? files[0].pdf ? files[0].file.name : files[0].file.name.replace(/\.[^.]+$/, "") + " adjusted.pdf"
      : "Print batch (" + files.length + " files).pdf",
    { type: "application/pdf" },
  );
}
