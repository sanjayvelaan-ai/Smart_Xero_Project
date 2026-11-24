import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

test("folder preflight, private staff preview, QR settlement and courier delivery", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(175000);
  const folder = info.outputPath("folder");
  await mkdir(folder, { recursive: true });
  const sample = await page.request.get("/api/shops/printflow-demo/sample");
  await writeFile(path.join(folder, "01 notes.pdf"), await sample.body());
  await sharp(
    Buffer.from(
      '<svg width="800" height="360"><rect width="800" height="360" fill="white"/><text x="40" y="155" font-size="50" fill="black">PRINT QUALITY TEST</text></svg>',
    ),
  )
    .png()
    .toFile(path.join(folder, "02 Aadhaar test.png"));
  await page.goto("/customer");
  await page.getByLabel("Choose print folder").setInputFiles(folder);
  await expect(
    page.getByRole("button", { name: "Use 2 files for printing" }),
  ).toBeVisible({ timeout: 55000 });
  await expect(page.getByText(/Text recognition unavailable/)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Rotate", exact: true })
    .last()
    .click();
  await page.getByLabel("Improve contrast").check();
  await page.getByRole("button", { name: "Use 2 files for printing" }).click();
  await expect(page.getByText(/^5 pages ·/).first()).toBeVisible();
  await expect(page.getByLabel(/Confidential document ·/)).toBeChecked();
  await page.getByRole("button", { name: "Continue to settings" }).click();
  await page.getByRole("button", { name: "Continue to service" }).click();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const options = page.getByRole("group", { name: "Receive your prints" });
    await expect(options.getByRole("radio", { name: /Shop pickup/ })).toBeChecked();
    for (const radio of await options.getByRole("radio").all()) {
      const box = await radio.boundingBox();
      expect(box?.width).toBe(17);
      expect(box?.height).toBe(17);
    }
    await options.screenshot({ path: info.outputPath("fulfillment-" + width + ".png") });
  }
  await page.getByRole("radio", { name: /Blinkit home delivery/ }).check();
  await expect(
    page.getByRole("button", { name: "Place order" }),
  ).toBeDisabled();
  await page
    .getByLabel("Delivery address")
    .fill("Sample street 10, Chennai 600001");
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByRole("heading", { name: "Print waiting room" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/customer#my-orders");
  const reference = await page
    .getByRole("heading", { name: /^PF-\d+$/ })
    .innerText();
  const order = (
    await (
      await page.request.get("/api/shops/printflow-demo/orders/" + reference)
    ).json()
  ).order;
  await expect(
    page.getByAltText("QR for this simulated print payment"),
  ).toBeVisible();
  const paymentLink = page.getByRole("link", { name: "Open payment page" });
  const paymentPath = (await paymentLink.getAttribute("href"))!;
  await paymentLink.click();
  const printer = page.getByRole("region", { name: "Receipt printer" });
  const nav = page.getByRole("navigation", { name: "Workspaces" });
  await expect(nav.getByRole("link", { name: "Customer portal" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Back to order tracking" })).toBeVisible();
  await expect(printer).toHaveAttribute("data-stage", "processing");
  await expect(printer.getByText("Total paid")).toHaveCount(0);
  await page.getByRole("button", { name: "Confirm simulated payment" }).click();
  await expect(printer).toHaveAttribute("data-stage", "printing");
  await expect(printer.getByRole("heading", { name: "Payment receipt" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Print waiting room" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Order receipt" })).toBeVisible();
  await page.getByRole("button",{name:"Replay receipt animation"}).click();
  await expect(printer).toHaveAttribute("data-stage","printing");
  await expect(printer).toHaveAttribute("data-stage","complete");
  await expect(page.locator(".receipt-paper")).toContainText("Blinkit rider");
  await page.screenshot({ path: info.outputPath("waiting-room.png") });
  const wallet = await browser.newContext({ baseURL });
  const pay = await wallet.newPage();
  await pay.setViewportSize({ width: 375, height: 812 });
  await pay.emulateMedia({ reducedMotion: "reduce" });
  await pay.goto(paymentPath);
  await expect(pay.getByRole("status")).toContainText("Payment confirmed");
  await expect(pay.getByRole("region", { name: "Receipt printer" })).toHaveAttribute("data-stage", "complete");
  await expect.poll(() => pay.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await pay.screenshot({ path: info.outputPath("payment-receipt-mobile.png") });
  await expect(pay.getByRole("link", { name: "Back to order tracking" })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Queued", exact: true }),
  ).toBeVisible();
  await wallet.close();
  const desk = await browser.newContext({ baseURL }),
    staff = await desk.newPage();
  await staff.goto("/owner");
  expect((await staff.request.post("/api/shops/velachery/prototype-sign-in", { data: {} })).status()).toBe(404);
  await staff.getByRole("button", { name: "Enter demo as owner" }).click();
  await staff.getByRole("button", { name: reference, exact: true }).click();
  const dialog = staff.getByRole("dialog");
  await expect(dialog.getByText("Staff preview concealed")).toBeVisible();
  expect(
    (
      await staff.request.get(
        "/api/shops/printflow-demo/staff/orders/" + order.id + "/preview",
      )
    ).status(),
  ).toBe(403);
  await dialog.getByLabel("Compatible printer").selectOption("1");
  await dialog.getByRole("button", { name: "Assign printer" }).click();
  await dialog.getByRole("button", { name: "Start simulated print" }).click();
  await dialog
    .getByRole("button", { name: "Mark ready for pickup" })
    .click({ timeout: 40000 });
  const floor = await desk.newPage();
  await floor.goto("/digital-twin");
  const scene = floor.getByTestId("shop-scene");
  await expect(scene).toHaveAttribute("data-couriers", order.id);
  await expect(scene).toHaveAttribute("data-customers", "");
  await floor.getByRole("button", {name:"Shop alerts", exact:true}).click();
  await expect(floor.getByLabel("Recent shop alerts")).toContainText("Blinkit rider arrived");
  await floor.close();
  await dialog
    .getByLabel("Courier collection OTP")
    .fill(await page.getByLabel("Collection code").innerText());
  await dialog.getByRole("button", { name: "Verify pickup" }).click();
  await page.getByRole("button", { name: "Confirm home delivery" }).click();
  await expect(page.getByText("Your prints were delivered.")).toBeVisible();
  await page.getByRole("link", { name: "Replay my order in 3D" }).click();
  await expect(
    page.getByRole("button", { name: "Return to tracking" }),
  ).toBeVisible();
  const personal = await page.request.get(
    "/api/shops/printflow-demo/orders/" + order.id + "/replay",
  );
  expect(personal.status()).toBe(200);
  const replay = await personal.json();
  expect(replay.snapshot.catalog.map((o: { id: string }) => o.id)).toEqual([
    order.id,
  ]);
  expect(JSON.stringify(replay)).not.toContain("Sample street");
  expect(
    (
      await staff.request.get(
        "/api/shops/printflow-demo/orders/" + order.id + "/replay",
      )
    ).status(),
  ).toBe(401);
  await page.getByRole("button", { name: "Return to tracking" }).click();
  await expect(page.getByRole("heading", { name: reference })).toBeVisible();
  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await expect(page.getByRole("link", { name: new RegExp(reference) })).toBeVisible();
  await dialog.getByRole("link", { name: "Replay order journey" }).click();
  await expect(
    staff.getByRole("button", { name: "Return to live" }),
  ).toBeVisible();
  await expect(staff.getByTestId("shop-scene")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  for (const [width, height] of [
    [390, 844],
    [844, 390],
    [1440, 900],
  ]) {
    await staff.setViewportSize({ width, height });
    const viewport = await staff.getByTestId("shop-scene").boundingBox();
    expect(viewport?.width).toBeGreaterThan(width * 0.55);
    expect(viewport?.height).toBeGreaterThan(180);
    if (width === 844) {
      const controls = await staff.locator(".camera-strip").boundingBox();
      expect(controls!.y + controls!.height).toBeLessThanOrEqual(height + 1);
      await staff.screenshot({ path: info.outputPath("shop-landscape.png") });
    }
    await expect
      .poll(() => staff.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
  }
  await staff.getByRole("link", { name: "Back to dashboard" }).click();
  await expect(
    page.getByRole("button", { name: "Choose files", exact: true }),
  ).toBeVisible();
  await expect(
    staff.getByRole("heading", { name: "Welcome, Ram" }),
  ).toBeVisible();
  for (const view of [staff, page]) {
    for (const [width, height] of [
      [390, 844],
      [844, 390],
      [1440, 900],
    ]) {
      await view.setViewportSize({ width, height });
      await expect
        .poll(() => view.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
    }
  }
  await desk.close();
});

test("schedule and settle a booking, then print and collect a walk-in from an idle device", async ({page, context}) => {
  test.setTimeout(150000);
  async function checkout() {
    await page.goto("/customer");
    await page.getByRole("button", {name:"Use a sample PDF"}).click();
    for (const step of ["settings","service","payment"])
      await page.getByRole("button",{name:"Continue to "+step}).click();
  }
  await checkout();
  await page.getByLabel("When do you need your prints?").selectOption("scheduled");
  const calendar = page.getByRole("region", { name: "Collection calendar" });
  const exactTime = calendar.getByLabel("Collection time at the shop");
  await expect.poll(() => calendar.evaluate(el => el.clientHeight)).toBeLessThan(600);
  await expect(page.getByRole("button", { name: "Place order" })).toBeDisabled();
  const indiaTime = new Date(Date.now() + 3600000 + 330 * 60000).toISOString().slice(0,16);
  await exactTime.fill(indiaTime);
  await expect(calendar.getByText(/Prepay to confirm/)).toBeVisible();
  const slots = calendar.getByRole("group", { name: "Available collection times" });
  const preset = slots.getByRole("button").last();
  await preset.click();
  await expect(preset).toHaveAttribute("aria-pressed", "true");
  await expect(exactTime).toHaveValue(indiaTime.slice(0, 11) + await preset.innerText());
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(() => calendar.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByRole("button",{name:"Place order"}).click();
  const reference = await page.getByRole("heading",{name:/^PF-/}).innerText();
  const staff = await context.newPage();
  await staff.goto("/owner");
  await staff.getByRole("button",{name:"Enter demo as owner"}).click();
  await staff.getByRole("button",{name:reference,exact:true}).click();
  await staff.getByRole("button",{name:"Confirm simulated payment"}).click();
  await expect(page.getByRole("heading",{name:"Scheduled",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Cancel order",exact:true}).click();
  await page.getByRole("button",{name:"Confirm cancellation"}).click();
  await expect(page.getByRole("heading",{name:"Cancelled",exact:true})).toBeVisible();
  await checkout();
  await page.getByRole("button",{name:"Place order"}).click();
  const walkIn = await page.getByRole("heading",{name:/^PF-/}).innerText();
  await page.getByRole("button",{name:"Simulate payment",exact:true}).click();
  await staff.goto("/owner/printers");
  await staff.getByRole("button",{name:"Print "+walkIn,exact:true}).first().click();
  await expect(page.getByRole("heading",{name:"Printing",exact:true})).toBeVisible();
  await staff.goto("/digital-twin");
  await expect(staff.getByTestId("shop-scene")).toHaveAttribute("data-rendered","true");
  await expect(page.getByRole("heading",{name:"Completed",exact:true})).toBeVisible({timeout:70000});
  await staff.getByRole("button",{name:"Shop alerts",exact:true}).click();
  await expect(staff.getByLabel("Recent shop alerts")).toContainText("Collection completed");
  await staff.getByRole("button", { name: "Shop alerts", exact: true }).click();
  await staff.getByRole("button", { name: "Timeline", exact: true }).click();
  await staff.getByLabel("Speed").selectOption("4");
  await expect(staff.getByTestId("shop-scene")).toHaveAttribute("data-residents","0",{timeout:35000});
  await staff.getByRole("link", { name: "Back to dashboard" }).click();
  await staff.getByRole("button", { name: "Notifications" }).click();
  await expect(staff.getByRole("dialog", { name: "Notifications" })).toContainText("Collection completed " + walkIn);
});
