/**
 * 事务原子性验证
 *
 * 思路：应用层校验比数据库 CHECK 约束更严，正常输入很难制造
 * 「应用通过但数据库失败」的情况。用一个【临时触发器】在最中间那行
 * 人为抛错，从而验证整批是否真的回滚。
 *
 * 触发器在测试结束时会被删除。
 */
import { SQL } from "bun";

const BASE = "http://localhost:3000";
const url = process.env.DATABASE_URL!;
const db = new SQL(url);

let pass = 0;
const fail: string[] = [];
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail.push(`${name} — ${detail}`); console.log(`  ❌ ${name} ${detail}`); }
}

const MARK = "ATOM" + Math.random().toString(36).slice(2, 7);

async function countAll(): Promise<number> {
  const r = await db`SELECT count(*)::int AS n FROM customer_profiles`;
  return Number(r[0].n);
}

async function countMarked(): Promise<number> {
  const r = await db`SELECT count(*)::int AS n FROM customer_profiles WHERE company_name LIKE ${`%${MARK}%`}`;
  return Number(r[0].n);
}

async function upload(content: string) {
  const fd = new FormData();
  fd.append("file", new File([content], "a.csv", { type: "text/csv" }));
  const res = await fetch(`${BASE}/profiles/import`, { method: "POST", body: fd });
  return { status: res.status, body: await res.text() };
}

async function cleanupMarked() {
  await db`DELETE FROM customer_profiles WHERE company_name LIKE ${`%${MARK}%`}`;
}

console.log("\n── 1. 超过 500 行 → 报错且不写入任何数据 ──────");
{
  await cleanupMarked();
  const before = await countAll();

  const rows = ["公司名称,联系人,手机"];
  for (let i = 0; i < 501; i++) rows.push(`${MARK}超限${i},联系人,138${String(40000000 + i)}`);
  const r = await upload(rows.join("\n"));

  ok("返回 400", r.status === 400, `得到 ${r.status}`);
  ok("提示超过上限", r.body.includes("超过单次上限"), "未见上限提示");
  ok("提示未导入任何数据", r.body.includes("未导入任何数据"), "未见澄清说明");

  const after = await countAll();
  ok("数据库零变化", after === before, `${before} → ${after}`);
  ok("无任何测试行落库", (await countMarked()) === 0);
}

console.log("\n── 2. 恰好 500 行 → 允许导入 ────────────────");
{
  await cleanupMarked();
  const rows = ["公司名称,联系人,手机"];
  for (let i = 0; i < 500; i++) rows.push(`${MARK}上限${i},联系人,138${String(41000000 + i)}`);
  const r = await upload(rows.join("\n"));

  const m = r.body.match(/class="n">(\d+)<\/div><div class="l">新增/);
  ok("新增 500 条", m && Number(m[1]) === 500, `实际 ${m?.[1]}`);
  ok("库里确有 500 条", (await countMarked()) === 500);

  await cleanupMarked();
}

console.log("\n── 3. 事务原子性：中途失败 → 整批回滚 ───────");
{
  await cleanupMarked();
  const before = await countAll();

  // 临时触发器：公司名等于 TRIGGER_FAIL 时抛异常
  await db.unsafe(`
    CREATE OR REPLACE FUNCTION trigger_fail() RETURNS trigger AS $$
    BEGIN
      IF NEW.company_name = 'TRIGGER_FAIL' THEN
        RAISE EXCEPTION 'simulated failure';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
  `);
  await db.unsafe(`
    CREATE TRIGGER trg_fail BEFORE INSERT ON customer_profiles
    FOR EACH ROW EXECUTE FUNCTION trigger_fail();
  `);

  // 故意让失败行夹在中间：1 条正常 → 1 条失败 → 1 条正常
  const csv = [
    "公司名称,联系人,手机",
    `${MARK}第一行正常,甲,138${String(42000001)}`,
    `TRIGGER_FAIL,乙,138${String(42000002)}`,
    `${MARK}第三行正常,丙,138${String(42000003)}`,
  ].join("\n");

  const r = await upload(csv);
  ok("请求失败（5xx）", r.status >= 500, `得到 ${r.status}`);

  const after = await countAll();
  ok("失败前的行也没留下（事务回滚）", after === before, `${before} → ${after}`);
  ok("失败后的行也没写入", (await countMarked()) === 0, "存在部分写入");

  // 清理触发器
  await db.unsafe(`DROP TRIGGER IF EXISTS trg_fail ON customer_profiles;`);
  await db.unsafe(`DROP FUNCTION IF EXISTS trigger_fail();`);
}

console.log("\n── 4. 触发器移除后，导入恢复正常 ─────────────");
{
  const csv = [
    "公司名称,联系人,手机",
    `${MARK}恢复正常,甲,138${String(43000001)}`,
  ].join("\n");
  const r = await upload(csv);
  const m = r.body.match(/class="n">(\d+)<\/div><div class="l">新增/);
  ok("重新导入成功", m && Number(m[1]) === 1, `实际 ${m?.[1]}`);
}

console.log("\n── 5. 一键回滚：删除新增 + 还原更新 ─────────");
{
  await cleanupMarked();
  await db`DELETE FROM customer_profiles`; // 清掉上一轮残留（phone 有 UNIQUE）
  // 造一条已有记录
  await db.unsafe(
    `INSERT INTO customer_profiles (company_name,contact_name,phone,source)
     VALUES ('${MARK}原始公司','原始联系人','13844000001','其他')`
  );

  const csv = [
    "公司名称,联系人,手机",
    `${MARK}改名后的公司,改后联系人,13844000001`,
    `${MARK}全新公司,新人,13844000002`,
  ].join("\n");
  const r = await upload(csv);
  const m = r.body.match(/批次编号 #(\d+)/);
  ok("结果页带批次编号", !!m, "未找到批次编号");
  const batchId = Number(m![1]);

  const after = await countMarked();
  ok("导入后共 2 条", after === 2, `实际 ${after}`);

  const rb = await fetch(`${BASE}/profiles/import/${batchId}/rollback`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "",
  });
  ok("回滚返回 200", rb.status === 200, "得到 " + rb.status);

  const left = await countMarked();
  ok("仅剩 1 条原始记录", left === 1, `实际 ${left}`);

  const row = await db`SELECT company_name, contact_name FROM customer_profiles WHERE company_name LIKE ${`%${MARK}%`}`;
  ok("改名已被还原", row[0].company_name === `${MARK}原始公司`, `实际 ${row[0].company_name}`);
  ok("联系���已被还原", row[0].contact_name === "原始联系人", `实际 ${row[0].contact_name}`);
}

console.log("\n── 清理 ────────────────────────────────────");
await cleanupMarked();
ok("测试数据已清空", (await countMarked()) === 0);

console.log("\n" + "═".repeat(50));
console.log(`通过 ${pass} 项，失败 ${fail.length} 项`);
fail.forEach((f) => console.log("  - " + f));
await db.close();
process.exit(fail.length ? 1 : 0);