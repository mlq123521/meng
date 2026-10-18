import { SQL } from "bun";
const db = new SQL("postgres://postgres:123456@localhost:5432/mydb");
// 直接试 COPY 语法，看服务端是否接受
try {
  const r = await db.unsafe(`CREATE TEMP TABLE t_probe (a text, b text)`);
  console.log("建临时表 OK");
  const r2 = await db.unsafe(`COPY t_probe (a,b) FROM STDIN WITH (FORMAT csv)`, );
  console.log("COPY 调用返回:", typeof r2);
} catch (e: any) { console.log("COPY 错误:", e.message); }
// 检查客户端层是否有 copy API
console.log("db.copyFrom:", typeof (db as any).copyFrom);
console.log("db.copyTo:", typeof (db as any).copyTo);
console.log("db.file:", typeof (db as any).file);
await db.close();
