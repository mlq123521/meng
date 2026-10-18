/** 导入功能端到端验证 */
const BASE = "http://localhost:3000";

/** EJS 的 <%= %> 用数字实体转义（&#34; / &#39; / &amp;），必须按同样规则还原 */
function decodeEntities(s: string) {
  return s
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&"); // & 必须最后解，否则会把 &quot; 二次解码
}

let pass = 0;
const fail: string[] = [];
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail.push(`${name} — ${detail}`); console.log(`  ❌ ${name} ${detail}`); }
}

async function upload(name: string, content: string) {
  const fd = new FormData();
  fd.append("file", new File([content], name, { type: "text/csv" }));
  const res = await fetch(`${BASE}/profiles/import`, { method: "POST", body: fd });
  return { status: res.status, body: await res.text() };
}

function stat(body: string, label: string) {
  const m = body.match(new RegExp(`class="n">(\\d+)</div><div class="l">${label}</div>`));
  return m ? Number(m[1]) : -1;
}

const MARK = "IMP" + Math.random().toString(36).slice(2, 7);

console.log("\n── 1. 模板下载 ─────────────────────────────");
{
  const r = await fetch(`${BASE}/profiles/template.csv`);
  const buf = new Uint8Array(await r.arrayBuffer());
  const text = new TextDecoder("utf-8").decode(buf);
  ok("模板 200", r.status === 200);
  ok("含 BOM", buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf);
  ok("含表头", text.includes("公司名称") && text.includes("手机"));
  ok("含示例行", text.includes("杭州云启"));
  const cd = r.headers.get("content-disposition") ?? "";
  ok("文件名含「模板」", decodeURIComponent(cd).includes("模板"), cd);
}

console.log("\n── 2. 全部新增 ─────────────────────────────");
let createdIds: number[] = [];
{
  const csv = [
    "公司名称,联系人,职位,手机,邮箱,行业,来源,地址,备注",
    `${MARK}甲公司,王经理,技术总监,13811110001,a@x.com,互联网,转介绍,地址甲,"备注,含逗号"`,
    `${MARK}乙公司,李总,总经理,13811110002,,商贸,官网咨询,地址乙,"含""引号"""`,
    `${MARK}丙公司,张工,CTO,13811110003,c@x.com,数据服务,展会,地址丙,`,
  ].join("\n");
  const r = await upload("t.csv", csv);
  ok("HTTP 200", r.status === 200, `得到 ${r.status}`);
  ok("新增 3 条", stat(r.body, "新增") === 3, `实际 ${stat(r.body, "新增")}`);
  ok("更新 0 条", stat(r.body, "更新") === 0);
  ok("失败 0 条", stat(r.body, "失败") === 0);
  ok("总行数 3", stat(r.body, "总行数") === 3);
  ok("含回滚按钮", r.body.includes("/profiles/import/rollback"));
}

console.log("\n── 3. 按手机号更新 ─────────────────────────");
let rollbackToken = "";
{
  const csv = [
    "公司名称,联系人,手机,来源",
    `${MARK}甲公司改名,王副总,13811110001,展会`,
    `${MARK}全新公司,赵经理,13811119999,其他`,
  ].join("\n");
  const r = await upload("t2.csv", csv);
  ok("新增 1 条", stat(r.body, "新增") === 1, `实际 ${stat(r.body, "新增")}`);
  ok("更新 1 条", stat(r.body, "更新") === 1, `实际 ${stat(r.body, "更新")}`);

  // 校验改名真的生效
  const list = await (await fetch(`${BASE}/profiles?keyword=${encodeURIComponent(MARK + "甲公司改名")}`)).text();
  ok("改名已落库", list.includes("/edit"), "搜不到改名后的记录");
}

console.log("\n── 4. 错误行报告 ───────────────────────────");
{
  const csv = [
    "公司名称,联系人,手机,来源",
    `${MARK}正常行,正常,13811120001,其他`,
    `${MARK}手机错,某某,123,其他`,
    `${MARK}缺联系人,,13811120002,其他`,
    `${MARK}来源错,某某,13811120003,非法来源`,
    `,某某,13811120004,其他`,
  ].join("\n");
  const r = await upload("t3.csv", csv);
  ok("正常行被导入", stat(r.body, "新增") === 1, `实际 ${stat(r.body, "新增")}`);
  ok("4 行失败", stat(r.body, "失败") === 4, `实际 ${stat(r.body, "失败")}`);
  ok("错误行标了行号", r.body.includes("行号"), "缺行号列");
  ok("提示手机格式错误", r.body.includes("11 位手机号"));
  ok("提示联系人必填", r.body.includes("联系人：必填"));
  ok("提示来源非法", r.body.includes("来源：只能是"));
}

console.log("\n── 5. 文件内部重复 ─────────────────────────");
{
  const csv = [
    "公司名称,联系人,手机",
    `${MARK}重复A,甲,13811130001`,
    `${MARK}重复B,乙,13811130001`,
  ].join("\n");
  const r = await upload("t4.csv", csv);
  ok("只导入第一条", stat(r.body, "新增") === 1, `实际 ${stat(r.body, "新增")}`);
  ok("第二条被拒", r.body.includes("重复"), "未提示重复");
}

console.log("\n── 6. 表头别名 ─────────────────────────────");
{
  const csv = [
    "客户名称,对接人,手机号码,客户来源,备注信息",
    `${MARK}别名行,别名联系人,13811140001,转介绍,别名测试`,
  ].join("\n");
  const r = await upload("t5.csv", csv);
  ok("中文别名可识别", stat(r.body, "新增") === 1, `实际 ${stat(r.body, "新增")}`);
}

console.log("\n── 7. 缺列 / 空文件 / 非 CSV ───────────────");
{
  const r1 = await upload("bad1.csv", "公司名称,联系人\n甲,乙");
  ok("缺少手机列被拒", r1.status === 400, `得到 ${r1.status}`);
  ok("提示缺少必需列", r1.body.includes("缺少必需的列"));

  const r2 = await upload("empty.csv", "");
  ok("空文件被拒", r2.status === 400);
  ok("提示文件是空的", r2.body.includes("空的"));

  const fd = new FormData();
  fd.append("file", new File(["x"], "a.txt", { type: "text/plain" }));
  const r3 = await fetch(`${BASE}/profiles/import`, { method: "POST", body: fd });
  ok("非 .csv 被拒", r3.status === 400, `得到 ${r3.status}`);

  const fd2 = new FormData();
  const r4 = await fetch(`${BASE}/profiles/import`, { method: "POST", body: fd2 });
  ok("没选文件被拒", r4.status === 400, `得到 ${r4.status}`);
}

console.log("\n── 8. 行数上限 ─────────────────────────────");
{
  const rows = ["公司名称,联系人,手机"];
  for (let i = 0; i < 501; i++) rows.push(`${MARK}批量${i},联系人,138${String(20000000 + i)}`);
  const r = await upload("big.csv", rows.join("\n"));
  ok("501 行被拒", r.status === 400, `得到 ${r.status}`);
  ok("提示超过上限", r.body.includes("超过单次上限"), "未提示上限");

  const rows2 = ["公司名称,联系人,手机"];
  for (let i = 0; i < 500; i++) rows2.push(`${MARK}边界${i},联系人,138${String(30000000 + i)}`);
  const r2 = await upload("edge.csv", rows2.join("\n"));
  ok("恰好 500 行可导入", stat(r2.body, "新增") === 500, `实际 ${stat(r2.body, "新增")}`);
}

console.log("\n── 9. CSV 转义边界 ────────────────────────");
{
  const csv = [
    '公司名称,联系人,手机,备注',
    `${MARK}引号行,张三,13811150001,"a""b,c`,
  ].join("\n");
  const r = await upload("q.csv", csv);
  ok("引号+逗号组合可解析", stat(r.body, "新增") === 1, `实际 ${stat(r.body, "新增")}`);
}

console.log("\n── 10. 一键回滚 ────────────────────────────");
{
  // 造一批数据 → 导入 → 拿 token → 回滚 → 校验还原
  const seed = ["公司名称,联系人,手机", `${MARK}回滚目标,原联系人,13811160001`].join("\n");
  await upload("seed.csv", seed);

  const csv = [
    "公司名称,联系人,手机",
    `${MARK}回滚目标改名,新联系人,13811160001`,
    `${MARK}回滚新增,新增人,13811160002`,
  ].join("\n");
  const r = await upload("rb.csv", csv);
  const m = r.body.match(/name="token" value="([^"]*)"/);
  ok("结果页带 token", !!m, "未找到 token");

  const token = decodeEntities(m![1]);
  ok("token 是合法 JSON", (() => { try { JSON.parse(token); return true; } catch { return false; } })());

  const parsed = JSON.parse(token);
  ok("token 记录了新增 id", Array.isArray(parsed.insertedIds) && parsed.insertedIds.length === 1, JSON.stringify(parsed.insertedIds));
  ok("token 存的是【更新前】的值", parsed.backup?.[0]?.contactName === "原联系人", `实际 ${parsed.backup?.[0]?.contactName}`);

  const res = await fetch(`${BASE}/profiles/import/rollback`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });
  const rbBody = await res.text();
  ok("回滚 200", res.status === 200, `得到 ${res.status}`);
  ok("提示已撤销", rbBody.includes("已撤销"), rbBody.slice(0, 200));

  // 校验：改名应还原，新增应消失
  const back = await (await fetch(`${BASE}/profiles?keyword=${encodeURIComponent(MARK + "回滚目标")}`)).text();
  ok("改名已还原", back.includes("原联系人") && !back.includes("改名"), "未还原");
  const added = await (await fetch(`${BASE}/profiles?keyword=${encodeURIComponent(MARK + "回滚新增")}`)).text();
  ok("新增记录已删除", !added.includes("/edit"), "新增记录仍在");
}

console.log("\n── 11. 清理 ────────────────────────────────");
{
  // ⚠️ 列表分页，一页只有 10 条 —— 必须逐页翻完才能删干净，
  //    否则只能删到当前页可见的那些
  for (let round = 0; round < 200; round++) {
    const html = await (await fetch(`${BASE}/profiles?keyword=${encodeURIComponent(MARK)}`)).text();
    const ids = [...html.matchAll(/action="\/profiles\/(\d+)\/delete"/g)].map((m) => Number(m[1]));
    if (!ids.length) break;
    await Promise.all(ids.map((id) =>
      fetch(`${BASE}/profiles/${id}/delete`, { method: "POST", redirect: "manual" })));
  }
  const left = await (await fetch(`${BASE}/profiles?keyword=${encodeURIComponent(MARK)}`)).text();
  ok("测试数据已清理", !left.includes("/edit"), "仍有残留");
}

console.log("\n" + "═".repeat(50));
console.log(`通过 ${pass} 项，失败 ${fail.length} 项`);
fail.forEach((f) => console.log("  - " + f));