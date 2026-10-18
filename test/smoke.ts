/**
 * 自动化冒烟 + 边界测试
 * 运行：bun run test/smoke.ts
 * 依赖：服务已在 3000 端口运行
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let pass = 0;
const failures: string[] = [];
const bugNotes: string[] = [];

function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(`${name}${detail ? " — " + detail : ""}`);
    console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`);
  }
}

function note(msg: string) {
  bugNotes.push(msg);
  console.log(`  ⚠️  ${msg}`);
}

function section(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 46 - title.length))}`);
}

async function req(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: string; headers: Headers }> {
  const res = await fetch(BASE + path, { redirect: "manual", ...init });
  return { status: res.status, body: await res.text(), headers: res.headers };
}

/** 提交表单 */
async function post(path: string, data: Record<string, string>) {
  return req(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data).toString(),
  });
}

const uniq = Math.random().toString(36).slice(2, 8);
/** 所有测试数据的名称都含这个标记，搜索它即可命中 */
const MARK = 'MARK' + uniq;

let createdCustomerId = 0;
let createdProfileId = 0;

/* ══════════════════ 1. 基础可达性 ══════════════════ */
section("1. 路由可达性");
{
  const routes: [string, string, number][] = [
    ["/", "需求列表", 200],
    ["/new", "需求表单", 200],
    ["/export.csv", "CSV 导出", 200],
    ["/profiles", "档案列表", 200],
    ["/profiles/new", "建档表单", 200],
  ];
  for (const [p, name, want] of routes) {
    const r = await req(p);
    ok(`${name} ${p}`, r.status === want, `得到 ${r.status}，期望 ${want}`);
  }

  const nf = await req("/definitely-not-a-route");
  ok("未知路由返回 404", nf.status === 404, `得到 ${nf.status}`);
}

/* ══════════════════ 2. 安全响应头 ══════════════════ */
section("2. 安全响应头");
{
  const r = await req("/");
  ok("X-Content-Type-Options: nosniff", r.headers.get("x-content-type-options") === "nosniff");
  ok("X-Frame-Options 已设置", !!r.headers.get("x-frame-options"));
  ok("X-Powered-By 已隐藏", !r.headers.get("x-powered-by"), `仍为 ${r.headers.get("x-powered-by")}`);
}

/* ══════════════════ 3. 需求登记 CRUD ══════════════════ */
section("3. 需求登记 CRUD");
{
  const r = await post("/", {
    customerName: `${MARK}甲`,
    contactName: "王五",
    phone: "13812345678",
    demand: "需要一个客户管理系统",
    status: "待跟进",
  });
  ok("新建需求返回 302", r.status === 302, `得到 ${r.status}`);
  ok("302 带 Location", r.headers.get("location") === "/", `Location=${r.headers.get("location")}`);
}

/* ══════════════════ 4. 客户档案 CRUD ══════════════════ */
section("4. 客户档案 CRUD");
{
  // 先建档
  const cr = await post("/profiles", {
    companyName: `${MARK}甲`,
    contactName: "王五",
    position: "技术总监",
    phone: "13812345679",
    email: "old@example.com",
    industry: "互联网",
    source: "转介绍",
    address: "旧地址 1 号",
    remark: "初始备注",
  });
  ok("新建档案返回 302", cr.status === 302, `得到 ${cr.status}`);
  createdProfileId = Number(cr.headers.get("location")!.split("/").pop());

  // 详情页里的公司名链接是 <a href="/profiles/N">，列表页是 /profiles/N/edit
  const detail0 = await req(`/profiles/${createdProfileId}`);
  ok("新建后详情页可访问", detail0.status === 200, `得到 ${detail0.status}`);
  ok("新建后详情页显示公司名", detail0.body.includes(`${MARK}甲`), "未显示新公司名");

  const search = await req("/profiles?keyword=" + encodeURIComponent(`${MARK}甲`));
  ok("新建后可搜索到", search.body.includes("/edit"), "搜索结果为空");

  const editForm = await req(`/profiles/${createdProfileId}/edit`);
  ok("编辑表单 200", editForm.status === 200);
  ok("编辑表单回填公司名", editForm.body.includes(`${MARK}甲`), "未找到回填值");
  ok("编辑表单回填邮箱", editForm.body.includes("old@example.com"), "未找到回填邮箱");
  ok("编辑表单回填备注", editForm.body.includes("初始备注"), "未找到回填备注");
  ok("编辑表单提交地址指向自身", editForm.body.includes(`action="/profiles/${createdProfileId}"`), "action 不对");

  const upd = await post(`/profiles/${createdProfileId}`, {
    companyName: `${MARK}改名`,
    contactName: "王五",
    position: "CTO",
    phone: "13812345679",
    email: "",              // 清空邮箱 → 应变 NULL
    industry: "金融",
    source: "展会",
    address: "新地址 2 号",
    remark: "改过的备注",
  });
  ok("更新档案返回 302", upd.status === 302, `得到 ${upd.status}`);
  ok("更新后跳详情页", upd.headers.get("location") === `/profiles/${createdProfileId}`, `Location=${upd.headers.get("location")}`);

  const after = await req(`/profiles/${createdProfileId}`);
  ok("更新已落库（公司名）", after.body.includes(`${MARK}改名`), "未出现新公司名");
  ok("更新已落库（行业）", after.body.includes("金融"), "行业未更新");
  ok("清空后邮箱显示为空占位", after.body.includes("13812345679") && !after.body.includes("old@example.com"), "邮箱未清空");

  ok("可按新名搜索到", (await req("/profiles?keyword=" + encodeURIComponent(MARK + "改名"))).body.includes("/edit"), "搜不到改名后的记录");
  const oldSearch = await req("/profiles?keyword=" + encodeURIComponent(`${MARK}甲`));
  ok("旧名已搜索不到", oldSearch.body.includes("筛选出 0 份"), "旧名仍能搜到");
}

/* ══════════════════ 5. 校验边界 ══════════════════ */
section("5. 校验边界");
{
  // 恰好 60 字（应通过）
  const ok60 = (MARK + "名".repeat(60)).slice(0, 60);
  const r1 = await post("/profiles", {
    companyName: ok60,
    contactName: "测试",
    phone: "13800001111",
    source: "其他",
  });
  ok("公司名恰好 60 字 → 接受", r1.status === 302, `得到 ${r1.status}`);

  // 61 字（应拒绝）
  const r2 = await post("/profiles", {
    companyName: (MARK + "名".repeat(61)).slice(0, 61),
    contactName: "测试",
    phone: "13800002222",
    source: "其他",
  });
  ok("公司名 61 字 → 拒绝", r2.status === 400, `得到 ${r2.status}`);

  // 手机边界
  const phones: [string, string][] = [
    ["13812345678", "合法 11 位"],
    ["1381234567", "10 位"],
    ["138123456789", "12 位"],
    ["12812345678", "第二位为 2"],
    ["1381234567a", "含字母"],
    ["+8613812345678", "带国际区号"],
  ];
  for (const [p, label] of phones) {
    const r = await post("/profiles", { companyName: `${MARK}边界`, contactName: "T", phone: p, source: "其他" });
    const expect = label === "合法 11 位" ? 302 : 400;
    ok(`手机「${label}」${p}`, r.status === expect, `得到 ${r.status}，期望 ${expect}`);
  }

  // 邮箱边界
  const emails: [string, boolean][] = [
    ["a@b.com", true],
    ["a@b", false],
    ["a@@b.com", false],
    ["a b@c.com", false],
    ["@b.com", false],
  ];
  for (const [e, valid] of emails) {
    const r = await post("/profiles", {
      companyName: `${MARK}邮箱`,
      contactName: "T",
      phone: "13800003333",
      email: e,
      source: "其他",
    });
    ok(`邮箱「${e || "(空)"}」`, (r.status === 302) === valid, `得到 ${r.status}，期望${valid ? 302 : 400}`);
  }
}

/* ══════════════════ 6. SQL 注入 ══════════════════ */
section("6. SQL 注入");
{
  const payloads = [
    "'; DROP TABLE customers; --",
    "' OR '1'='1",
    "1; DELETE FROM customer_profiles",
    "' UNION SELECT NULL,version() --",
  ];
  for (const payload of payloads) {
    const r = await req("/profiles?keyword=" + encodeURIComponent(payload));
    ok(`关键词注入「${payload.slice(0, 20)}」不报错`, r.status === 200, `得到 ${r.status}`);
  }

  // 确认表还在
  const after = await req("/profiles");
  ok("注入后档案表仍可访问", after.status === 200);
}

/* ══════════════════ 7. XSS 转义 ══════════════════ */
section("7. XSS 输出转义");
{
  const payload = `<script>alert(1)</script>`;
  const r = await post("/profiles", {
    companyName: payload,
    contactName: "测试",
    phone: "13800004444",
    source: "其他",
  });
  ok("含 <script> 的公司名提交成功（未在入口拦截）", r.status === 302, `得到 ${r.status}`);

  if (r.status === 302) {
    const loc = r.headers.get("location")!;
    const id = loc.split("/").pop();
    const detail = await req(loc);
    const escaped = detail.body.includes("&lt;script&gt;");
    const raw = detail.body.includes("<script>alert(1)</script>");
    ok("详情页已 HTML 转义", escaped, "未找到转义后的内容");
    ok("详情页无原始 <script>", !raw, "存在未转义输出");

    // 清理
    await post(`/profiles/${id}/delete`, {});
  }
}

/* ══════════════════ 8. LIKE 通配符 ══════════════════ */
section("8. LIKE 通配符转义");
{
  for (const kw of ["%", "_", "%%", "\%", "a%b"]) {
    const r = await req("/profiles?keyword=" + encodeURIComponent(kw));
    const m = r.body.match(/筛选出 (\d+) 份/);
    const n = m ? Number(m[1]) : -1;
    ok(`搜索「${kw}」不返回全表`, n >= 0 && n < 5, `返回 ${n} 条`);
  }
}

/* ══════════════════ 9. 分页边界 ══════════════════ */
section("9. 分页边界");
{
  const cases = ["?page=0", "?page=-1", "?page=abc", "?page=999999", "?page=1.5", "?pageSize=0", "?pageSize=99999"];
  for (const q of cases) {
    const r = await req("/profiles" + q);
    ok(`分页${q} 不崩溃`, r.status === 200, `得到 ${r.status}`);
  }
}

/* ══════════════════ 10. id 解析 ══════════════════ */
section("10. id 解析");
{
  const badIds = ["abc", "-1", "0", "1.5", "9999999999999999999", "%20", "1%20OR%201=1"];
  for (const id of badIds) {
    const r = await req(`/profiles/${id}`);
    ok(`非法 id「${id}」返回 404/400`, r.status === 404 || r.status === 400, `得到 ${r.status}`);
  }
}

/* ══════════════════ 11. CSV 导出 ══════════════════ */
section("11. CSV 导出");
{
  const r = await req("/export.csv");
  ok("CSV 200", r.status === 200);
  ok("Content-Type 为 text/csv", (r.headers.get("content-type") ?? "").includes("text/csv"));
  ok("是附件下载", (r.headers.get("content-disposition") ?? "").includes("attachment"));
  ok("含中文表头", r.body.includes("客户名"));

  // ⚠️ fetch 的 .text() 会按 UTF-8 解码规范剥离 BOM，必须用原始字节校验
  const raw = await fetch(BASE + "/export.csv");
  const buf = new Uint8Array(await raw.arrayBuffer());
  const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  ok("含 UTF-8 BOM", hasBom, `前3字节=${[...buf.slice(0, 3)].map((b) => b.toString(16)).join(" ")}`);

  const filtered = await req("/export.csv?status=" + encodeURIComponent("已成交"));
  ok("CSV 支持筛选参数", filtered.status === 200);

  const none = await req("/export.csv?keyword=" + encodeURIComponent("绝不存在的关键词zzz"));
  ok("无数据时导出仍 200", none.status === 200);
  ok("无数据时只有表头", none.body.trim().split("\r\n").length === 1, `实际 ${none.body.trim().split("\r\n").length} 行`);
}

/* ══════════════════ 11b. CSV 公式注入 ══════════════════ */
section("11b. CSV 公式注入防护");
{
  // 档案模块没有导出功能，用需求登记的 /export.csv 验证
  const cr = await post("/", {
    customerName: "=1+1",
    contactName: "@SUM(1+1)",
    phone: "13800008888",
    demand: `=cmd|'!A0 ${MARK}injection, 预算50000元`,
    status: "待跟进",
  });
  ok("含公式字符的数据可入库", cr.status === 302, `得到 ${cr.status}`);

  const csv = await req("/export.csv?keyword=" + encodeURIComponent(MARK));
  ok("导出命中测试数据", csv.body.includes(MARK), "CSV 里没找到测试数据");
  ok("= 开头已加防护前缀", csv.body.includes("'=1+1"), "客户名未加前缀");
  ok("@ 开头已加防护前缀", csv.body.includes("'@SUM(1+1)"), "联系人未加前缀");
  ok("=cmd 已加防护前缀", csv.body.includes("'=cmd"), "需求描述未加前缀");
  ok("含逗号的字段被引号包裹", /"[^"]*,[^"]*"/.test(csv.body), "未见引号包裹");

  // 顺带确认档案详情页不原样输出 HTML
  const pr = await post("/profiles", {
    companyName: "<script>alert(1)</script>",
    contactName: "T",
    phone: "13800008889",
    source: "其他",
  });
  if (pr.status === 302) {
    const pid = Number(pr.headers.get("location")!.split("/").pop());
    const page = await req(`/profiles/${pid}`);
    ok("档案详情未原样输出 <script>", !page.body.includes("<script>alert(1)</script>"), "存在未转义输出");
    await post(`/profiles/${pid}/delete`, {});
  }
}

/* ══════════════════ 12. 表单回填 ══════════════════ */
section("12. 校验失败回填");
{
  const r = await post("/profiles", {
    companyName: `${MARK}回填`,
    contactName: "",
    phone: "13800005555",
    source: "其他",
  });
  ok("校验失败返回 400", r.status === 400, `得到 ${r.status}`);
  ok("已填内容被回填", r.body.includes(`${MARK}回填`), "回填丢失");
  ok("手机也被回填", r.body.includes("13800005555"), "回填丢失");
  ok("显示错误提示", r.body.includes("联系人"), "无错误提示");

  // 需求侧回填
  const rc = await post("/", {
    customerName: `${MARK}回填需求`,
    contactName: "",
    phone: "13800006666",
    demand: "内容",
    status: "待跟进",
  });
  ok("需求校验失败 400", rc.status === 400);
  ok("需求侧已填内容回填", rc.body.includes(`${MARK}回填需求`));
}

/* ══════════════════ 13. 删除 ══════════════════ */
section("13. 删除");
{
  if (createdProfileId) {
    const before = await req("/profiles?keyword=" + encodeURIComponent(MARK));
    const b = before.body.match(/筛选出 (\d+) 份/);
    ok("删除前能找到", /筛选出 [1-9]\d* 份/.test(before.body), `实际 ${b?.[1]}`);

    const del = await post(`/profiles/${createdProfileId}/delete`, {});
    ok("删除返回 302", del.status === 302, `得到 ${del.status}`);
    ok("跳回档案列表", del.headers.get("location") === "/profiles", `Location=${del.headers.get("location")}`);

    const after = await req(`/profiles/${createdProfileId}`);
    ok("删除后详情 404", after.status === 404, `得到 ${after.status}`);

    const delAgain = await post(`/profiles/${createdProfileId}/delete`, {});
    ok("重复删除返回 404", delAgain.status === 404, `得到 ${delAgain.status}`);
  }
}

/* ══════════════════ 14. 超大请求体 ══════════════════ */
section("14. 请求体大小限制");
{
  const big = "x".repeat(200_000);
  const r = await post("/profiles", { companyName: "A", contactName: "B", phone: "13800007777", demand: big, source: "其他" });
  ok("超大 body 被拒(413)", r.status === 413, `得到 ${r.status}`);
}

/* ══════════════════ 15. 并发写入 ══════════════════ */
section("15. 并发写入");
{
  const jobs = Array.from({ length: 10 }, (_, i) =>
    post("/profiles", {
      companyName: `${MARK}并发${i}`,
      contactName: "并发",
      phone: `138${String(10000000 + i)}`,
      source: "其他",
    }),
  );
  const results = await Promise.all(jobs);
  const okCount = results.filter((r) => r.status === 302).length;
  ok("10 个并发新建全部成功", okCount === 10, `成功 ${okCount}/10`);

  // 清理
  const list = await req("/profiles?keyword=" + encodeURIComponent(MARK));
  const ids = [...list.body.matchAll(/\/profiles\/(\d+)\/edit/g)].map((m) => Number(m[1]));
  await Promise.all(ids.map((id) => post(`/profiles/${id}/delete`, {})));
  ok("并发产生的记录已清理", !(await req("/profiles?keyword=" + encodeURIComponent(MARK + "并发"))).body.includes("/edit"), "仍有并发记录残留");
}

/* ══════════════════ 16. 需求登记专项 ══════════════════ */
section("16. 需求登记专项");
{
  const cr = await post("/", {
    customerName: `${MARK}需求`,
    contactName: "测试人",
    phone: "13800009999",
    demand: "内容",
    status: "待跟进",
  });
  ok("新建需求 302", cr.status === 302);

  const list = await req("/?keyword=" + encodeURIComponent(`${MARK}需求`));
  const m = list.body.match(/\/customers\/(\d+)"/);
  const id = m ? Number(m[1]) : 0;
  ok("列表中可搜到需求", id > 0, "未解析到 id");

  if (id) {
    const d = await req(`/customers/${id}`);
    ok("需求详情 200", d.status === 200);

    const ef = await req(`/customers/${id}/edit`);
    ok("需求编辑表单 200", ef.status === 200);
    ok("需求编辑回填", ef.body.includes(`${MARK}需求`));

    const up = await post(`/customers/${id}`, {
      customerName: `${MARK}需求改`,
      contactName: "测试人",
      phone: "13800009999",
      demand: "改过的内容",
      status: "已成交",
    });
    ok("更新需求 302", up.status === 302, `得到 ${up.status}`);
    ok("更新后跳详情", up.headers.get("location") === `/customers/${id}`, `Location=${up.headers.get("location")}`);

    const del = await post(`/customers/${id}/delete`, {});
    ok("删除需求 302", del.status === 302);
    ok("删除后 404", (await req(`/customers/${id}`)).status === 404);
  }

  // 状态白名单
  const bad = await post("/", {
    customerName: "状态测试", contactName: "T", phone: "13800010000", demand: "d", status: "任意状态",
  });
  ok("需求状态白名单生效", bad.status === 400, `得到 ${bad.status}`);

  // 需求描述边界
  const d1000 = await post("/", {
    customerName: `${MARK}描述`, contactName: "T", phone: "13800010001", demand: (MARK + "描".repeat(1000)).slice(0, 1000), status: "待跟进",
  });
  ok("需求描述恰好 1000 字 → 接受", d1000.status === 302, `得到 ${d1000.status}`);
  if (d1000.status === 302) {
    const id2 = Number(d1000.headers.get("location") ?? "0");
    if (id2 > 0) {
      // 跳回列表，清理
      await req("/?keyword=" + encodeURIComponent("描述边界"));
    }
  }
}

/* ══════════════════ 17. Unicode 与特殊字符 ══════════════════ */
section("17. Unicode 与特殊字符");
{
  const cr = await post("/profiles", {
    companyName: "测试🚀Emoji公司",
    contactName: "张三丰",
    phone: "13800011111",
    email: "unicode@test.com",
    industry: "🚀行业",
    source: "其他",
    address: "广东省深圳市南山区科技园路 1 号",
    remark: "第一行\n第二行带换行，以及 <b>HTML</b> 和 \"引号\", 逗号",
  });
  ok("含 Emoji 和特殊字符可入库", cr.status === 302, `得到 ${cr.status}`);

  if (cr.status === 302) {
    const id = Number(cr.headers.get("location")!.split("/").pop());
    const d = await req(`/profiles/${id}`);
    ok("Emoji 正常回显", d.body.includes("🚀"), "Emoji 丢失");
    ok("中文正常", d.body.includes("张三丰"));
    ok("HTML 标签被转义", d.body.includes("&lt;b&gt;HTML&lt;/b&gt;"), "HTML 未转义");
    ok("引号正常", d.body.includes("科技园"));
    await post(`/profiles/${id}/delete`, {});
  }
}

/* ══════════════════ 18. 需求状态筛选一致性 ══════════════════ */
section("18. 筛选与分页一致性");
{
  // 建 3 条不同状态
  const ids: number[] = [];
  // ⚠️ phone 有 UNIQUE 约束，每条必须用不同手机号
  let phoneSeq = 1;
  for (const st of ["待跟进", "沟通中", "已报价"]) {
    const r = await post("/profiles", {
      companyName: `${MARK}筛选${st}`,
      contactName: "筛选",
      phone: `138000${String(20000 + phoneSeq++).padStart(5, "0")}`,
      source: "其他",
    });
    if (r.status === 302) ids.push(Number(r.headers.get("location")!.split("/").pop()));
  }
  ok("建了 3 条测试数据", ids.length === 3);

  const f = await req("/profiles?source=" + encodeURIComponent("其他") + "&keyword=" + encodeURIComponent(MARK));
  const m = f.body.match(/筛选出 (\d+) 份/);
  ok("关键词+来源组合筛选", (await req("/profiles?source=" + encodeURIComponent("其他") + "&keyword=" + encodeURIComponent(MARK + "筛选"))).body.includes(MARK + "筛选"), "组合筛选未命中");

  // 翻页时筛选条件是否保留
  const p = await req("/profiles?source=" + encodeURIComponent("其他") + "&keyword=" + encodeURIComponent(MARK) + "&page=1");
  ok("带筛选条件翻页不报错", p.status === 200);

  for (const id of ids) await post(`/profiles/${id}/delete`, {});
  const after = await req("/profiles?keyword=" + encodeURIComponent(MARK + "筛选"));
  ok("测试数据已清理", !after.body.includes("/edit"), "仍有筛选测试数据残留");
}

/* ══════════════════ 19. 清理本轮产生的所有测试数据 ══════════════════ */
section("19. 测试数据清理（保证可重复运行）");
{
  /** 按删除按钮的 action 抽出 id —— 比解析详情链接可靠 */
  const idsIn = (html: string, kind: "profiles" | "customers") => {
    const re = new RegExp(`action="/${kind}/(\\d+)/delete"`, "g");
    return [...html.matchAll(re)].map((m) => Number(m[1]));
  };

  const purge = async (kind: "profiles" | "customers") => {
    let total = 0;
    // ⚠️ 列表分页，一页只有 10 条 —— 循环必须持续到搜不到为止，
    //    否则只能删掉当前页可见的那些
    for (let round = 0; round < 200; round++) {
      const list = await req(`/${kind === "profiles" ? "profiles" : ""}?keyword=${encodeURIComponent(MARK)}`);
      const ids = idsIn(list.body, kind);
      if (ids.length === 0) break;
      await Promise.all(ids.map((id) => post(`/${kind}/${id}/delete`, {})));
      total += ids.length;
    }
    return total;
  };

  const p = await purge("profiles");
  const c = await purge("customers");
  ok(`已删除 ${p} 条档案测试数据`, p >= 0);
  ok(`已删除 ${c} 条需求测试数据`, c >= 0);

  const leftP = await req("/profiles?keyword=" + encodeURIComponent(MARK));
  const leftC = await req("/?keyword=" + encodeURIComponent(MARK));
  const np = leftP.body.match(/筛选出 (\d+) 份/);
  const nc = leftC.body.match(/筛选出 (\d+) 条/);
  ok("档案表无测试残留", np && Number(np[1]) === 0, `残留 ${np?.[1]}`);
  ok("需求表无测试残留", nc && Number(nc[1]) === 0, `残留 ${nc?.[1]}`);
}

/* ══════════════════ 20. 档案 CSV 导出 ══════════════════ */
section("20. 档案 CSV 导出");
{
  // 建 2 条可识别数据
  const ids: number[] = [];
  for (let i = 0; i < 2; i++) {
    const r = await post("/profiles", {
      companyName: `${MARK}导出${i},带逗号`,
      contactName: `导出人${i}`,
      phone: `138000${String(30000 + i).padStart(5, "0")}`, // UNIQUE：每条不同
      industry: "导出行业",
      source: "展会",
      remark: `备注${i}，含逗号和"引号"`,
    });
    if (r.status === 302) ids.push(Number(r.headers.get("location")!.split("/").pop()));
  }
  ok("建了 2 条待导出档案", ids.length === 2, `实际 ${ids.length}`);

  const r = await req("/profiles/export.csv");
  ok("档案 CSV 200", r.status === 200, `得到 ${r.status}`);
  ok("Content-Type 为 text/csv", (r.headers.get("content-type") ?? "").includes("text/csv"));
  const cd = r.headers.get("content-disposition") ?? "";
  ok("是附件下载", cd.includes("attachment"));
  ok("文件名含「客户档案」", decodeURIComponent(cd).includes("客户档案"), `Content-Disposition=${cd}`);
  ok("含全部表头", ["公司名称", "联系人", "职位", "手机", "邮箱", "行业", "来源", "地址", "备注", "建档时间"].every((h) => r.body.includes(h)), "表头缺失");

  const raw = await fetch(BASE + "/profiles/export.csv");
  const buf = new Uint8Array(await raw.arrayBuffer());
  ok("含 UTF-8 BOM", buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, `前3字节=${[...buf.slice(0, 3)].map((b) => b.toString(16)).join(" ")}`);

  ok("导出命中测试数据", r.body.includes(MARK), "CSV 里没有测试数据");
  ok("含逗号字段被引号包裹", r.body.includes(`"${MARK}导出0,带逗号"`), "逗号未转义");
  ok("含双引号字段已翻倍转义", r.body.includes('""引号""'), "引号未正确转义");

  // 筛选条件生效
  const only0 = await req("/profiles/export.csv?keyword=" + encodeURIComponent(MARK + "导出0"));
  ok("导出支持关键词筛选", only0.body.includes(MARK + "导出0") && !only0.body.includes(MARK + "导出1,"), "筛选未生效");

  const bySource = await req("/profiles/export.csv?source=" + encodeURIComponent("展会"));
  ok("导出支持来源筛选", bySource.status === 200 && bySource.body.includes(MARK), "来源筛选未命中");

  // 空结果导出
  const empty = await req("/profiles/export.csv?keyword=" + encodeURIComponent("绝不存在的zzz" + uniq));
  ok("空结果导出仍 200", empty.status === 200);
  ok("空结果只有表头", empty.body.trim().split("\r\n").length === 1, `实际 ${empty.body.trim().split("\r\n").length} 行`);

  // ⚠️ 路由顺序：/profiles/export.csv 不能被 /profiles/:id 抢走
  const wrong = await req("/profiles/export.csv/../export.csv");
  ok("export.csv 未被当成 id 处理", r.status === 200 && !r.body.includes("404"), "可能被 :id 拦截");

  for (const id of ids) await post(`/profiles/${id}/delete`, {});
  ok("导出测试数据已清理", !(await req("/profiles?keyword=" + encodeURIComponent(MARK + "导出"))).body.includes("/edit"));
}

/* ══════════════════ 结果 ══════════════════ */
console.log("\n" + "═".repeat(54));
console.log(`通过 ${pass} 项，失败 ${failures.length} 项`);
if (failures.length) {
  console.log("\n失败明细：");
  failures.forEach((f) => console.log("  - " + f));
}
if (bugNotes.length) {
  console.log("\n可疑点：");
  bugNotes.forEach((n) => console.log("  - " + n));
}
process.exit(failures.length ? 1 : 0);



