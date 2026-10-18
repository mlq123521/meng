/**
 * MCP Server 集成测试
 *
 * 真起一个子进程走 stdio，用 JSON-RPC 握手，然后逐个调用工具。
 * 这样测的是「MCP 客户端看到的那个 server」，不是内部函数。
 *
 * 运行：bun run test/mcp.test.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { client as db } from "../db";
import { SOURCES, STATUSES } from "../db/schema";

let pass = 0;
let failCount = 0;

function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    failCount++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * 从 MCP 的结果里取出数据。
 *
 * 注意有两种「失败」形态，都算数：
 * 1. 协议层错误 —— zod schema 不通过，MCP client 直接 reject，
 *    报 "MCP error -32602: Input validation error"
 * 2. 业务层错误 —— 我们的 handler 返回 isError + {ok:false,error}
 * 前者说明 schema 拦住了，后者说明校验规则拦住了。
 */
function data(result: unknown): any {
  const text = (result as any).content?.[0]?.text;
  if (typeof text !== "string") throw new Error(`非文本结果：${JSON.stringify(result)}`);
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text };
  }
}

/** 统一的「调用并取值」，把协议层 reject 也转成 {ok:false,error} */
async function call(mcp: McpClient, name: string, args: Record<string, unknown>) {
  try {
    return data(await mcp.callTool({ name, arguments: args }));
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return { ok: false, protocolError: true, error: msg };
  }
}

const SEED = Math.random().toString(36).slice(2, 7);
const MK = `MK${SEED}`;

/* ── 0. 准备 ── */
console.log("\n── 0. 环境准备 ──────────────────────────");
await db.unsafe("TRUNCATE demands, customer_profiles RESTART IDENTITY CASCADE");

const transport = new StdioClientTransport({
  command: process.execPath, // ⚠️ 必须用 bun.exe 本体，不能用 "bun"（Windows 会解析到 .bat 垫片）
  args: ["run", "--env-file=.env", "mcp/server.ts"],
  cwd: process.cwd(),
  env: { ...(process.env as Record<string, string>) },
});

const mcp = new Client({ name: "mcp-test", version: "1.0.0" });
await mcp.connect(transport);
ok("MCP 客户端连接成功", true);

// 日志走 stderr，不能污染 stdout
const stderrTail: string[] = [];

console.log("\n── 1. 工具目录 ──────────────────────────");
const tools = await mcp.listTools();
const names = tools.tools.map((t) => t.name).sort();
ok("工具总数为 11", tools.tools.length === 11, `实际 ${tools.tools.length}: ${names.join(",")}`);

for (const n of [
  "profile_list",
  "profile_get",
  "profile_add",
  "profile_update",
  "profile_delete",
  "profile_pick",
  "demand_list",
  "demand_get",
  "demand_add",
  "demand_update",
  "demand_delete",
]) {
  ok(`注册了 ${n}`, names.includes(n));
}

const profAdd = tools.tools.find((t) => t.name === "profile_add")!;
ok("profile_add 有中文 title", (profAdd as any).title === "新建客户档案", String((profAdd as any).title));
ok(
  "profile_add 声明了必填 phone",
  !!(profAdd.inputSchema as any).properties?.phone,
  JSON.stringify(Object.keys((profAdd.inputSchema as any).properties ?? {})),
);
const demandAdd = tools.tools.find((t) => t.name === "demand_add")!;
ok("demand_add 声明了必填 profileId", !!(demandAdd.inputSchema as any).properties?.profileId);
ok(
  "demand_add 的 status 用枚举约束",
  JSON.stringify((demandAdd.inputSchema as any).properties?.status).includes(STATUSES[0]),
  JSON.stringify((demandAdd.inputSchema as any).properties?.status),
);
ok(
  "profile_add 的 source 用枚举约束",
  JSON.stringify((profAdd.inputSchema as any).properties?.source).includes(SOURCES[0]),
);

console.log("\n── 2. 建档 ────────────────────────────");
const bad = await call(mcp, "profile_add", { companyName: "无联系人", contactName: "", phone: "13800000001" });
ok("缺联系人被拒", bad.ok === false, JSON.stringify(bad));
ok("错误信息可读", typeof bad.error === "string" && bad.error.includes("联系人"), bad.error);

const badPhone = await call(mcp, "profile_add", { companyName: "手机错", contactName: "甲", phone: "123" });
ok("手机号格式校验生效", badPhone.ok === false && String(badPhone.error).includes("手机"), badPhone.error);

const badSource = await call(mcp, "profile_add", { companyName: "来源错", contactName: "甲", phone: "13800000002", source: "随便编的" });
ok("非法来源被拒（schema 枚举 + 校验双层）", badSource.ok === false, JSON.stringify(badSource));

const created = await call(mcp, "profile_add", {
      companyName: `${MK}科技有限公司`,
      contactName: "王经理",
      phone: "13860000001",
      position: "技术总监",
      source: "转介绍",
      remark: "老客户引荐",
});
ok("建档成功", created.ok === true, JSON.stringify(created).slice(0, 200));
const pid = created.profile?.id;
ok("返回了 id", typeof pid === "number" && pid > 0, String(pid));
ok("source 落库正确", created.profile?.source === "转介绍", created.profile?.source);
ok("未传的选填字段存为 null", created.profile?.email === null, JSON.stringify(created.profile?.email));

const dup = await call(mcp, "profile_add", { companyName: "重复手机", contactName: "乙", phone: "13860000001" });
ok("手机号重复被拒", dup.ok === false, JSON.stringify(dup));
ok("重复错误已翻译", String(dup.error).includes("手机号已存在"), dup.error);

console.log("\n── 3. 查询 ────────────────────────────");
const one = await call(mcp, "profile_get", { id: pid });
ok("按 id 取档案", one.profile?.companyName === `${MK}科技有限公司`);
ok("详情带出名下需求", Array.isArray(one.demands) && one.demands.length === 0, JSON.stringify(one.demands));

const miss = await call(mcp, "profile_get", { id: 999999 });
ok("不存在的 id 返回可读错误", miss.ok === false && miss.error.includes("未找到"), JSON.stringify(miss));

const listed = await call(mcp, "profile_list", { keyword: MK });
ok("列表按关键词过滤", listed.total === 1, `total=${listed.total}`);
ok("列表含分页信息", typeof listed.page === "number" && typeof listed.totalPages === "number");

const picked = await call(mcp, "profile_pick", {});
ok("profile_pick 返回精简字段", picked.profiles?.[0] && !("email" in picked.profiles[0]), JSON.stringify(picked.profiles?.[0]));
ok("profile_pick 带出 id", picked.profiles?.[0]?.id === pid);

console.log("\n── 4. 需求登记 ─────────────────────────");
const noProfile = await call(mcp, "demand_add", { profileId: 999999, demand: "孤儿需求" });
ok("profileId 不存在被拒", noProfile.ok === false, JSON.stringify(noProfile));
ok("外键错误已翻译", String(noProfile.error).includes("客户档案不存在"), noProfile.error);

const noDemand = await call(mcp, "demand_add", { profileId: pid, demand: "" });
ok("空需求描述被拒", noDemand.ok === false && String(noDemand.error).includes("需求描述"), noDemand.error);

const d1 = await call(mcp, "demand_add", { profileId: pid, demand: `${MK} 需要一套 CRM`, remark: "Q4 启动" });
ok("登记需求成功", d1.ok === true, JSON.stringify(d1).slice(0, 200));
ok("默认状态为待跟进", d1.demand?.status === "待跟进", d1.demand?.status);
ok("需求带上客户信息", d1.demand?.companyName === `${MK}科技有限公司`, d1.demand?.companyName);
const did = d1.demand?.id;

console.log("\n── 5. 单一事实来源 ─────────────────────");
await call(mcp, "profile_update", { id: pid, companyName: `${MK}（已改名）` });
const after = await call(mcp, "demand_get", { id: did });
ok("改档案名后需求侧同步", after.companyName === `${MK}（已改名）`, after.companyName);

const upd = await call(mcp, "demand_update", { id: did, status: "已成交" });
ok("改状态成功", upd.demand?.status === "已成交", upd.demand?.status);
ok("未传的字段保持不变", upd.demand?.remark === "Q4 启动", upd.demand?.remark);
ok("未传的字段保持不变（客户名）", upd.demand?.companyName === `${MK}（已改名）`, upd.demand?.companyName);

const badStatus = await call(mcp, "demand_update", { id: did, status: "瞎写的状态" });
ok("非法状态被拒", badStatus.ok === false, JSON.stringify(badStatus));

console.log("\n── 6. 删除的两段式确认 ─────────────────");
let del = await call(mcp, "demand_delete", { ids: [did] });
ok("不带 confirm 只预览", del.ok === false && del.needsConfirm === true, JSON.stringify(del));
ok("预览返回待删清单", del.targets?.[0]?.id === did);
const stillThere = await db`SELECT id FROM demands WHERE id = ${did}`;
ok("预览后数据仍在", stillThere.length === 1);

// ids 传字符串也要能解析（"3,4" 这种）—— 仍然只预览
const strIds = await call(mcp, "demand_delete", { ids: `${did} , ${did}` });
ok("字符串 id 也能接受", strIds.ok === false && strIds.needsConfirm === true, JSON.stringify(strIds));

del = await call(mcp, "demand_delete", { ids: [did], confirm: true });
ok("带 confirm 才真删", del.ok === true && del.deleted === 1, JSON.stringify(del));
const gone = await db`SELECT id FROM demands WHERE id = ${did}`;
ok("库里确实删掉了", gone.length === 0);

// 重新造一条需求用于后面删档案
const d2 = await call(mcp, "demand_add", { profileId: pid, demand: `${MK} 第二条需求` });
const did2 = d2.demand?.id;

const profPrev = await call(mcp, "profile_delete", { ids: [pid] });
ok("删档案先预览", profPrev.ok === false && profPrev.needsConfirm === true);
ok("预览说明了会连带删需求", profPrev.targets?.[0]?.demandCount === 1, JSON.stringify(profPrev.targets?.[0]));
ok(
  "预览给出明确的下一步指令",
  String(profPrev.message).includes("confirm=true"),
  profPrev.message,
);

const profDel = await call(mcp, "profile_delete", { ids: [pid], confirm: true });
ok("确认后删除档案", profDel.ok === true && profDel.deleted === 1, JSON.stringify(profDel));
const cascaded = await db`SELECT id FROM demands WHERE id = ${did2}`;
ok("名下需求已级联删除", cascaded.length === 0);

const delMiss = await call(mcp, "demand_delete", { ids: [999999] });
ok("删除不存在的记录返回可读错误", delMiss.ok === false && delMiss.error.includes("未找到"), JSON.stringify(delMiss));

const delEmpty = await call(mcp, "demand_delete", { ids: "abc" });
ok("无效 id 被拒", delEmpty.ok === false, JSON.stringify(delEmpty));

console.log("\n── 7. 列表工具 ─────────────────────────");
await db.unsafe("TRUNCATE demands, customer_profiles RESTART IDENTITY CASCADE");
for (let i = 1; i <= 3; i++) {
  const p = await call(mcp, "profile_add", {
    companyName: `${MK}公司${i}`,
    contactName: `联系人${i}`,
    phone: `1386000000${i}`,
    source: "其他",
  });
  await call(mcp, "demand_add", {
    profileId: p.profile.id,
    demand: `${MK}需求${i}`,
    status: i === 1 ? "待跟进" : "已成交",
  });
}

const dl = await call(mcp, "demand_list", { keyword: MK });
ok("需求列表 3 条", dl.total === 3, `total=${dl.total}`);
ok("列表带上客户信息", dl.demands?.[0]?.companyName?.startsWith(MK), dl.demands?.[0]?.companyName);

const byStatus = await call(mcp, "demand_list", { keyword: MK, status: "已成交" });
ok("按状态筛选生效", byStatus.total === 2, `total=${byStatus.total}`);

const byCompany = await call(mcp, "demand_list", { keyword: `${MK}公司2` });
ok("按客户名搜索生效（跨表 join）", byCompany.total === 1, `total=${byCompany.total}`);

const byProfile = await call(mcp, "demand_list", { profileId: 1 });
ok("按客户档案筛选生效", byProfile.total === 1, `total=${byProfile.total}`);

const page2 = await call(mcp, "demand_list", { keyword: MK, pageSize: 5, page: 2 });
ok("越界页码自动回退到末页", page2.page === 1, `page=${page2.page}`);

console.log("\n── 清理 ────────────────────────────────────");
await db.unsafe("TRUNCATE demands, customer_profiles RESTART IDENTITY CASCADE");
const left = await db`SELECT count(*)::int AS n FROM customer_profiles`;
ok("测试数据已清空", left[0].n === 0);

await mcp.close();

console.log("\n" + "═".repeat(50));
console.log(`通过 ${pass} 项，失败 ${failCount} 项`);
if (stderrTail.length) console.log(stderrTail.join("\n"));
await db.close();
process.exit(failCount === 0 ? 0 : 1);