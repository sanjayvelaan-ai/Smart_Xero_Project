import { readFile } from "node:fs/promises";
import path from "node:path";

const assets: Record<string, string> = {
  "worker.min.js": "tesseract.js/dist/worker.min.js",
  "core.wasm.js": "tesseract.js-core/tesseract-core-lstm.wasm.js",
  "eng.traineddata.gz":
    "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
};
export const dynamic = "force-static";
export const dynamicParams = false;
export function generateStaticParams() {
  return Object.keys(assets).map(asset => ({ asset }));
}
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ asset: string }> },
) {
  const { asset } = await params;
  if (!Object.hasOwn(assets, asset)) return new Response(null, { status: 404 });
  const bytes = await readFile(
    path.join(process.cwd(), "node_modules", assets[asset]),
  );
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": asset.endsWith(".js")
        ? "text/javascript"
        : "application/octet-stream",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
