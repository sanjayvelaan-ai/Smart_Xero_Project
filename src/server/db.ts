import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";

export type Sql = {
  rows<T>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<unknown>;
};
type Database = { transaction<T>(work: (tx: Sql) => Promise<T>): Promise<T> };
const runtime = globalThis as typeof globalThis & { printflowDatabase?: Promise<Database> };
export const dataPath = () => path.resolve(process.env.PRINTFLOW_DATA_DIR ?? ".printflow");

async function adapter(): Promise<Database> {
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    return {
      async transaction(work) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await work({
            rows: async (sql, params) => (await client.query(sql, params)).rows,
            exec: sql => client.query(sql),
          });
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
    };
  }
  await mkdir(dataPath(), { recursive: true });
  const local = await PGlite.create(path.join(dataPath(), "postgres"));
  return {
    transaction: work => local.transaction(tx => work({
      rows: async <T>(sql: string, params?: unknown[]) => (await tx.query<T>(sql, params)).rows,
      exec: sql => tx.exec(sql),
    })),
  };
}

export async function database() {
  runtime.printflowDatabase ??= adapter().then(async db => {
    await db.transaction(async tx => {
      if (process.env.DATABASE_URL) await tx.rows("SELECT pg_advisory_xact_lock(19540138)");
      await tx.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY)");
      for (const version of ["001_initial", "002_fulfillment", "003_scheduling"]) {
        const [done] = await tx.rows("SELECT version FROM schema_migrations WHERE version = $1", [version]);
        if (done) continue;
        await tx.exec(await readFile(path.join(process.cwd(), "db", version + ".sql"), "utf8"));
        await tx.rows("INSERT INTO schema_migrations VALUES ($1)", [version]);
      }
    });
    return db;
  }).catch(error => {
    delete runtime.printflowDatabase;
    throw error;
  });
  return runtime.printflowDatabase;
}

export async function transaction<T>(action: (tx: Sql) => Promise<T>): Promise<T> {
  return (await database()).transaction(action);
}
