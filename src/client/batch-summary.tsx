import { pageNumbers, type BatchFile } from "@/domain";

function packetRange(file: BatchFile, offset: number) {
  const ranges: [number, number][] = [];
  for (const local of pageNumbers(file.settings.pages, file.pageCount)) {
    const page = offset + local;
    const last = ranges.at(-1);
    if (last && last[1] === page - 1) last[1] = page;
    else ranges.push([page, page]);
  }
  return ranges.map(([first, last]) => first === last ? String(first) : `${first}-${last}`).join(", ");
}

export function BatchSummary({ files, staff = false }: { files: BatchFile[]; staff?: boolean }) {
  let offset = 0;
  return <section className="batch-summary" aria-label="Per-file print settings">
    <h3>Per-file print settings</h3>
    {staff && <p className="muted">Use the packet page range and settings below for each file when printing the combined PDF.</p>}
    <ol>{files.map((file, index) => {
      const { settings } = file;
      const range = staff ? packetRange(file, offset) : settings.pages || "All";
      offset += file.pageCount;
      return <li key={index}>
        <strong>{index + 1}. {file.name}</strong>
        <p>{staff ? "Packet pages" : "Pages"} {range} · {settings.copies} {settings.copies === 1 ? "copy" : "copies"} · {settings.color === "COLOR" ? "Color" : "B&W"}</p>
        <p>{settings.size} · {settings.layout === "LANDSCAPE" ? "Landscape" : "Portrait"} · {settings.duplex ? "Double-sided" : "Single-sided"} · {settings.paper === "PREMIUM" ? "Premium paper" : "Standard paper"}
          {settings.finishing !== "NONE" && (settings.finishing === "STAPLE" ? " · Staple" : " · Bind")}
          {settings.collate && settings.copies > 1 && " · Collate"}</p>
        {settings.instructions && <p>{settings.instructions}</p>}
      </li>;
    })}</ol>
  </section>;
}
