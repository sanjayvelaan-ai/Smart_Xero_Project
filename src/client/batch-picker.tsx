"use client";
import { useRef, useState } from "react";
import { Files, FolderOpen, RotateCw, ScanLine, X } from "lucide-react";
import { ErrorBox, message } from "./shared";
import type { PrintFile } from "./preflight";

let warming: Promise<unknown> | undefined;
function warmReview() {
  warming ??= Promise.all([
    import("./preflight"), import("pdfjs-dist"),
    fetch("/api/pdf-worker", {cache:"force-cache"}).then(r => r.arrayBuffer()),
  ]).catch(() => { warming = undefined; });
}

// A directory reader may return several batches before the terminating empty batch.
async function droppedFiles(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    return [file];
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const entries: FileSystemEntry[] = [];
  while (true) {
    const part = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (!part.length) break;
    entries.push(...part);
  }
  entries.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  const files: File[] = [];
  for (const child of entries) files.push(...(await droppedFiles(child)));
  return files;
}

export function BatchPicker({
  disabled,
  onPrepare,
  onBusy,
  confidential,
  onAlert,
}: {
  confidential: boolean;
  disabled: boolean;
  onPrepare: (
    f: File,
    items: PrintFile[],
    useSuggestion: boolean,
  ) => Promise<void>;
  onBusy: (busy: boolean) => void;
  onAlert: (message: string, level: "warning" | "error") => void;
}) {
  const [items, setItems] = useState<PrintFile[]>([]),
    [note, setNote] = useState(""),
    [error, setError] = useState("");
  const [useSuggestion, setSuggestion] = useState(false);
  const textScan = useRef<AbortController | null>(null);
  const reportError = (text: string) => { setError(text); onAlert(text, "error"); };
  const input = useRef<HTMLInputElement>(null),
    folder = useRef<HTMLInputElement>(null),
    lock = useRef(false);
  async function add(files: File[]) {
    if (!files.length || disabled || lock.current) return;
    lock.current = true;
    onBusy(true);
    setError("");
    try {
      const candidates = files.filter((f) =>
        /\.(pdf|png|jpe?g)$/i.test(f.name),
      );
      if (!candidates.length) throw new Error("Select a PDF, JPG or PNG file.");
      const issues: string[] = [];
      const unsupported = files.length - candidates.length;
      if (unsupported) issues.push(unsupported + " unsupported files skipped.");
      let bytes = items.reduce((sum, item) => sum + item.file.size, 0);
      let pages = items.reduce((sum, item) => sum + item.pages, 0);
      const found: PrintFile[] = [];
      textScan.current = new AbortController();
      const { inspectFiles } = await import("./preflight");
      await inspectFiles(candidates, setNote, {
        include(file) {
          if (items.length + found.length < 50 && bytes + file.size <= 20 * 1024 * 1024) return true;
          issues.push(file.name + " — Exceeds the 50-file or 20 MB batch limit.");
          return false;
        },
        accept(item) {
          if (pages + item.pages > 500) {
            issues.push(item.file.name + " — Exceeds the 500-page batch limit.");
            return;
          }
          pages += item.pages;
          bytes += item.file.size;
          found.push(item);
          setItems([...items, ...found]);
        },
        reject(file, error) { issues.push(file.name + " — " + message(error)); },
      }, textScan.current.signal);
      setItems([...items, ...found]);
      setError(issues.join("\n"));
      const flagged = found.filter(item => item.warnings.length || item.sensitive).length;
      if (issues.length || flagged) {
        const summary = [
          issues.length ? "Some files were skipped." : "",
          flagged ? `${flagged} ${flagged === 1 ? "file has" : "files have"} print notices.` : "",
          "See the upload review for details.",
        ].filter(Boolean).join(" ");
        onAlert(summary, found.length ? "warning" : "error");
      }
    } catch (e) {
      reportError(message(e));
    } finally {
      textScan.current = null;
      lock.current = false;
      setNote("");
      onBusy(false);
      if (input.current) input.current.value = "";
      if (folder.current) folder.current.value = "";
    }
  }
  async function prepare() {
    if (lock.current || !items.length) return;
    lock.current = true;
    setNote("Preparing print file…");
    onBusy(true);
    setError("");
    try {
      const { prepareBatch } = await import("./preflight");
      await onPrepare(await prepareBatch(items), items, useSuggestion);
    } catch (e) {
      reportError(message(e));
    } finally {
      lock.current = false;
      setNote("");
      onBusy(false);
    }
  }
  const change = (index: number, next: Partial<PrintFile>) =>
    setItems(
      items.map((item, i) => (i === index ? { ...item, ...next } : item)),
    );
  return (
    <div className="batch-picker">
      <input
        className="sr-only"
        ref={input}
        multiple
        type="file"
        aria-label="Choose documents"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={(e) => void add(Array.from(e.target.files ?? []))}
      />
      <input
        className="sr-only"
        ref={folder}
        type="file"
        multiple
        {...{ webkitdirectory: "" }}
        aria-label="Choose print folder"
        onChange={(e) =>
          void add(
            Array.from(e.target.files ?? []).sort((a, b) =>
              a.webkitRelativePath.localeCompare(
                b.webkitRelativePath,
                undefined,
                { numeric: true },
              ),
            ),
          )
        }
      />
      <div
        className="dropzone"
        onPointerEnter={warmReview}
        onFocus={warmReview}
        onDragEnter={warmReview}
        onDragOver={(e) => e.preventDefault()}
        onDrop={async (e) => {
          e.preventDefault();
          if (disabled || lock.current) return;
          const entries = Array.from(e.dataTransfer.items, (item) =>
            item.webkitGetAsEntry?.(),
          ).filter((entry): entry is FileSystemEntry => !!entry);
          if (!entries.some((entry) => entry.isDirectory)) {
            void add(Array.from(e.dataTransfer.files));
            return;
          }
          lock.current = true;
          setNote("Reading folders…");
          onBusy(true);
          let files: File[] = [];
          try {
            files = (await Promise.all(entries.map(droppedFiles))).flat();
          } catch (failure) {
            reportError(message(failure));
          } finally {
            lock.current = false;
            setNote("");
            onBusy(false);
          }
          await add(files);
        }}
      >
        <Files />
        <strong>
          {items.length
            ? "Add to your batch"
            : "Drop print files or folders here"}
        </strong>
        <div className="inline-actions">
          <button
            className="button outline"
            disabled={disabled || !!note}
            onClick={() => input.current?.click()}
          >
            Choose files
          </button>
          <button
            className="button outline"
            disabled={disabled || !!note}
            onClick={() => folder.current?.click()}
          >
            <FolderOpen size={16} />
            Choose folder
          </button>
        </div>
      </div>
      {note && <p role="status">{note}</p>}
      {note && textScan.current && !textScan.current.signal.aborted && <button className="text-button"
        onClick={() => { textScan.current?.abort(); setNote("Finishing visual checks…"); }}>
        Skip remaining text scans
      </button>}
      <div className="batch-issues"><ErrorBox>{error}</ErrorBox></div>
      {items.length > 0 && (
        <section className="file-review">
          <h4>
            <ScanLine size={18} />
            Print assistant
          </h4>
          <p>
            Color and layout are checked on every page. English text recognition
            checks photos and PDF covers with no text layer.
          </p>
          {items.map((item, i) => (
            <article key={i} className="review-file">
              <div className="thumb-frame">
                {confidential || item.sensitive || item.textUnchecked ? (
                  <span>Private</span>
                ) : (
                  <img
                    alt={"Preview of " + item.file.name}
                    src={item.thumbnail}
                    style={{
                      transform: "rotate(" + item.rotation + "deg)",
                      filter: item.enhance ? "contrast(1.22)" : "",
                    }}
                  />
                )}
              </div>
              <div>
                <strong>
                  {i + 1}. {item.file.webkitRelativePath || item.file.name}
                </strong>
                <p>
                  {item.pages} pages ·{" "}
                  {(item.rotation % 180 ? !item.landscape : item.landscape)
                    ? "Landscape"
                    : "Portrait"}{" "}
                  · {item.colored ? "Color detected" : "Looks monochrome"}
                </p>
                {item.sensitive && (
                  <p>
                    Possible identity document. Confidential printing will be
                    selected.
                  </p>
                )}
                {item.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
                {item.textUnchecked && <p>Text scan incomplete. Confidential printing will be selected.</p>}
                <div className="inline-actions">
                  <button
                    disabled={!!note}
                    className="text-button"
                    onClick={() =>
                      change(i, { rotation: (item.rotation + 90) % 360 })
                    }
                  >
                    <RotateCw size={14} />
                    Rotate
                  </button>
                  {!item.pdf && (
                    <label>
                      <input
                        disabled={!!note}
                        type="checkbox"
                        checked={item.enhance}
                        onChange={(e) =>
                          change(i, { enhance: e.target.checked })
                        }
                      />{" "}
                      Improve contrast
                    </label>
                  )}
                  {i > 0 && (
                    <button
                      disabled={!!note}
                      className="text-button"
                      onClick={() => {
                        const next = items.slice();
                        [next[i - 1], next[i]] = [next[i], next[i - 1]];
                        setItems(next);
                      }}
                    >
                      Move earlier
                    </button>
                  )}
                  <button
                    disabled={!!note}
                    aria-label={"Remove " + item.file.name}
                    onClick={() => setItems(items.filter((_, j) => j !== i))}
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
            </article>
          ))}
          <label className="check-label">
            <input
              type="checkbox"
              checked={useSuggestion}
              onChange={(e) => setSuggestion(e.target.checked)}
            />{" "}
            Use suggested {items.length > 1 ? "color and orientation for each file" : "print settings · "}{items.length === 1 && <>
            {items.some((i) => i.colored) ? "Color" : "Black & white"} ·{" "}
            {items[0].landscape !== (items[0].rotation % 180 !== 0)
              ? "Landscape"
              : "Portrait"}
            </>}
          </label>
          <button
            className="button primary"
            disabled={!!note || disabled}
            onClick={() => void prepare()}
          >
            Use {items.length} {items.length === 1 ? "file" : "files"} for
            printing
          </button>
        </section>
      )}
    </div>
  );
}
