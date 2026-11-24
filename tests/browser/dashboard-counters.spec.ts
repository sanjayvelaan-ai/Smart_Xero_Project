import { expect, test } from "@playwright/test";

test("zero counters roll again on return to Overview and respect reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/owner");
  await page.getByRole("button", { name: "Enter demo as owner" }).click();
  const card = page.getByRole("region", { name: "Currently printing, 0", exact: true });
  await expect(card.locator("strong")).toHaveText("0");
  const sections = page.getByRole("navigation", { name: "Owner sections" });
  await sections.evaluate(nav => nav.setAttribute("data-persistence-check", "original"));
  await sections.getByRole("link", { name: "Printers" }).click();
  await expect(page).toHaveURL(/\/owner\/printers$/);
  await expect(sections).toHaveAttribute("data-persistence-check", "original");
  await expect(card).toHaveCount(0);
  await page.evaluate(() => {
    const observe = new MutationObserver(() => {
      const n = document.querySelector('[aria-label="Currently printing, 0"] strong')?.textContent;
      if (Number(n) > 0) {
        document.documentElement.dataset.counterRolled = "true";
        observe.disconnect();
      }
    });
    observe.observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await sections.getByRole("link", { name: "Overview" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-counter-rolled", "true");
  await expect(card.locator("strong")).toHaveText("0");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Printers", exact: true })).toBeVisible();
  await expect(sections).toHaveAttribute("data-persistence-check", "original");
  await page.goForward();
  await expect(card.locator("strong")).toHaveText("0");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(card.locator("strong")).toHaveText("0");
});
