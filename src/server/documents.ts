import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { DomainError, type Privacy } from "../domain";
import { brandName } from "../lib/brand";
import { dataPath, type Sql } from "./db";

export const maxFileBytes = 20 * 1024 * 1024;
const pdfHeader = Buffer.from("%PDF-");
const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export type DocumentRow = {
  id: string; shop_id: string; customer_id: string; file_name: string; media_type: string; bytes: number;
  pages: number; privacy: Privacy; expires_at: Date; purge_attempts: number;
};

export async function uploadBytes(request: Request) {
  const length = Number(request.headers.get("content-length"));
  if (length > maxFileBytes) throw new DomainError("Choose a file under 20 MB.", 413);
  if (!request.body) throw new DomainError("Choose a document to upload.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxFileBytes) {
        await reader.cancel();
        throw new DomainError("Choose a file under 20 MB.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export async function inspectDocument(data: Buffer, requestedName: string) {
  const isPdf = data.subarray(0, 5).equals(pdfHeader);
  const isPng = data.subarray(0, 8).equals(pngHeader);
  const isJpg = data[0] === 255 && data[1] === 216 && data[2] === 255;
  if (!isPdf && !isPng && !isJpg) throw new DomainError("Upload a valid PDF, PNG or JPG.");
  const extension = isPdf ? ".pdf" : isPng ? ".png" : ".jpg";
  const mediaType = isPdf ? "application/pdf" : isPng ? "image/png" : "image/jpeg";
  const base = requestedName.split(/[\\/]/).pop()?.replace(/\.[^.]*$/, "").replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 90);
  let pages = 1;
  let content = data;
  try {
    if (isPdf) {
      if (/\/(?:JavaScript|JS|OpenAction|Launch|EmbeddedFile|RichMedia|XFA|SubmitForm|ImportData)\b/.test(data.toString("latin1"))) {
        throw new DomainError("Export a static PDF without actions, forms, or attachments.");
      }
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs")).href;
      const task = pdfjs.getDocument({ data: Uint8Array.from(data), stopAtErrors: true, verbosity: 0 });
      try {
        const pdf = await task.promise;
        pages = pdf.numPages;
        if (pages < 1 || pages > 500) throw new DomainError("Upload a document with 1–500 pages.");
        const [actions, attachments, fields] = await Promise.all([
          pdf.getJSActions(), pdf.getAttachments(), pdf.getFieldObjects(),
        ]);
        if (attachments?.size || [actions, fields].some(entries => entries && Object.keys(entries).length)) {
          throw new DomainError("Export a static PDF without actions, forms, or attachments.");
        }
        for (let index = 1; index <= pages; index++) {
          const page = await pdf.getPage(index);
          const annotations = await page.getAnnotations();
          if (annotations.some(annotation => (annotation.actions && Object.keys(annotation.actions).length) ||
            annotation.attachment || ["Widget", "FileAttachment", "RichMedia", "Screen", "Movie", "Sound"].includes(annotation.subtype))) {
            throw new DomainError("Export a static PDF without interactive content.");
          }
          page.cleanup();
        }
      } finally {
        await task.destroy();
      }
    } else {
      const image = sharp(data, { failOn: "warning", limitInputPixels: 32_000_000 }).autoOrient();
      content = isPng ? await image.png().toBuffer() : await image.jpeg({ quality: 95 }).toBuffer();
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("This file is damaged, password-protected, or could not be safely opened.");
  }
  if (content.length > maxFileBytes) throw new DomainError("The processed file exceeds 20 MB.", 413);
  return { fileName: (base || "Print document") + extension, mediaType, pages, content };
}

const docs = () => path.join(dataPath(), "documents");
const location = (id: string) => path.join(docs(), id + ".enc");
let localKey: Promise<Buffer> | undefined;
async function encryptionKey(real: boolean) {
  const provided = process.env.PRINTFLOW_DOCUMENT_KEY;
  if (provided) {
    const key = Buffer.from(provided, "base64");
    if (key.length !== 32) throw new Error("PRINTFLOW_DOCUMENT_KEY must encode 32 bytes.");
    return key;
  }
  if (real) throw new DomainError("Temporary storage has not been configured for this shop.", 503);
  localKey ??= (async () => {
    await mkdir(dataPath(), { recursive: true });
    const keyPath = path.join(dataPath(), "demo.key");
    try {
      const key = await open(keyPath, "wx", 0o600);
      try { await key.writeFile(randomBytes(32)); } finally { await key.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return readFile(keyPath);
  })().catch(error => { localKey = undefined; throw error; });
  return localKey;
}

export async function saveDocument(tx: Sql, shopId: string, customer: string, real: boolean,
  doc: Awaited<ReturnType<typeof inspectDocument>>, id = randomUUID()) {
  const key = await encryptionKey(real);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(shopId + "/" + id));
  const encrypted = Buffer.concat([cipher.update(doc.content), cipher.final()]);
  await mkdir(docs(), { recursive: true, mode: 0o700 });
  await writeFile(location(id), Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { flag: "wx", mode: 0o600 });
  try {
    await tx.rows(`INSERT INTO documents (id,shop_id,customer_id,file_name,media_type,bytes,pages,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,now()+interval '24 hours')`, [id, shopId, customer, doc.fileName, doc.mediaType, doc.content.length, doc.pages]);
  } catch (error) {
    await removeDocument(id);
    throw error;
  }
  return { id, name: doc.fileName, pages: doc.pages, size: doc.content.length };
}

export async function readDocument(doc: DocumentRow, real: boolean) {
  const key = await encryptionKey(real);
  const encrypted = await readFile(location(doc.id));
  const decipher = createDecipheriv("aes-256-gcm", key, encrypted.subarray(0, 12));
  decipher.setAAD(Buffer.from(doc.shop_id + "/" + doc.id));
  decipher.setAuthTag(encrypted.subarray(12, 28));
  return Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]);
}

export async function removeDocument(id: string) {
  try { await unlink(location(id)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

export function samplePdf(pages = 4) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => (4 + i * 2) + " 0 R").join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let page = 1; page <= pages; page++) {
    const source = `BT /F1 32 Tf 62 730 Td (${brandName} sample) Tj 0 -46 Td /F1 14 Tf (Demo document - page ${page} of ${pages}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`);
    objects.push(`<< /Length ${source.length} >>\nstream\n${source}\nendstream`);
  }
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((value, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${value}\nendobj\n`;
    return offset;
  });
  return Buffer.from(pdf + `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${pdf.length}\n%%EOF\n`);
}
