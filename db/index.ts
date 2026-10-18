import { drizzle } from "drizzle-orm/bun-sql";
import { SQL } from "bun";
import * as schema from "./schema";

const url = process.env.DATABASE_URL!;

/** Bun 内置的 PostgreSQL 客户端 */
export const client = new SQL(url);

/** Drizzle ORM 实例 */
export const db = drizzle(client, { schema });