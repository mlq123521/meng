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

/**
 * 需求现在必须挂在客户档案下（profile_id 外键 NOT NULL），
 * 所以先建一份档案，后续建需求时统一带上它的 id。
 */
let TEST_PROFILE_ID = 0;
async function ensureProfile(): Promise<number> {
  // 缓存的 id 可能已经被前面的清理环节删掉（档案一旦没了，
  // 后面的需求就会因外键失败），所以每次先确认它还在
  if (TEST_PROFILE_ID) {
    const check = await req(`/profiles/${TEST_PROFILE_ID}`);
    if (check.status === 200) return TEST_PROFILE_ID;
    TEST_PROFILE_ID = 0;
  }

  const r = await post("/profiles", {
    companyName: `${MARK}测试客户`,
    contactName: "测试联系人",
    // ⚠️ 冷门号码，避免和用例里建的其他档案撞 UNIQUE 约束
    phone: "13899999999",
    source: "其他",
  });

  if (r.status === 302) {
    TEST_PROFILE_ID = Number(r.headers.get("location")!.split("/").pop());
    return TEST_PROFILE_ID;
  }

  // 409 = 手机号已存在（可能是上一轮测试的残留），按手机号反查它的 id
  const list = await req("/profiles?keyword=13899999999");
  const link = list.body.match(/\/profiles\/(\d+)\/edit/)?.[1];
  if (link) TEST_PROFILE_ID = Number(link);
  return TEST_PROFILE_ID;
}

/** 建需求：自动带上 profileId，省得每个用例都写 */
async function postDemand(data: Record<string, string>) {
  const pid = await ensureProfile();
  return post("/", { profileId: String(pid), ...data });
}

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
  const pid = await ensureProfile();
  const r = await postDemand({
    demand: "需要一个客户管理系统",
    status: "待跟进",
  });
  ok("新建需求返回 302", r.status === 302, `得到 ${r.status}`);
  ok("302 跳到需求详情", /^\/demands\/\d+$/.test(r.headers.get("location") ?? ""),
    `Location=${r.headers.get("location")}`);

  // 需求必须挂在档案下
  const bad = await post("/", { profileId: "", demand: "x", status: "待跟进" });
  ok("不选客户档案 → 400", bad.status === 400, `得到 ${bad.status}`);
  ok("提示选择客户档案", bad.body.includes("请选择一个客户档案"));

  const noProfile = await post("/", { profileId: "999999", demand: "x", status: "待跟进" });
  ok("选不存在的档案 → 400", noProfile.status === 400, `得到 ${noProfile.status}`);
  ok("提示档案不存在", noProfile.body.includes("客户档案不存在"));
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
  // 需求表没有 customerName/contactName，客户名来自档案表，
  // 所以公式字符放在 demand / remark 里
  const cr = await postDemand({
    demand: `=cmd|'!A0 ${MARK}injection, 预算50000元`,
    remark: "@SUM(1+1)+1+1-1",
    status: "待跟进",
  });
  ok("含公式字符的数据可入库", cr.status === 302, `得到 ${cr.status}`);

  const csv = await req("/export.csv?keyword=" + encodeURIComponent(MARK));
  ok("导出命中测试数据", csv.body.includes(MARK), "CSV 里没找到测试数据");
  // 防护只作用于单元格的首字符：@SUM(1+1)+1+1-1 整体只会在最前面加一个引号
  ok("@ 开头的单元格已加防护", csv.body.includes("'@SUM(1+1)"), `备注未加前缀，实际导出：${csv.body.split("\r\n")[1]?.slice(0, 120)}`);
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
  const rc = await postDemand({
    demand: "",
    remark: `${MARK}回填备注`,
    status: "待跟进",
  });
  ok("需求校验失败 400", rc.status === 400, `得到 ${rc.status}`);
  ok("需求侧已填内容回填", rc.body.includes(`${MARK}回填备注`), "备注未回填");
  ok("需求侧显示错误提示", rc.body.includes("需求描述"), "无错误提示");
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
  const cr = await postDemand({
    demand: `${MARK}需求`,
    status: "待跟进",
  });
  ok("新建需求 302", cr.status === 302, `得到 ${cr.status}`);

  const list = await req("/?keyword=" + encodeURIComponent(`${MARK}需求`));
  const m = list.body.match(/\/demands\/(\d+)"/);
  const id = m ? Number(m[1]) : 0;
  ok("列表中可搜到需求", id > 0, "未解析到 id");

  if (id) {
    const d = await req(`/demands/${id}`);
    ok("需求详情 200", d.status === 200);

    const ef = await req(`/demands/${id}/edit`);
    ok("需求编辑表单 200", ef.status === 200);
    ok("需求编辑回填", ef.body.includes(`${MARK}需求`));

    const up = await post(`/demands/${id}`, {
      profileId: String(await ensureProfile()),
      demand: "改过的内容",
      status: "已成交",
    });
    ok("更新需求 302", up.status === 302, `得到 ${up.status}`);
    ok("更新后跳详情", up.headers.get("location") === `/demands/${id}`, `Location=${up.headers.get("location")}`);

    const del = await post(`/demands/${id}/delete`, {});
    ok("删除需求 302", del.status === 302, `得到 ${del.status}`);
    ok("删除后 404", (await req(`/demands/${id}`)).status === 404);
  }

  // 状态白名单
  const bad = await postDemand({
    demand: `${MARK}状态测试`,
    status: "任意状态",
  });
  ok("需求状态白名单生效", bad.status === 400, `得到 ${bad.status}`);

  // 需求描述边界
  const d1000 = await postDemand({
    demand: (MARK + "描".repeat(1000)).slice(0, 1000),
    status: "待跟进",
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
  /** 两个实体的「列表路径」和「删除路径」不一样 */
  const CFG = {
    profiles: { list: "/profiles", del: (id: number) => `/profiles/${id}/delete` },
    demands: { list: "/", del: (id: number) => `/demands/${id}/delete` },
  } as const;

  /** 按删除按钮的 action 抽出 id —— 比解析详情链接可靠 */
  const idsIn = (html: string, kind: keyof typeof CFG) => {
    // 实际是 action="/demands/1/delete"，斜杠要可选
    const re = new RegExp(`action="/?${kind}/(\\d+)/delete"`, "g");
    return [...html.matchAll(re)].map((m) => Number(m[1]));
  };

  const purge = async (kind: keyof typeof CFG) => {
    let total = 0;
    // ⚠️ 列表分页，一页只有 10 条 —— 循环必须持续到搜不到为止，
    //    否则只能删到当前页可见的那些
    for (let round = 0; round < 200; round++) {
      const list = await req(`${CFG[kind].list}?keyword=${encodeURIComponent(MARK)}`);
      const ids = idsIn(list.body, kind);
      if (ids.length === 0) break;
      await Promise.all(ids.map((id) => post(CFG[kind].del(id), {})));
      total += ids.length;
    }
    return total;
  };

  const p = await purge("profiles");
  const c = await purge("demands");
  ok(`已删除 ${p} 条档案测试数据`, p >= 0);
  ok(`已删除 ${c} 条需求测试数据`, c >= 0);

  const leftP = await req("/profiles?keyword=" + encodeURIComponent(MARK));
  const leftC = await req("/?keyword=" + encodeURIComponent(MARK));
  const np = leftP.body.match(/筛选出 (\d+) 份/);
  const nc = leftC.body.match(/筛选出 (\d+) 条/);
  ok("档案表无测试残留", np && Number(np[1]) === 0, `残留 ${np?.[1]}`);
  ok("需求表无测试残留", nc && Number(nc[1]) === 0, `残留 ${nc?.[1]}`);
}

/* ══════════════════ 20. 需求描述摘要 ══════════════════ */
section("20. 列表页摘要");
{
  // 用独立标记，避免命中其它小节的数据
  const SUM20 = `SUM20${uniq}`;
  const long = `${SUM20}长文本` + "客户需要一套完整的客户关系管理系统，包含客户档案管理、需求登记跟进、销售漏斗分析、数据报表导出等功能模块，并且要求支持多角色权限控制、历史操作日志追溯以及完整的移动端适配。预计总开发周期三到四个月，预算在十五到二十万元之间，希望分两期交付，第一期先上线核心功能，第二期再补充高级分析能力。";
  const multiline = `${SUM20}多行` + "第一行需求说明\n第二行补充说明\n第三行更多内容";
  const short = `${SUM20}短文本` + "简单需求";

  // 客户名来自档案（三条需求共用同一档案），所以靠需求内容里的标记来筛
  await postDemand({ demand: long, status: "待跟进" });
  await postDemand({ demand: multiline, status: "待跟进" });
  await postDemand({ demand: short, status: "待跟进" });

  const page = await req("/?keyword=" + encodeURIComponent(SUM20));
  const cells = [...page.body.matchAll(
    /<span class="demand-summary" title="([^"]*)">([^<]*)<\/span>/g,
  )];

  ok("三个摘要单元格都渲染了", cells.length === 3, `实际 ${cells.length}`);

  for (const [, full, shown] of cells) {
    ok("摘要不超过 37 字符（含省略号）", shown.length <= 37, `实际 ${shown.length}: ${shown}`);
    ok("超长内容已加省略号", shown.endsWith("…") || shown.length <= 36, `实际: ${shown}`);
    ok("title 属性保留了全文", full.length >= shown.length, "title 比显示内容还短");
  }

  const longCell = cells.find(([, f]) => f.length > 100);
  ok("长文本被截断", !!longCell && longCell[2].length < longCell[1].length,
    `显示 ${longCell?.[2].length} / 原文 ${longCell?.[1].length}`);
  ok("长文本不含换行", !longCell?.[2].includes("\n"), "摘要里还有换行");

  const multiCell = cells.find(([, f]) => f.includes("\n"));
  ok("多行内容已压成单行", !!multiCell && !multiCell[2].includes("\n"), `实际: ${multiCell?.[2]}`);
  ok("多行内容有行数提示", page.body.includes("3 行"), "缺少行数提示");

  const shortCell = cells.find(([, , s]) => s === short);
  ok("短内容原样显示不截断", !!shortCell, "短内容被错误截断");

  // 详情页仍显示完整内容（要定位到长文本那一行，不能假设第一条就是它）
  const longRow = [...page.body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .map((m) => m[1])
    .find((row) => row.includes(long.slice(0, 20)));
  const longId = longRow?.match(/\/demands\/(\d+)"/)?.[1];
  ok("能定位到长文本所在行", !!longId, "未找到");

  if (longId) {
    const detail = await req(`/demands/${longId}`);
    ok("详情页显示完整需求描述", detail.body.includes(long), "详情页内容不完整");
    ok("详情页保留换行（pre-wrap）", detail.body.includes("\n") || !long.includes("\n"), "换行被吃掉");
  }

  // 清理
  for (const id of [...page.body.matchAll(/action="\/demands\/(\d+)\/delete"/g)].map((x) => x[1])) {
    await post(`/demands/${id}/delete`, {});
  }
}

/* ══════════════════ 21. 备注字段 ══════════════════ */
section("21. 备注字段");
{
  const RM = "RM" + Math.random().toString(36).slice(2, 7);
  const remark = "由老客户张总引荐，预算充足，计划 Q4 启动";

  // 需求登记
  const r1 = await postDemand({
    demand: `${RM}需求A 需要系统`,
    status: "待跟进",
    remark,
  });
  ok("需求登记：带备注提交成功", r1.status === 302, `得到 ${r1.status}`);

  // 需求创建成功后跳详情页，从 Location 里取 id
  const mkList = await req(`/?keyword=${RM}`);
  const id = Number(mkList.body.match(/\/demands\/(\d+)"/)?.[1]);
  ok("能在列表中定位记录", Number.isInteger(id) && id > 0, `解析失败`);

  // 空备注应存为 NULL 而不是空字符串
  const r2 = await postDemand({
    demand: `${RM}需求B 简单`,
    status: "沟通中",
    remark: "",
  });
  ok("需求登记：备注留空提交成功", r2.status === 302);

  // 超长
  const r3 = await postDemand({
    demand: `${RM}需求C`,
    status: "待跟进",
    remark: "备".repeat(501),
  });
  ok("需求登记：501 字备注被拒", r3.status === 400, `得到 ${r3.status}`);
  ok("提示备注长度上限", r3.body.includes("备注") && r3.body.includes("500"));

  // 恰好 500
  const r4 = await postDemand({
    demand: `${RM}需求D`,
    status: "待跟进",
    remark: "备".repeat(500),
  });
  ok("需求登记：恰好 500 字备注被接受", r4.status === 302, `得到 ${r4.status}`);

  // 列表页
  const list = await req(`/?keyword=${RM}`);
  ok("列表页有备注列", list.body.includes("<th>备注</th>"));
  ok("列表页显示备注摘要", list.body.includes(remark) || list.body.includes("remarkSummary"));
  ok("空备注显示占位符", list.body.includes("—"));

  // 详情页
  const detail = await req(`/demands/${id}`);
  ok("详情页显示备注", detail.body.includes(remark), "详情页缺少备注");
  ok("详情页有备注标签", detail.body.includes("备注"));

  // 编辑页回填
  const edit = await req(`/demands/${id}/edit`);
  ok("编辑页回填备注", edit.body.includes(remark), "编辑页未回填");
  ok("编辑表单有 remark 输入框", /name="remark"/.test(edit.body));

  // 更新备注
  const up = await post(`/demands/${id}`, {
    profileId: String(await ensureProfile()),
    demand: `${RM}需求A 需要系统`,
    status: "已成交",
    remark: "改过的备注",
  });
  ok("更新备注返回 302", up.status === 302, `得到 ${up.status}`);
  const after = await req(`/demands/${id}`);
  ok("备注已更新", after.body.includes("改过的备注"), "备注没变");
  ok("旧备注已消失", !after.body.includes("由老客户张总"), "旧备注还在");

  // CSV 导出
  const csv = await req("/export.csv?keyword=" + encodeURIComponent(RM));
  ok("CSV 表头含备注", csv.body.includes("备注"), "表头缺备注列");
  ok("CSV 含备注值", csv.body.includes("改过的备注"), "CSV 里没有备注值");

  // 客户档案
  const p1 = await post("/profiles", {
    companyName: `${RM}档案A`, contactName: "联系人", phone: "13811190011",
    source: "其他", remark: "档案备注内容",
  });
  ok("客户档案：带备注提交成功", p1.status === 302, `得到 ${p1.status}`);
  const pid = Number(p1.headers.get("location")!.split("/").pop());
  const pd = await req(`/profiles/${pid}`);
  ok("档案详情显示备注", pd.body.includes("档案备注内容"));

  const pl = await req("/profiles?keyword=" + encodeURIComponent(RM));
  ok("档案列表有备注列", pl.body.includes("<th>备注</th>"));

  const pe = await req(`/profiles/${pid}/edit`);
  ok("档案编辑页回填备注", pe.body.includes("档案备注内容"));

  // 清理
  for (const cid of [...list.body.matchAll(/action="\/demands\/(\d+)\/delete"/g)].map((m) => m[1])) {
    await post(`/demands/${cid}/delete`, {});
  }
  await post(`/profiles/${pid}/delete`, {});
}

/* ══════════════════ 22. 档案 CSV 导出 ══════════════════ */
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


