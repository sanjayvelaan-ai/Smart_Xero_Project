import { transaction } from "./db";
import { seed } from "./identity";
import { runScheduler } from "./operations";

const state = globalThis as typeof globalThis & { printflowWorker?: { busy: boolean; ticks: number } };
export function startWorker() {
  if (state.printflowWorker) return;
  const worker = { busy: false, ticks: 0 };
  state.printflowWorker = worker;
  const timer = setInterval(async () => {
    if (worker.busy) return;
    worker.busy = true;
    try {
      await seed();
      const shops = await transaction(tx => tx.rows<{ id: string; demo: boolean }>("SELECT id,demo FROM shops"));
      for (const shop of shops) {
        if (shop.demo || process.env.PRINTFLOW_OWNER_PASSWORD) await runScheduler(shop.id);
      }
      if (++worker.ticks % 300 === 0) {
        await transaction(async tx => {
          await tx.rows("DELETE FROM sessions WHERE expires_at<=now()");
          await tx.rows("DELETE FROM rate_limits WHERE reset_at<=now()");
        });
      }
    } catch (error) {
      console.error("PrintFlow background scheduler:", error instanceof Error ? error.message : "Unknown error");
    } finally {
      worker.busy = false;
    }
  }, 1200);
  timer.unref();
}
