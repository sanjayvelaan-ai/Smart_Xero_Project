import { expect, test, type Page } from "@playwright/test";
import type { ShopEvent } from "../../src/domain";
import type { Snapshot } from "../../src/twin/state";

const api = "/api/shops/printflow-demo/";
async function placeOrder(page: Page, index: number) {
  await page.goto("/customer");
  await page.getByRole("button", { name: "Use a sample PDF" }).click();
  await page.getByRole("button", { name: "Continue to settings" }).click();
  if (index === 0) await page.getByLabel("Copies").fill("30");
  await page.getByRole("button", { name: "Continue to service" }).click();
  if (index === 1)
    await page.getByRole("button", { name: /Express.*Priority queue/ }).click();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: /Pay at counter/ }).click();
  await page.getByRole("button", { name: "Place order" }).click();
  const reference = page.getByRole("heading", { name: /^PF-\d+$/ });
  await expect(reference).toBeVisible();
  return (await reference.innerText()).trim();
}

test("five orders survive workspace switching, 3D replay, collection and refresh", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(210000);
  const tokens: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const snapshot = async (): Promise<Snapshot> =>
    (await page.request.get(api + "staff/projection")).json();
  const events = async (): Promise<ShopEvent[]> =>
    (await page.request.get(api + "staff/events?after=0")).json();
  for (let i = 0; i < 5; i++) tokens.push(await placeOrder(page, i));
  await page
    .getByRole("link", { name: "Owner dashboard", exact: true })
    .click();
  await page.getByLabel("Password").fill("browser-test-password");
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  for (const token of tokens)
    await expect(
      page.getByRole("button", { name: token, exact: true }),
    ).toBeVisible();
  const before = await snapshot();
  expect(before.orders).toHaveLength(5);
  const avatars = before.orders
    .map((o) => o.avatarId)
    .sort()
    .join(",");
  const active = before.orders.find((o) => o.token === tokens[0])!;
  const profile = before.catalog.find((o) => o.id === active.id)!;
  expect(profile.print.copies).toBe(30);
  for (const privateField of ["fileName", "pickupPin", "instructions"])
    expect(JSON.stringify(before)).not.toContain('"' + privateField + '"');
  await page.getByRole("button", { name: tokens[0], exact: true }).click();
  const dialog = page.getByRole("dialog", { name: tokens[0] });
  await dialog.getByLabel("Compatible printer").selectOption("1");
  await dialog.getByRole("button", { name: "Assign printer" }).click();
  await dialog.getByRole("button", { name: "Start simulated print" }).click();
  await dialog.getByRole("link", { name: "View order on shop floor" }).click();
  const scene = page.getByTestId("shop-scene");
  await expect(scene).toHaveAttribute("data-rendered", "true", {
    timeout: 30000,
  });
  await expect(scene).toHaveAttribute("data-printing", "1");
  await expect(scene).toHaveAttribute("data-avatar-ids", avatars);
  await page.getByLabel("Graphics quality").selectOption("low");
  await page.reload();
  await expect(scene).toHaveAttribute("data-avatar-ids", avatars, {
    timeout: 30000,
  });
  await expect(scene).toHaveAttribute("data-residents", "5");
  await page.getByLabel("Graphics quality").selectOption("low");
  await page.getByLabel("Camera view").selectOption("Printer 01");
  await expect(page.locator(".scene-caption")).toContainText("Printer 01");
  const writes: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/api/shops/"))
      writes.push(req.url());
  });
  await page.getByRole("button", { name: "Replay this order" }).click();
  await expect(
    page.getByRole("button", { name: "Return to live" }),
  ).toBeVisible();
  await page.getByLabel("Speed").selectOption("4");
  const seek = page.getByRole("slider");
  await seek.focus();
  await seek.press("End");
  await expect(page.locator(".film-log")).toContainText("Print started");
  await expect(page.locator(".film-log")).toContainText("Order created");
  await expect(scene).toHaveAttribute("data-avatar-ids", active.avatarId);
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: "Return to live" }).click();
  await expect(scene).toHaveAttribute("data-avatar-ids", avatars);
  await page.getByLabel("Speed").selectOption("4");
  const phases: string[] = [];
  await page.exposeFunction("recordParcels", (value: string) =>
    phases.push(value),
  );
  await scene.evaluate((el) => {
    const report = () =>
      void (
        window as unknown as { recordParcels: (s: string) => void }
      ).recordParcels(el.getAttribute("data-parcels") ?? "");
    new MutationObserver(report).observe(el, {
      attributes: true,
      attributeFilter: ["data-parcels"],
    });
    report();
  });
  const owner = await context.newPage();
  owner.on("pageerror", (e) => errors.push(e.message));
  await owner.goto(
    (await page
      .getByRole("link", { name: "Manage this order" })
      .getAttribute("href"))!,
  );
  const desk = owner.getByRole("dialog", { name: tokens[0] });
  await desk
    .getByRole("button", { name: "Mark ready for pickup" })
    .click({ timeout: 45000 });
  await page.bringToFront();
  await expect(scene).toHaveAttribute("data-parcels", active.id + "=counter", {
    timeout: 30000,
  });
  expect(phases.some((p) => p.includes("=carry"))).toBeTruthy();
  const { order } = await (
    await page.request.get(api + "orders/" + active.id)
  ).json();
  await desk
    .getByRole("button", { name: "Record counter payment" })
    .click();
  await desk.getByLabel("Collection code").fill(order.pickupPin);
  await desk.getByRole("button", { name: "Verify pickup" }).click();
  await expect(
    desk.getByText("Completed", { exact: true }).first(),
  ).toBeVisible();
  await page.bringToFront();
  await expect(page.getByTestId("active-count")).toHaveText("4");
  await expect(scene).toHaveAttribute("data-residents", "4", {
    timeout: 40000,
  });
  expect(phases.some((p) => p.includes("=received"))).toBeTruthy();
  const committed = (await events()).filter((e) => e.orderId === active.id);
  for (const type of [
    "ORDER_CREATED",
    "PRINT_STARTED",
    "PRINT_COMPLETED",
    "PICKUP_VERIFIED",
    "ORDER_COMPLETED",
  ]) {
    expect(committed.filter((e) => e.type === type)).toHaveLength(1);
  }
  await scene
    .locator("canvas")
    .evaluate((el) => (el.dataset.retained = "original"));
  await page
    .getByRole("link", { name: "Owner dashboard", exact: true })
    .click();
  await page.getByRole("link", { name: "Live 3D shop", exact: true }).click();
  await expect(scene).toHaveAttribute(
    "data-avatar-ids",
    before.orders
      .filter((o) => o.id !== active.id)
      .map((o) => o.avatarId)
      .sort()
      .join(","),
  );
  await expect(scene.locator("canvas")).toHaveAttribute(
    "data-retained",
    "original",
  );
  for (const order of before.orders.filter((o) => o.id !== active.id)) {
    expect(
      (
        await page.request.post(api + "orders/" + order.id + "/cancel", {
          headers: { origin: baseURL! },
          data: {},
        })
      ).ok(),
    ).toBeTruthy();
  }
  expect(errors).toEqual([]);
});

test("the guided shop catches up on printer events after a disconnect and completes one demo order", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  test.setTimeout(120000);
  await page.goto("/digital-twin");
  await page.getByRole("button", { name: "Enter demo as owner" }).click();
  const scene = page.getByTestId("shop-scene");
  await expect(scene).toHaveAttribute("data-rendered", "true");
  await page.getByLabel("Graphics quality").selectOption("low");
  const operator = await browser.newContext({
    baseURL,
    storageState: await context.storageState(),
  });
  try {
    const printer = page.getByRole("button", { name: /Printer 03/ });
    await context.setOffline(true);
    const setPrinter = (online: boolean) =>
      operator.request.post(api + "staff/printers/3", {
        headers: { origin: baseURL! },
        data: { online, error: online ? null : "Paper tray inspection" },
      });
    expect((await setPrinter(false)).ok()).toBeTruthy();
    await context.setOffline(false);
    await expect(printer).toContainText("Offline");
    expect((await setPrinter(true)).ok()).toBeTruthy();
    await expect(printer).toContainText("Idle");
    await expect(page.getByRole("button", { name: "Run guided order" })).toHaveCount(0);
    const guide = await operator.newPage();
    await guide.goto("/demo");
    await guide.getByRole("button", { name: "Run guided order" }).click();
    await expect(page.getByTestId("active-count")).toHaveText("1");
    await expect(guide.locator(".guided-print [role=status]")).toContainText(
      /PF-\d+ · completed/i,
      { timeout: 75000 },
    );
    await expect(page.getByTestId("active-count")).toHaveText("0");
    await page
      .getByRole("button", { name: "Replay shop", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Return to live" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Run guided order" }),
    ).toHaveCount(0);
    await page.getByRole("slider").focus();
    await page.getByRole("slider").press("End");
    await expect(page.locator(".film-log")).toContainText("Order completed");
    const replayLink = page.getByRole("link", { name: "Open replay link" });
    const sharePath = await replayLink.getAttribute("href");
    expect(sharePath).toMatch(/^\/digital-twin\/replay\/all\?/);
    await replayLink.click();
    await expect(page).toHaveURL(new URL(sharePath!, baseURL!).href);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Return to live" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Run guided order" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Return to live" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
  } finally {
    await operator.close();
  }
});
