#!/usr/bin/env bun
/**
 * 客户管理系统 —— MCP Server
 *
 * 把 models/ 里的数据访问函数暴露成 MCP 工具，让 AI 助手能直接查/改数据库。
 *
 *   bun run mcp/server.ts        （stdio，由 MCP 客户端拉起）
 *
 * 设计要点
 * 1. 直接 import models/，**不经过 shell** —— 中文参数、引号、% 都不会被
 *    PowerShell / cmd.exe 拦下来，也不用拼命令行字符串。
 * 2. 删除类工具一律两段式：先不带 confirm 跑，返回待删清单；确认后再传
 *    confirm=true 才真删。防止模型手滑把库删空。
 * 3. 校验复用 utils/validate.ts，和 Web 端、CLI 走同一套规则。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import * as demandModel from "../models/demand";
import * as profileModel from "../models/profile";
import { STATUSES, SOURCES } from "../db/schema";
import { validateDemand, validateProfile } from "../utils/validate";
import { isForeignKeyViolation, isUniqueViolation } from "../utils/pgError";

const server = new McpServer(
  { name: "crm", version: "1.0.0" },
  {
    capabilities: { tools: {} },
    instructions:
      "客户管理系统（客户档案 + 需求登记）。数据模型：customer_profiles 是主表，" +
      "demands 通过 profile_id 外键挂在它下面（一个客户可有多条需求）。" +
      "登记需求前必须先有客户档案，可用 profile_pick 查询可用的档案 id。" +
      "所有删除类工具都需要先预览、再传 confirm=true 执行。",
  },
);

/* ─────────────────────── 工具结果辅助 ─────────────────────── */

/** 把任意值序列化成 MCP 的 JSON 文本结果 */
function json(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

/** 把校验失败转成「错误结果」而不是抛异常 —— 模型能读到原因并自我修正 */
function fail(message: string, extra: Record<string, unknown> = {}) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: message, ...extra }, null, 2) }],
  };
}

/** 把数据库层的具体错误翻译成人话 */
function explainDbError(err: unknown, ctx: string): string {
  if (isUniqueViolation(err)) return `${ctx}：手机号已存在（该手机号已建过档）`;
  if (isForeignKeyViolation(err)) return `${ctx}：引用的客户档案不存在（profile_id 外键约束）`;
  const msg = err instanceof Error ? err.message : String(err);
  return `${ctx}：${msg.slice(0, 200)}`;
}

/** id 数组归一化：支持 [1,2] 也支持 "1,2" */
const idList = z
  .union([z.array(z.number().int().positive()), z.string()])
  .transform((v) =>
    (Array.isArray(v) ? v : v.split(/[,\s]+/))
      .map((x) => Number(typeof x === "string" ? x.trim() : x))
      .filter((n) => Number.isInteger(n) && n > 0),
  )
  .describe("记录 id，可传数组 [1,2] 或字符串 \"1,2\"");

/* ═══════════════════ 客户档案 profile ═══════════════════ */

/** 新建档案时必填的三个字段 */
const profileRequired = {
  companyName: z.string().describe("公司名称，必填，≤60 字"),
  contactName: z.string().describe("联系人，必填，≤30 字"),
  phone: z.string().describe("手机号，必填，11 位且 1 开头（全局唯一）"),
};

/** 其余选填字段，新建和修改共用 */
const profileOptional = {
  position: z.string().optional().describe("职位，选填"),
  email: z.string().optional().describe("邮箱，选填"),
  industry: z.string().optional().describe("所属行业，选填"),
  source: z.enum(SOURCES).optional().describe(`来源渠道，默认「其他」。可选：${SOURCES.join(" / ")}`),
  address: z.string().optional().describe("地址，选填"),
  remark: z.string().optional().describe("备注，选填，≤500 字"),
};

server.registerTool(
  "profile_list",
  {
    title: "查询客户档案列表",
    description:
      "按关键词/来源/行业筛选客户档案，支持分页。" +
      "关键词同时匹配公司名、联系人、手机、邮箱、职位。",
    inputSchema: {
      keyword: z.string().optional().describe("模糊搜索关键词"),
      source: z.enum(SOURCES).optional().describe("按来源渠道筛选"),
      industry: z.string().optional().describe("按行业筛选"),
      page: z.number().int().positive().optional().describe("页码，从 1 开始，默认 1"),
      pageSize: z.number().int().min(5).max(100).optional().describe("每页条数，5-100，默认 10"),
    },
  },
  async ({ keyword, source, industry, page, pageSize }) => {
    const d = await profileModel.getProfileList({ keyword, source, industry, page, pageSize });
    return json({
      total: d.total,
      page: d.page,
      totalPages: d.totalPages,
      pageSize: d.pageSize,
      profiles: d.list,
    });
  },
);

server.registerTool(
  "profile_get",
  {
    title: "查看客户档案详情",
    description: "按 id 查看一份客户档案的完整信息（含该客户名下的需求列表）。",
    inputSchema: { id: z.number().int().positive().describe("档案 id") },
  },
  async ({ id }) => {
    const p = await profileModel.getProfileById(id);
    if (!p) return fail(`未找到档案 #${id}`);
    const demands = await demandModel.getDemandsByProfile(id);
    return json({ profile: p, demands });
  },
);

server.registerTool(
  "profile_add",
  {
    title: "新建客户档案",
    description:
      "创建一个客户档案。手机号全局唯一，重复会报错。" +
      "建档后拿返回的 id 去登记需求。",
    inputSchema: { ...profileRequired, ...profileOptional },
  },
  async (args) => {
    const input = {
      companyName: args.companyName,
      contactName: args.contactName,
      phone: args.phone,
      position: args.position ?? "",
      email: args.email ?? "",
      industry: args.industry ?? "",
      source: args.source ?? "其他",
      address: args.address ?? "",
      remark: args.remark ?? "",
    };

    const v = validateProfile(input);
    if (!v.ok) return fail(v.message);

    try {
      const created = await profileModel.createProfile({
        ...input,
        position: input.position || null,
        email: input.email || null,
        industry: input.industry || null,
        address: input.address || null,
        remark: input.remark || null,
      });
      return json({ ok: true, message: `已建档 #${created.id}`, profile: created });
    } catch (err) {
      return fail(explainDbError(err, "建档失败"));
    }
  },
);

server.registerTool(
  "profile_update",
  {
    title: "修改客户档案",
    description: "按 id 修改客户档案。只传要改的字段，未传的保持原值。",
    inputSchema: {
      id: z.number().int().positive().describe("档案 id"),
      // 修改时这三个字段也变成可选
      ...z.object(profileRequired).partial().shape,
      ...profileOptional,
    },
  },
  async ({ id, ...patch }) => {
    const existing = await profileModel.getProfileById(id);
    if (!existing) return fail(`未找到档案 #${id}`);

    // 先和现有值合并，再用同一套校验规则整体过一遍
    const merged = {
      companyName: patch.companyName ?? existing.companyName,
      contactName: patch.contactName ?? existing.contactName,
      phone: patch.phone ?? existing.phone,
      position: patch.position ?? existing.position ?? "",
      email: patch.email ?? existing.email ?? "",
      industry: patch.industry ?? existing.industry ?? "",
      source: (patch.source ?? existing.source) as (typeof SOURCES)[number],
      address: patch.address ?? existing.address ?? "",
      remark: patch.remark ?? existing.remark ?? "",
    };

    const v = validateProfile(merged);
    if (!v.ok) return fail(v.message);

    try {
      const updated = await profileModel.updateProfile(id, {
        ...merged,
        position: merged.position || null,
        email: merged.email || null,
        industry: merged.industry || null,
        address: merged.address || null,
        remark: merged.remark || null,
      });
      return json({ ok: true, message: `已更新档案 #${id}`, profile: updated });
    } catch (err) {
      return fail(explainDbError(err, "更新失败"));
    }
  },
);

server.registerTool(
  "profile_delete",
  {
    title: "删除客户档案（需二次确认）",
    description:
      "删除客户档案。⚠️ 注意：其名下的需求会被数据库级联删除，无法恢复。" +
      "【必须两段式调用】第一次不传 confirm，返回待删清单让用户确认；" +
      "用户明确同意后，再传 confirm=true 执行。",
    inputSchema: {
      ids: idList,
      confirm: z.boolean().optional().describe("确认真正执行删除。默认 false，只预览"),
    },
  },
  async ({ ids, confirm }) => {
    if (ids.length === 0) return fail("未提供有效的 id");

    const found = await profileModel.getProfilesByIds(ids);
    if (found.length === 0) return fail(`未找到 id：${ids.join(", ")}`);

    // 预览阶段：把将要发生的事说清楚，包括会被连带删掉的需求
    if (!confirm) {
      const detail = await Promise.all(
        found.map(async (p) => ({
          id: p.id,
          companyName: p.companyName,
          contactName: p.contactName,
          phone: p.phone,
          demandCount: (await demandModel.getDemandsByProfile(p.id)).length,
        })),
      );
      return json({
        ok: false,
        needsConfirm: true,
        message:
          `这是预览，尚未删除。将删除 ${found.length} 份档案及其名下全部需求。` +
          "确认无误后，用相同的 ids 再调用一次并传 confirm=true。",
        targets: detail,
      });
    }

    const deleted = await profileModel.deleteProfiles(found.map((p) => p.id));
    return json({
      ok: true,
      deleted: deleted.length,
      message: `已删除 ${deleted.length} 份档案，其名下需求已级联删除`,
    });
  },
);

server.registerTool(
  "profile_pick",
  {
    title: "查询可用的客户档案（登记需求前用）",
    description:
      "轻量查询：只返回 id、公司名、联系人、手机。登记需求时需要 profile_id，" +
      "但手上没有 id 时先用这个查。",
    inputSchema: {
      keyword: z.string().optional().describe("按公司名/联系人/手机模糊匹配"),
      limit: z.number().int().positive().max(500).optional().describe("最多返回几条，默认 50"),
    },
  },
  async ({ keyword, limit }) => {
    const d = await profileModel.getProfileList({ keyword, pageSize: Math.min(limit ?? 50, 100) });
    return json({
      total: d.total,
      profiles: d.list.map((p) => ({
        id: p.id,
        companyName: p.companyName,
        contactName: p.contactName,
        phone: p.phone,
      })),
    });
  },
);

/* ═══════════════════ 需求登记 demand ═══════════════════ */

server.registerTool(
  "demand_list",
  {
    title: "查询需求列表",
    description:
      "按关键词/状态筛选需求，支持分页。关键词同时匹配客户档案侧" +
      "（公司名、联系人、手机）和需求侧（需求描述、备注）。",
    inputSchema: {
      keyword: z.string().optional().describe("模糊搜索关键词"),
      status: z.enum(STATUSES).optional().describe(`按状态筛选：${STATUSES.join(" / ")}`),
      profileId: z.number().int().positive().optional().describe("只看某个客户的需求"),
      page: z.number().int().positive().optional().describe("页码，从 1 开始，默认 1"),
      pageSize: z.number().int().min(5).max(100).optional().describe("每页条数，5-100，默认 10"),
    },
  },
  async ({ keyword, status, profileId, page, pageSize }) => {
    const d = await demandModel.getDemandList({ keyword, status, profileId, page, pageSize });
    return json({
      total: d.total,
      page: d.page,
      totalPages: d.totalPages,
      pageSize: d.pageSize,
      demands: d.list,
    });
  },
);

server.registerTool(
  "demand_get",
  {
    title: "查看需求详情",
    description: "按 id 查看一条需求的完整信息，含所属客户档案的信息。",
    inputSchema: { id: z.number().int().positive().describe("需求 id") },
  },
  async ({ id }) => {
    const d = await demandModel.getDemandById(id);
    if (!d) return fail(`未找到需求 #${id}`);
    return json(d);
  },
);

server.registerTool(
  "demand_add",
  {
    title: "登记客户需求",
    description:
      "为某个客户档案登记一条需求。⚠️ profileId 必填 —— 需求必须挂在一个已有客户档案下。" +
      "不知道 id 时先用 profile_pick 查。",
    inputSchema: {
      profileId: z.number().int().positive().describe("所属客户档案 id，必填"),
      demand: z.string().describe("需求描述，必填，≤1000 字"),
      status: z.enum(STATUSES).optional().describe(`状态，默认「待跟进」。可选：${STATUSES.join(" / ")}`),
      remark: z.string().optional().describe("备注，选填，≤500 字"),
    },
  },
  async ({ profileId, demand, status, remark }) => {
    const input = { profileId: String(profileId), demand, remark: remark ?? "", status: status ?? STATUSES[0] };

    const v = validateDemand(input);
    if (!v.ok) return fail(v.message);

    try {
      const created = await demandModel.createDemand({
        profileId,
        demand,
        remark: remark ?? "",
        status: input.status,
      });
      return json({ ok: true, message: `已登记需求 #${created.id}`, demand: created });
    } catch (err) {
      return fail(explainDbError(err, "登记失败"));
    }
  },
);

server.registerTool(
  "demand_update",
  {
    title: "修改需求",
    description: "按 id 修改需求。只传要改的字段，未传的保持原值。",
    inputSchema: {
      id: z.number().int().positive().describe("需求 id"),
      profileId: z.number().int().positive().optional().describe("改挂到别的客户档案"),
      demand: z.string().optional().describe("新的需求描述"),
      status: z.enum(STATUSES).optional().describe("新的状态"),
      remark: z.string().optional().describe("新的备注"),
    },
  },
  async ({ id, ...patch }) => {
    const existing = await demandModel.getDemandById(id);
    if (!existing) return fail(`未找到需求 #${id}`);

    const input = {
      profileId: String(patch.profileId ?? existing.profileId),
      demand: patch.demand ?? existing.demand,
      remark: patch.remark ?? existing.remark ?? "",
      status: (patch.status ?? existing.status) as (typeof STATUSES)[number],
    };

    const v = validateDemand(input);
    if (!v.ok) return fail(v.message);

    try {
      const updated = await demandModel.updateDemand(id, {
        profileId: Number(input.profileId),
        demand: input.demand,
        remark: input.remark,
        status: input.status,
      });
      return json({ ok: true, message: `已更新需求 #${id}`, demand: updated });
    } catch (err) {
      return fail(explainDbError(err, "更新失败"));
    }
  },
);

server.registerTool(
  "demand_delete",
  {
    title: "删除需求（需二次确认）",
    description:
      "删除需求记录。【必须两段式调用】第一次不传 confirm，返回待删清单让用户确认；" +
      "用户明确同意后，再传 confirm=true 执行。",
    inputSchema: {
      ids: idList,
      confirm: z.boolean().optional().describe("确认真正执行删除。默认 false，只预览"),
    },
  },
  async ({ ids, confirm }) => {
    if (ids.length === 0) return fail("未提供有效的 id");

    const rows = await Promise.all(ids.map((id) => demandModel.getDemandById(id)));
    const found = rows.filter((d): d is NonNullable<typeof d> => Boolean(d));

    if (found.length === 0) return fail(`未找到 id：${ids.join(", ")}`);

    if (!confirm) {
      return json({
        ok: false,
        needsConfirm: true,
        message:
          `这是预览，尚未删除。将删除 ${found.length} 条需求。` +
          "确认无误后，用相同的 ids 再调用一次并传 confirm=true。",
        targets: found.map((d) => ({
          id: d.id,
          companyName: d.companyName,
          demand: d.demand.length > 60 ? `${d.demand.slice(0, 60)}…` : d.demand,
          status: d.status,
        })),
      });
    }

    const deleted = await demandModel.deleteDemands(found.map((d) => d.id));
    return json({ ok: true, deleted: deleted.length, message: `已删除 ${deleted.length} 条需求` });
  },
);

/* ─────────────────────── 启动 ─────────────────────── */

// ⚠️ stdout 是 MCP 的传输通道，任何 console.log 都会污染协议帧。
//    要打日志一律走 stderr。
console.error(
  `[crm] MCP server 启动，库：${process.env.DATABASE_URL?.replace(/:[^:@/]*@/, ":***@")}`,
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[crm] 已连接 stdio，等待工具调用");