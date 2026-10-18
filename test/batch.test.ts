/**
 * 验证：
 * 1. 批量 UPSERT 的性能（500 行一条 SQL）
 * 2. 按批次 id 回滚 —— 不依赖页面/关掉浏览器也能撤销
 * 3. 手机号唯一约束
 */
import { SQL } from "bun";

const BASE = "http://localhost:3000";
const db = new SQL(process.env.DATABASE_URL!);

let pass = 0;
const fail: string[] = [];
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail.push(`${name} — ${detail}`); console.log(`  ❌ ${name} ${detail}`); }
}

const SEED = Math.random().toString(36).slice(2, 7);
/** 每个小节用独立标记，避免相互干扰统计 */
const MARK_PERF = "PERF" + SEED;
const MARK_BATCH = "BATC" + SEED;

async function countAll() {
  const r = await db`SELECT count(*)::int AS n FROM customer_profiles`;
  return Number(r[0].n);
}

async function upload(content: string, name = "b.csv") {
  const fd = new FormData();
  fd.append("file", new File([content], name, { type: "text/csv" }));
  const res = await fetch(`${BASE}/profiles/import`, { method: "POST", body: fd });
  return { status: res.status, body: await res.text() };
}

function stat(body: string, label: string) {
  const m = body.match(new RegExp(`class="n">(\\d+)</div><div class="l">${label}</div>`));
  return m ? Number(m[1]) : -1;
}

async function rollback(batchId: number) {
  const r = await fetch(`${BASE}/profiles/import/${batchId}/rollback`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "",
  });
  return { status: r.status, body: await r.text() };
}

console.log("\n── 1. 性能：500 行导入耗时 ──────────────────");
{
  await db`DELETE FROM customer_profiles`;
  await db`DELETE FROM import_batches`;

  const rows = ["公司名称,联系人,手机,来源"];
  for (let i = 0; i < 500; i++) rows.push(`${MARK_PERF}性能${i},联系人,138${String(50000000 + i)},其他`);
  const content = rows.join("\n");

  const t0 = performance.now();
  const r = await upload(content, "perf.csv");
  const t1 = performance.now();
  const ms = Math.round(t1 - t0);

  ok("500 行全部新增", stat(r.body, "新增") === 500, `实际 ${stat(r.body, "新增")}`);
  ok(`耗时 < 3000ms（实测 ${ms}ms）`, ms < 3000, `${ms}ms`);
  console.log(`     └─ 单次导入 ${ms}ms（约 ${(ms / 500).toFixed(2)}ms/行）`);

  // 再导一次全部走 UPDATE 分支
  const t2 = performance.now();
  const r2 = await upload(content, "perf.csv");
  const t3 = performance.now();
  const ms2 = Math.round(t3 - t2);
  ok("第二次全部更新", stat(r2.body, "更新") === 500, `实际 ${stat(r2.body, "更新")}`);
  ok(`更新 500 行 < 3000ms（实测 ${ms2}ms）`, ms2 < 3000, `${ms2}ms`);
  console.log(`     └─ 批量更新 ${ms2}ms（约 ${(ms2 / 500).toFixed(2)}ms/行）`);

  ok("库里共 500 条", (await countAll()) === 500);
}

console.log("\n── 2. 手机号唯一约束 ────────────────────────");
{
  try {
    await db.unsafe(
      `INSERT INTO customer_profiles (company_name,contact_name,phone,source) VALUES ('dup','dup','13850000000','其他')`
    );
    ok("重复手机号被数据库拒绝", false, "竟然插入成功了");
  } catch (e: any) {
    ok("重复手机号被数据库拒绝", e.code === "23505" || String(e.message).includes("unique"), String(e.code));
  }
}

console.log("\n── 3. 按批次回滚（关掉页面也能撤销） ─────────");
{
  // 场景：先导入一批 → 手工新增一条 → 再导入第二批 → 只撤销第二批
  const b1 = await upload(
    ["公司名称,联系人,手机", `${MARK_BATCH}批次一A,甲,13860000001`, `${MARK_BATCH}批次一B,乙,13860000002`].join("\n")
  );
  const id1 = Number(b1.body.match(/批次编号 #(\d+)/)![1]);

  // 用户在两次导入之间手工加了一条（不属于任何批次，撤销时必须保留）
  await db.unsafe(
    `INSERT INTO customer_profiles (company_name,contact_name,phone,source) VALUES ('${MARK_BATCH}手工记录','手工','13860000099','其他')`
  );

  const b2 = await upload(
    ["公司名称,联系人,手机", `${MARK_BATCH}批次二改名,丙,13860000001`, `${MARK_BATCH}批次二新增,丁,13860000003`].join("\n")
  );
  const id2 = Number(b2.body.match(/批次编号 #(\d+)/)![1]);

  ok("批次一 id 递增", id2 > id1, `${id1} → ${id2}`);
  ok("批次二：1 新增 + 1 更新", stat(b2.body, "新增") === 1 && stat(b2.body, "更新") === 1);

  // 只撤销批次二
  const rb = await rollback(id2);
  ok("撤销批次二 200", rb.status === 200, `得到 ${rb.status}`);

  const rows = await db`SELECT company_name, contact_name, phone FROM customer_profiles ORDER BY id`;
  const names = rows.map((r: any) => r.company_name);

  ok("批次一A 保留", names.includes(`${MARK_BATCH}批次一A`));
  ok("批次一B 保留", names.includes(`${MARK_BATCH}批次一B`));
  ok("批次二的改名已撤销", !names.some((n: string) => n.includes("批次二改名")), "改名仍在");
  ok("批次二的新增已删除", !names.some((n: string) => n.includes("批次二新增")), "新增仍在");
  ok("手工记录不受影响", names.includes(`${MARK_BATCH}手工记录`), "手工记录被误删");

  // 批次一仍可撤销
  const rb1 = await rollback(id1);
  ok("批次一也可撤销", rb1.status === 200);
  const after1 = await db`SELECT count(*)::int AS n FROM customer_profiles WHERE company_name LIKE ${`%${MARK_BATCH}%`}`;
  ok("撤销后只剩手工记录", Number(after1[0].n) === 1, `实际 ${after1[0].n} 条`);
}

console.log("\n── 4. 批次状态流转 ──────────────────────────");
{
  // 性能小节用 perf.csv，这里只统计批次小节产生的记录
  const list = await db`SELECT status, count(*)::int AS n FROM import_batches WHERE file_name = 'b.csv' GROUP BY status`;
  ok("批次小节产生了记录", list.length > 0, JSON.stringify(list));
  ok("全部标记为 rolled_back", list.every((r: any) => r.status === "rolled_back"), JSON.stringify(list));

  const page = await (await fetch(`${BASE}/profiles/import`)).text();
  ok("导入页显示已撤销状态", page.includes("已撤销"));
}

console.log("\n── 5. 客户档案与需求的关联 ──────────────────────");
{
  const relId = "REL" + SEED;

  // 建一个客户档案
  await db`DELETE FROM demands`;
  await db`DELETE FROM customer_profiles`;
  const [prof] = await db`
    INSERT INTO customer_profiles (company_name, contact_name, phone, source)
    VALUES (${relId}::text || ' 公司', '关系测试人', '13877000001', '其他')
    RETURNING id
  `;

  // 挂两条需求
  await db`INSERT INTO demands (profile_id, demand, status) VALUES (${prof.id}, ${`${relId} 需求一`}, '待跟进')`;
  await db`INSERT INTO demands (profile_id, demand, status) VALUES (${prof.id}, ${`${relId} 需求二`}, '已成交')`;

  // 一个客户可以有多条需求
  const mine = await db`SELECT count(*)::int AS n FROM demands WHERE profile_id = ${prof.id}`;
  ok("一个客户档案可挂多条需求", Number(mine[0].n) === 2, `实际 ${mine[0].n}`);

  // 需求表里不再冗余存客户名
  const cols = await db`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'demands' ORDER BY ordinal_position
  `;
  const names = cols.map((c: any) => c.column_name);
  ok("需求表无冗余的 customer_name", !names.includes("customer_name"), names.join(","));
  ok("需求表有 profile_id 外键", names.includes("profile_id"), names.join(","));
  ok("需求表只保留需求自身字段",
    !names.includes("contact_name") && !names.includes("phone"), names.join(","));

  // 单一事实来源：改客户名，需求侧同步（需求表没存名字，所以必然同步）
  await db`UPDATE customer_profiles SET company_name = ${relId + '（已改名）'} WHERE id = ${prof.id}`;
  const joined = await db`
    SELECT p.company_name, d.demand FROM demands d
    JOIN customer_profiles p ON p.id = d.profile_id
    WHERE d.demand LIKE ${`%${relId}%`}
  `;
  ok("改客户名后需求侧同步显示", joined.every((r: any) => r.company_name.includes("已改名")),
    JSON.stringify(joined[0]?.company_name));

  // 不存在的客户插不进来（外键）
  try {
    await db`INSERT INTO demands (profile_id, demand, status) VALUES (999999, '孤儿需求', '待跟进')`;
    ok("孤儿需求被外键拒绝", false, "竟然插入成功");
  } catch (e: any) {
    ok("孤儿需求被外键拒绝", e.code === "23503" || String(e.message).includes("外键"),
      `${e.code} ${String(e.message).slice(0, 60)}`);
  }

  // 级联删除：删档案 → 需求一起消失
  await db`DELETE FROM customer_profiles WHERE id = ${prof.id}`;
  const left = await db`SELECT count(*)::int AS n FROM demands WHERE profile_id = ${prof.id}`;
  ok("删档案时需求级联删除", Number(left[0].n) === 0, `残留 ${left[0].n} 条`);
}

console.log("\n── 清理 ────────────────────────────────────");
await db`DELETE FROM customer_profiles`;
await db`DELETE FROM import_batches`;
ok("测试数据已清空", (await countAll()) === 0);

console.log("\n" + "═".repeat(50));
console.log(`通过 ${pass} 项，失败 ${fail.length} 项`);
fail.forEach((f) => console.log("  - " + f));
await db.close();
process.exit(fail.length ? 1 : 0);