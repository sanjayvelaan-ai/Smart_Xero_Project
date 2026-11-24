import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { defaultPrinters, defaultSettings, DomainError, type Role, type Settings } from "../domain";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {dataPath, transaction, type Sql } from "./db";

export const DEMO_SHOP = "printflow-demo";
export const REAL_SHOP = "velachery";

export function prototypeLoginAllowed(shopId: string, host: string | null) {
  const enabled = process.env.PRINTFLOW_PROTOTYPE_LOGIN ?? String(process.env.NODE_ENV === "development");
  return shopId === DEMO_SHOP && enabled === "true" &&
    !process.env.PRINTFLOW_PUBLIC_ORIGIN && process.env.PRINTFLOW_TRUST_PROXY !== "true" &&
    /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host ?? "");
}

export async function signInPrototype(shopId: string, host: string | null) {
  if (!prototypeLoginAllowed(shopId, host))
    throw new DomainError("Prototype sign-in is unavailable.", 404);
  const local = await localPasswords();
  return signIn(shopId, "ram", process.env.PRINTFLOW_LOCAL_OWNER_PASSWORD || local.ram);
}

export type ShopRow = { id: string; demo: boolean; settings: Settings; sequence: number; token_counter: number };
type StaffRow = { id: string; name: string; role: Role; password_hash: string | null };
export type Identity = { id: string; shopId: string; staff: StaffRow | null };
const seedRuntime = globalThis as typeof globalThis & { printflowSeed?: Promise<void> };
const sessionLife = 7 * 24 * 60 * 60;
const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");

function passwordHash(secret: string, salt = randomBytes(16).toString("hex")) {
  return salt + ":" + scryptSync(secret, salt, 64).toString("hex");
}

async function localPasswords():Promise<Record<string,string>>{
  const folder=dataPath(), file=path.join(folder,"staff-access.json");
  await mkdir(folder,{recursive:true});
  try{return JSON.parse(await readFile(file,"utf8"));}
  catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  const passwords=Object.fromEntries(["ram","meena","arun"].map(name=>[name,randomBytes(18).toString("base64url")]));
  try{await writeFile(file,JSON.stringify(passwords,null,2),{flag:"wx",mode:0o600});return passwords;}
  catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;return JSON.parse(await readFile(file,"utf8"));}
}
export async function seed() {
  seedRuntime.printflowSeed ??= transaction(async tx => {
    const local=await localPasswords();
    for (const demo of [true, false]) {
      const realOwner = process.env.PRINTFLOW_OWNER_PASSWORD;
      if (!demo && !realOwner) continue;
      if (!demo && realOwner!.length < 12) throw new Error("PRINTFLOW_OWNER_PASSWORD must contain at least 12 characters.");
      const shop = demo ? DEMO_SHOP : REAL_SHOP;
      await tx.rows("INSERT INTO shops (id, demo, settings) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [shop, demo, defaultSettings]);
      for (const [index, config] of defaultPrinters.entries()) {
        await tx.rows("INSERT INTO printers (shop_id,id,config) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [shop, index + 1, config]);
      }
      const workers = [
        { username: "ram", name: "Ram", role: "OWNER", password: demo ? process.env.PRINTFLOW_LOCAL_OWNER_PASSWORD || local.ram : realOwner },
        { username: "meena", name: "Meena", role: "WORKER", password: demo ? local.meena : process.env.PRINTFLOW_WORKER_PASSWORD },
        { username: "arun", name: "Arun", role: "WORKER", password: demo ? local.arun : process.env.PRINTFLOW_SECOND_WORKER_PASSWORD },
      ];
      for (const worker of workers) {
        if (!demo && !worker.password) continue;
        if (!demo && worker.password!.length < 12) throw new Error("Worker passwords must contain at least 12 characters.");
        const id = `${shop}/${worker.username}`;
        const [existing] = await tx.rows<StaffRow>("SELECT password_hash FROM staff WHERE id=$1", [id]);
        const existingSalt = existing?.password_hash?.split(":")[0];
        const hash = passwordHash(worker.password!, existingSalt);
        if (existing && existing.password_hash === hash) continue;
        await tx.rows(`INSERT INTO staff VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT(id) DO UPDATE SET password_hash=EXCLUDED.password_hash`, [id, shop, worker.name, worker.username, worker.role, hash]);
      }
      if (!demo) {
        for (const worker of workers.filter(worker => !worker.password)) {
          await tx.rows("UPDATE staff SET password_hash=NULL WHERE shop_id=$1 AND username=$2", [shop, worker.username]);
        }
      }
    }
  }).catch(error => { delete seedRuntime.printflowSeed; throw error; });
  return seedRuntime.printflowSeed;
}

export async function shopRow(tx: Sql, shopId: string, lock = false) {
  const [shop] = await tx.rows<ShopRow>("SELECT * FROM shops WHERE id=$1" + (lock ? " FOR UPDATE" : ""), [shopId]);
  if (!shop || (!shop.demo && !process.env.PRINTFLOW_OWNER_PASSWORD)) throw new DomainError("Shop not found.", 404);
  return shop;
}

const cookieName = (shopId: string, staff: boolean) => `pf_${shopId.replace(/-/g, "_")}_${staff ? "staff" : "guest"}`;

export async function identity(request: Request, shopId: string, staff = false): Promise<Identity | null> {
  const name = cookieName(shopId, staff) + "=";
  const token = request.headers.get("cookie")?.split(";").map(c => c.trim()).find(c => c.startsWith(name))?.slice(name.length);
  if (!token || !/^[\da-f]{64}$/.test(token)) return null;
  return transaction(async tx => {
    const id = hashToken(token);
    const [row] = await tx.rows<{ staff_id: string | null }>("SELECT staff_id FROM sessions WHERE id=$1 AND shop_id=$2 AND expires_at>now()", [id, shopId]);
    if (!row || Boolean(row.staff_id) !== staff) return null;
    const [staffRow] = row.staff_id ? await tx.rows<StaffRow>(`SELECT staff.id,name,role FROM staff
      JOIN shops ON shops.id=staff.shop_id WHERE staff.id=$1 AND staff.shop_id=$2 AND (shops.demo OR password_hash IS NOT NULL)`, [row.staff_id, shopId]) : [];
    if (staff && !staffRow) return null;
    return { id, shopId, staff: staffRow ?? null };
  });
}

export async function newSession(tx: Sql, shop: ShopRow, staff: StaffRow | null) {
  const token = randomBytes(32).toString("hex");
  const id = hashToken(token);
  await tx.rows("INSERT INTO sessions VALUES ($1,$2,$3,$4)", [id, shop.id, staff?.id ?? null, new Date(Date.now() + sessionLife * 1000)]);
  const secure = process.env.PRINTFLOW_PUBLIC_ORIGIN?.startsWith("https://") ? "; Secure" : "";
  return { id, cookie: `${cookieName(shop.id, Boolean(staff))}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionLife}${secure}` };
}

export async function signIn(shopId: string, username: string, password: string) {
  return transaction(async tx => {
    const shop = await shopRow(tx, shopId);
    const [person] = await tx.rows<StaffRow>("SELECT id,name,role,password_hash FROM staff WHERE shop_id=$1 AND username=$2", [shopId, username.toLowerCase()]);
    {
      const stored = person?.password_hash ?? "00000000000000000000000000000000:" + "0".repeat(128);
      const salt = stored.split(":")[0];
      const equal = timingSafeEqual(Buffer.from(stored), Buffer.from(passwordHash(password, salt)));
      if (!person?.password_hash || !equal) throw new DomainError("The username or password is incorrect.", 401);
    }
    if (!person) throw new DomainError("This demo staff profile does not exist.", 401);
    return newSession(tx, shop, person);
  });
}

export async function signOut(session: Identity) {
  await transaction(tx => tx.rows("DELETE FROM sessions WHERE id=$1 AND shop_id=$2", [session.id, session.shopId]));
  return `${cookieName(session.shopId, true)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function limit(scope: string, max: number, seconds: number) {
  const count = await transaction(async tx => {
    const [row] = await tx.rows<{ hits: number }>(`INSERT INTO rate_limits VALUES ($1,1,now()+$2*interval '1 second')
      ON CONFLICT (scope) DO UPDATE SET hits=CASE WHEN rate_limits.reset_at<=now() THEN 1 ELSE rate_limits.hits+1 END,
      reset_at=CASE WHEN rate_limits.reset_at<=now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END RETURNING hits`, [scope, seconds]);
    return row.hits;
  });
  if (count > max) throw new DomainError("Too many attempts. Please try again shortly.", 429);
}
