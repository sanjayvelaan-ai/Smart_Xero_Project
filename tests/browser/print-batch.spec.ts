import { expect, test } from "@playwright/test";
import { PDFDocument, PDFName } from "pdf-lib";
import { randomUUID } from "node:crypto";

test("PDF batches retain printable forms, skip bad files and save individual settings", async ({ page, browser, baseURL }) => {
  const notes = await page.request.get("/api/shops/printflow-demo/sample");
  const form = await PDFDocument.create();
  const sheet = form.addPage();
  sheet.drawText("Printable cover for the PDF batch", { x: 30, y: 500 });
  const field = form.getForm().createTextField("project");
  field.addToPage(sheet, { x: 30, y: 400, width: 300, height: 20 });
  field.setText("FORM VALUE FOR PRINT");
  await form.attach(new Uint8Array([1, 2, 3]), "reference.bin");
  await page.goto("/customer");
  await page.getByLabel("Choose documents").setInputFiles([
    { name: "Notes.pdf", mimeType: "application/pdf", buffer: await notes.body() },
    { name: "Signed form.pdf", mimeType: "application/pdf", buffer: Buffer.from(await form.save()) },
    { name: "Broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("invalid") },
  ]);
  await expect(page.locator(".print-notice")).toContainText("Some files were skipped.");
  await expect(page.locator(".batch-issues")).toContainText("Broken.pdf");
  await expect(page.getByText(/Embedded attachments are excluded/)).toBeVisible();
  await page.getByRole("button", { name: "Use 2 files for printing" }).click();
  await expect(page.locator(".print-notice")).toContainText("2 files uploaded.");
  await page.getByRole("button", { name: "Continue to settings" }).click();
  const first = page.getByRole("group", { name: "Settings for Notes.pdf" });
  await first.getByLabel("Pages", { exact: true }).fill("2-3");
  await first.getByLabel("Copies").fill("2");
  await page.locator("summary").filter({ hasText: "Signed form.pdf" }).click();
  const second = page.getByRole("group", { name: "Settings for Signed form.pdf" });
  await second.getByLabel("Color mode").selectOption("COLOR");
  await second.getByLabel("Paper size").selectOption("A3");
  await expect(page.locator(".summary-total")).toContainText("₹20");
  await page.getByRole("button", { name: "Continue to service" }).click();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: "Place order" }).click();
  const token = await page.getByRole("heading", { name: /^PF-\d+$/ }).innerText();
  await expect(page.getByRole("region", { name: "Per-file print settings" })).toContainText("Signed form.pdf");
  const order = (await (await page.request.get("/api/shops/printflow-demo/orders/" + token)).json()).order;
  await page.getByRole("button", { name: "Simulate payment" }).click();
  const staff = await browser.newContext({ baseURL });
  try {
    const owner = await staff.newPage();
    await owner.goto("/owner");
    await owner.getByRole("button", { name: "Enter demo as owner" }).click();
    await owner.getByRole("button", { name: token, exact: true }).click();
    const dialog = owner.getByRole("dialog", { name: token });
    const batch = dialog.getByRole("region", { name: "Per-file print settings" });
    await expect(batch).toContainText("Packet pages 2-3 · 2 copies · B&W");
    await expect(batch).toContainText("Packet pages 5 · 1 copy · Color");
    await expect(dialog.getByLabel("Compatible printer").locator('option[value="2"]')).toHaveCount(1);
    await dialog.getByLabel("Compatible printer").selectOption("2");
    await dialog.getByRole("button", { name: "Assign printer" }).click();
    const response = await owner.request.get("/api/shops/printflow-demo/staff/orders/" + order.id + "/preview");
    expect(response.ok()).toBeTruthy();
    const packetBytes = await response.body();
    const packet = await PDFDocument.load(packetBytes);
    expect(packet.getPageCount()).toBe(5);
    expect(packet.catalog.has(PDFName.of("AcroForm"))).toBe(false);
    expect(packet.catalog.has(PDFName.of("Names"))).toBe(false);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({ data: Uint8Array.from(packetBytes), verbosity: 0 });
    try {
      const pdf = await task.promise;
      const content = await (await pdf.getPage(5)).getTextContent();
      expect(content.items.map(item => "str" in item ? item.str : "").join(" ")).toContain("FORM VALUE FOR PRINT");
    } finally {
      await task.destroy();
    }
  } finally {
    try {
      const cleanup = await staff.request.post("/api/shops/printflow-demo/staff/orders/" + order.id + "/command", {
        data: { key: randomUUID(), command: { action: "cancel", reason: "Batch print test completed" } },
      });
      expect(cleanup.ok()).toBeTruthy();
    } finally {
      await staff.close();
    }
  }
});
