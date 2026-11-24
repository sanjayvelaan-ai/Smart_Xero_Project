import { expect, test } from "@playwright/test";
import sharp from "sharp";

test("theme switch follows keyboard and touch and persists across workspaces", async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, colorScheme: "light", viewport: {width: 375,height:812} });
  try {
    const page = await context.newPage();
    await page.emulateMedia({reducedMotion:"no-preference"});
    await page.goto("/customer");
    const upload = page.getByRole("button",{name:"Choose files",exact:true});
    await upload.hover();
    await expect.poll(() => upload.evaluate(el => el.style.getPropertyValue("--mx"))).not.toBe("");
    await upload.dispatchEvent("pointerdown", {pointerType:"touch",isPrimary:true,button:0});
    await expect.poll(() => upload.evaluate(el => el.style.scale)).not.toBe("");
    await upload.dispatchEvent("pointercancel", {pointerType:"touch",isPrimary:true});
    await expect.poll(() => upload.evaluate(el => el.style.scale)).toBe("");
    const toggle = page.getByRole("switch", {name:"Dark appearance"});
    await page.evaluate(() => {
      if (!document.startViewTransition) return;
      const root = document.documentElement;
      const observer = new MutationObserver(() => {
        if (root.hasAttribute("data-theme-transition")) {
          root.dataset.themeRevealObserved = "true";
          observer.disconnect();
        }
      });
      observer.observe(root, {attributes:true,attributeFilter:["data-theme-transition"]});
    });
    await toggle.tap();
    await expect(toggle).toBeChecked();
    if (await page.evaluate(() => typeof document.startViewTransition === "function")) {
      await expect(page.locator("html")).toHaveAttribute("data-theme-reveal-observed", "true");
      await expect(page.locator("html")).not.toHaveAttribute("data-theme-transition", "");
    }
    const primary = page.getByRole("link", {name:"Upload a document"});
    await primary.hover();
    await expect(primary).toHaveCSS("background-color", "rgb(82, 105, 146)");
    await expect(primary).toHaveCSS("color", "rgb(237, 242, 252)");
    await page.mouse.down();
    await expect(primary).toHaveCSS("background-color", "rgb(64, 83, 120)");
    await expect(primary).toHaveCSS("color", "rgb(237, 242, 252)");
    await page.mouse.up();
    await page.reload();
    await expect(toggle).toBeChecked();
    await page.getByRole("link",{name:"Owner dashboard",exact:true}).click();
    await expect(toggle).toBeChecked();
    await page.getByRole("button",{name:"Enter demo as owner"}).click();
    await expect(page.getByRole("heading",{name:"Welcome, Ram"})).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.screenshot({path:info.outputPath("dark-owner.png")});
    const sections = page.getByRole("navigation", {name:"Owner sections"});
    const printersLink = sections.getByRole("link", {name:"Printers",exact:true});
    await printersLink.click();
    await expect(printersLink).toHaveAttribute("aria-current", "page");
    await expect(printersLink).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(sections.locator(".nimbus-optics")).toHaveCount(1);
    const printers = page.locator(".printer-card");
    await expect(printers).toHaveCount(3);
    await expect(printers.first().locator(".detail-grid")).toHaveCSS("background-color", "rgba(102, 126, 176, 0.15)");
    const workspaces = page.getByRole("navigation", {name:"Workspaces"});
    await expect(workspaces).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(workspaces.getByRole("link", {name:"Owner dashboard"})).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    for (const [width, height] of [[320, 640], [844, 390], [1440, 900]]) {
      await page.setViewportSize({width, height});
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await expect.poll(() => sections.evaluate(el => el.scrollWidth)).toBeLessThanOrEqual(await sections.evaluate(el => el.clientWidth));
    }
    await toggle.press("ArrowLeft");
    await expect(toggle).not.toBeChecked();
  } finally { await context.close(); }
});

test("skipping slow text recognition keeps the photo private and available for printing", async ({page}) => {
  await page.goto("/customer");
  await page.route("**/api/print-assistant/worker.min.js", async route => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    await route.abort().catch(() => {});
  });
  const photo = await sharp({create:{width:500,height:700,channels:3,background:"#fff"}}).png().toBuffer();
  await page.getByLabel("Choose documents").setInputFiles({name:"scan.png",mimeType:"image/png",buffer:photo});
  await page.getByRole("button",{name:"Skip remaining text scans"}).click();
  await expect(page.getByText("Text scan incomplete. Confidential printing will be selected.")).toBeVisible();
  await expect(page.getByRole("button",{name:"Use 1 file for printing"})).toBeEnabled();
});
