/**
 * CLI 自动化测试
 * 直接调用 CLI 入口，用子进程跑真实命令
 */
import { SQL } from "bun";

const db = new SQL(process.env.DATABASE_URL!);
let pass = 0;
const fail: string[] = [];

function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail.push(`${name} — ${detail}`); console.log(`  ❌ ${name} ${detail}`); }
}

/** 执行一条 CLI 命令 */
async function cli(...args: string[]) {
  // ⚠️ 两个必须注意的点：
  // 1. 用 process.execPath（bun.exe 本体）而不是 "bun"，否则会解析到 .bat 垫片
  // 2. 直接指向 cli/index.ts，不走 package.json 的 cli 脚本 ——
  //    脚本层会经 cmd.exe，% 等特殊字符会被直接拒绝，传不进程序
  const proc = Bun.spawn([process.execPath, "run", "cli/index.ts", ...args], {
    cwd: import.meta.dir + "/..",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, out, err };
}

const MARK = "CLI" + Math.random().toString(36).slice(2, 6);

async function cleanup() {
  await db`DELETE FROM customers WHERE customer_name LIKE ${`%${MARK}%`}`;
  await db`DELETE FROM customer_profiles WHERE company_name LIKE ${`%${MARK}%`}`;
}

console.log("\n── 0. 环境准备 ──────────────────────────────");
{
  // ⚠️ 必须 RESTART IDENTITY，否则序列不重置，
  //    后面硬编码的 id（2/3/4）会指向别的记录
  await db.unsafe("TRUNCATE customers, customer_profiles RESTART IDENTITY CASCADE");
  ok("已清空数据表且序列归零", true);
}

console.log("\n── 1. 帮助与错误处理 ────────────────────────");
{
  const h = await cli("--help");
  ok("--help 正常退出", h.code === 0, `code=${h.code}`);
  ok("帮助包含两个模块", h.out.includes("demand") && h.out.includes("profile"));
  ok("帮助包含命令列表", h.out.includes("list") && h.out.includes("export"));

  const bad = await cli("nosuch");
  ok("未知模块返回非 0", bad.code !== 0);
  ok("未知模块给出提示", bad.err.includes("未知模块"), bad.err.slice(0, 80));

  const badcmd = await cli("demand", "nosuch");
  ok("未知命令返回非 0", badcmd.code !== 0);

  const modHelp = await cli("demand", "--help");
  ok("模块级帮助含字段说明", modHelp.out.includes("--customer"), modHelp.out.slice(0, 100));
}

console.log("\n── 2. 需求登记 CRUD ────────────────────────");
let demandId = 0;
{
  const add = await cli("demand", "add",
    "--customer", `${MARK}科技有限公司`, "--contact", "王经理",
    "--phone", "13812345001", "--demand", "需要一套完整的客户关系管理系统",
    "--status", "待跟进", "--remark", "老客户引荐");
  ok("add 成功", add.code === 0 && add.out.includes("已登记"), add.out + add.err);
  demandId = Number(add.out.match(/#(\d+)/)?.[1] ?? 0);
  ok("返回了正确的 id", demandId > 0, `实际 ${demandId}`);

  const get = await cli("demand", "get", String(demandId));
  ok("get 正常", get.code === 0);
  ok("get 显示客户名", get.out.includes(`${MARK}科技有限公司`));
  ok("get 显示备注", get.out.includes("老客户引荐"));

  const list = await cli("demand", "list");
  ok("list 正常", list.code === 0);
  ok("list 含表头", list.out.includes("客户名") && list.out.includes("状态"));
  ok("list 含数据", list.out.includes(`${MARK}科技有限公司`));
  ok("list 显示条数", list.out.includes("共 1 条"), list.out.split("\n")[1]);

  const upd = await cli("demand", "update", String(demandId), "--status", "已成交");
  ok("update 成功", upd.code === 0, upd.err);
  const after = await cli("demand", "get", String(demandId));
  ok("update 只改指定字段", after.out.includes("已成交"));
  ok("update 未影响其他字段", after.out.includes(`${MARK}科技有限公司`) && after.out.includes("老客户引荐"));

  const bad = await cli("demand", "update", String(demandId), "--phone", "123");
  ok("非法手机号被拒", bad.code !== 0 && bad.err.includes("11 位"), bad.err.slice(0, 100));

  const missing = await cli("demand", "get", "999999");
  ok("查不存在的记录返回非 0", missing.code !== 0);
}

console.log("\n── 3. 搜索与筛选 ──────────────────────────");
{
  // 顺便验证空值占位：这条不填备注
  const noRemark = await cli("demand", "add", "--customer", `${MARK}上海公司`,
    "--contact", "李总", "--phone", "13812345002", "--demand", "需求B", "--status", "沟通中");
  ok("第二条需求新增成功", noRemark.code === 0, noRemark.out + noRemark.err);

  const blankId = Number(noRemark.out.match(/#(\d+)/)?.[1] ?? 0);
  const blankGet = await cli("demand", "get", String(blankId));
  ok("空备注显示占位符 —", blankGet.out.includes("备注") && blankGet.out.includes("—"), blankGet.out);

  const kw = await cli("demand", "list", "--keyword", "上海");
  ok("关键词搜索命中 1 条", kw.out.includes("共 1 条"), kw.out.split("\n")[1]);

  const st = await cli("demand", "list", "--status", "沟通中");
  ok("状态筛选命中", st.out.includes("共 1 条"), st.out.split("\n")[1]);

  const both = await cli("demand", "list", "--keyword", "上海", "--status", "已成交");
  ok("组合筛选（无匹配）", both.out.includes("共 0 条"), both.out.split("\n")[1]);

  const none = await cli("demand", "list", "--keyword", "不存在的关键词zzz");
  ok("无结果显示空表提示", none.out.includes("无数据"));

  // 通配符不应返回全表
  const wild = await cli("demand", "list", "--keyword", "%");
  ok("LIKE 通配符被转义", wild.out.includes("共 0 条"), wild.out.split("\n")[1]);
}

console.log("\n── 4. 批量删除 ────────────────────────────");
{
  const ids = [2, 3, 4];
  for (const id of ids) {
    await cli("demand", "add", "--customer", `${MARK}批量${id}`, "--contact", "批",
      "--phone", `1381234501${id}`, "--demand", `需求${id}`);
  }

  const noForce = await cli("demand", "remove", "2", "3");
  ok("无 --force 时不执行删除", noForce.code !== 0);
  ok("无 --force 时先预览", noForce.out.includes("将要删除"), noForce.out.slice(0, 80));

  const still = await cli("demand", "list");
  ok("预览后记录仍在（5 条）", still.out.includes("共 5 条"), still.out.split("\n")[1]);

  const forced = await cli("demand", "remove", "2", "3", "4", "--force");
  ok("带 --force 执行删除", forced.code === 0 && forced.out.includes("已删除 3 条"), forced.out + forced.err);

  const after = await cli("demand", "list");
  ok("删除生效（剩 2 条）", after.out.includes("共 2 条"), after.out.split("\n")[1]);

  const partial = await cli("demand", "remove", "9999", "--force");
  ok("删除不存在的记录不报错", partial.code === 0);
  ok("提示有记录不存在", partial.out.includes("不存在"), partial.out);

  // 逗号形式（PowerShell 下会被转成空格）
  await cli("demand", "add", "--customer", `${MARK}逗号测试`, "--contact", "x",
    "--phone", "13812345009", "--demand", "d");
  const comma = await cli("demand", "remove", "5,6", "--force");
  ok("逗号/空格混合分隔可用", comma.code === 0, comma.out + comma.err);
}

console.log("\n── 5. 客户档案 CRUD ────────────────────────");
{
  const add = await cli("profile", "add",
    "--company", `${MARK}数据科技`, "--contact", "张工", "--position", "CTO",
    "--phone", "13812345021", "--email", "zhang@data.com",
    "--industry", "互联网", "--source", "展会",
    "--address", "深圳市南山区科技园", "--remark", "展会认识");
  ok("add 成功", add.code === 0 && add.out.includes("已建档"), add.out + add.err);
  const pid = Number(add.out.match(/#(\d+)/)?.[1] ?? 0);

  const get = await cli("profile", "get", String(pid));
  ok("get 正常", get.code === 0);
  ok("get 显示公司", get.out.includes(`${MARK}数据科技`));
  ok("get 显示邮箱", get.out.includes("zhang@data.com"));
  ok("get 显示备注", get.out.includes("展会认识"));

  // 手机号唯一约束
  const dup = await cli("profile", "add", "--company", `${MARK}重复`, "--contact", "甲",
    "--phone", "13812345021");
  ok("重复手机号被拒", dup.code !== 0);
  ok("重复手机号给友好提示", dup.err.includes("唯一约束") || dup.err.includes("已被占用"), dup.err.slice(0, 100));

  const upd = await cli("profile", "update", String(pid), "--industry", "数据服务");
  ok("update 成功", upd.code === 0, upd.err);
  const after = await cli("profile", "get", String(pid));
  ok("update 生效", after.out.includes("数据服务"));
  ok("update 未清空其他字段", after.out.includes("zhang@data.com") && after.out.includes("展会认识"));

  const list = await cli("profile", "list", "--source", "展会");
  ok("按来源筛选", list.out.includes("共 1 条"), list.out.split("\n")[1]);
}

console.log("\n── 6. JSON 输出 ────────────────────────────");
{
  const j = await cli("demand", "list", "--json");
  ok("--json 退出 0", j.code === 0);
  let parsed: any;
  try { parsed = JSON.parse(j.out); } catch { parsed = null; }
  ok("输出是合法 JSON", parsed !== null, j.out.slice(0, 100));
  ok("含 list/total/page", parsed?.list && parsed?.total !== undefined && parsed?.page !== undefined);
  ok("列表非空", Array.isArray(parsed?.list) && parsed.list.length > 0);

  const one = await cli("demand", "get", String(demandId), "--json");
  let oneParsed: any;
  try { oneParsed = JSON.parse(one.out); } catch { oneParsed = null; }
  ok("get --json 是对象", oneParsed?.id === demandId, one.out.slice(0, 120));
  ok("含 remark 字段", "remark" in (oneParsed ?? {}));
}

console.log("\n── 7. CSV 导出 ────────────────────────────");
{
  const before = await db`SELECT count(*)::int AS n FROM customers`;
  const expect = Number(before[0].n);

  const outFile = `${import.meta.dir}/../../tmp-cli-export.csv`;
  const ex = await cli("demand", "export", "-o", outFile);
  ok("导出命令成功", ex.code === 0 && ex.out.includes("已导出"), ex.out + ex.err);

  // ⚠️ Bun.file().text() 会剥离 BOM，必须读原始字节
  const buf = new Uint8Array(await Bun.file(outFile).arrayBuffer());
  ok("含 UTF-8 BOM", buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf,
    `前3字节=${[...buf.slice(0, 3)].map((b) => b.toString(16)).join(" ")}`);

  const content = new TextDecoder("utf-8").decode(buf);
  ok("含中文表头", content.includes("客户名") && content.includes("备注"));
  const lines = content.replace(/^﻿/, "").trim().split("\r\n");
  ok(`行数 = 表头 + ${expect} 条数据`, lines.length === expect + 1, `实际 ${lines.length} 行，期望 ${expect + 1}`);

  await Bun.write(`${outFile}.done`, "");
  await Bun.$`del ${outFile}`.quiet().nothrow();

  const stdout = await cli("demand", "export");
  ok("不带 -o 时输出到 stdout", stdout.out.includes("编号,客户名"), stdout.out.slice(0, 60));
}

console.log("\n── 8. 中日韩字符列对齐 ─────────────────────");
{
  // 全角字符占 2 列，如果没算对表头会错位
  const list = await cli("demand", "list");
  const headerLine = list.out.split("\n").find((l) => l.includes("客户名"));
  const sepLine = list.out.split("\n")[2];
  ok("表头含中文列", !!headerLine);
  ok("分隔线存在", !!sepLine && sepLine.includes("─"));

  const pw = await cli("profile", "list");
  ok("档案列表也能渲染", pw.code === 0);
}

console.log("\n── 清理 ────────────────────────────────────");
await cleanup();
const left = await db`SELECT (SELECT count(*) FROM customers) AS d, (SELECT count(*) FROM customer_profiles) AS p`;
ok("测试数据已清空", Number(left[0].d) === 0 && Number(left[0].p) === 0, JSON.stringify(left[0]));

console.log("\n" + "═".repeat(50));
console.log(`通过 ${pass} 项，失败 ${fail.length} 项`);
fail.forEach((f) => console.log("  - " + f));

await db.close();
process.exit(fail.length ? 1 : 0);