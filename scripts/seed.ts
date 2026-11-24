import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { seed } from "../src/server/identity";

if (existsSync(".env.local")) loadEnvFile(".env.local");
if (existsSync(".env")) loadEnvFile(".env");
await seed();
console.log("PrintFlow database initialized. Demo shop, three printers and staff accounts are ready.");
process.exit(0);
