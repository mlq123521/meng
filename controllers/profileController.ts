import type { Request, Response } from "express";
import {
  getProfileList,
  getProfilesForExport,
  getProfileById,
  createProfile,
  updateProfile,
  deleteProfile,
  deleteProfilesByIds,
  importProfiles,
  getProfilesByIds,
  PAGE_SIZE,
  type ProfileRow,
} from "../models/profile";
import { SOURCES } from "../db/schema";
import { validateProfile, type ProfileInput } from "../utils/validate";
import { toCsv, csvHeaders } from "../utils/csv";
import { parseCsv, normalizeHeader } from "../utils/csvParser";

/** 单次导入最大行数 */
const MAX_ROWS = 500;

/** 表头别名：允许用户用「公司名」「公司名称」「company」等写法 */
const HEADER_ALIASES: Record<string, string> = {
  公司名: "companyName",
  公司名称: "companyName",
  客户名: "companyName",
  客户名称: "companyName",
  companyname: "companyName",

  联系人: "contactName",
  对接人: "contactName",
  contactname: "contactName",

  职位: "position",
  岗位: "position",
  position: "position",

  手机: "phone",
  手机号: "phone",
  电话: "phone",
  手机号码: "phone",
  phone: "phone",
  mobile: "phone",

  邮箱: "email",
  电子邮箱: "email",
  email: "email",

  行业: "industry",
  所属行业: "industry",
  industry: "industry",

  来源: "source",
  来源渠道: "source",
  客户来源: "source",
  source: "source",

  地址: "address",
  通讯地址: "address",
  地址地址: "address",
  address: "address",

  备注: "remark",
  备注信息: "remark",
  remark: "remark",
};

/** 建档表单初始值 */
const blank = (): ProfileInput => ({
  companyName: "",
  contactName: "",
  position: "",
  phone: "",
  email: "",
  industry: "",
  source: SOURCES[0],
  address: "",
  remark: "",
});

/** 从 req.body 提取并清洗（超长直接截断，避免撑内存） */
function readForm(body: unknown): ProfileInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  return {
    companyName: clip(b.companyName, 200),
    contactName: clip(b.contactName, 200),
    position: clip(b.position, 200),
    phone: clip(b.phone, 200),
    email: clip(b.email, 300),
    industry: clip(b.industry, 200),
    source: String(b.source ?? SOURCES[0]).slice(0, 20),
    address: clip(b.address, 500),
    remark: clip(b.remark, 1000),
  };
}

/** id → 正整数，非法返回 null */
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** 表单数据 → 数据库行（空字符串转 NULL，让 IS NULL 约束生效） */
function toRow(values: ProfileInput) {
  return {
    ...values,
    position: values.position || null,
    email: values.email || null,
    industry: values.industry || null,
    address: values.address || null,
    remark: values.remark || null,
  };
}

function formData() {
  return { sources: SOURCES };
}

/** 构造带筛选条件的链接 */
function link(base: string, page: number, q: { keyword: string; source: string; industry: string }): string {
  const p = new URLSearchParams();
  if (q.keyword) p.set("keyword", q.keyword);
  if (q.source) p.set("source", q.source);
  if (q.industry) p.set("industry", q.industry);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}

/* ────────────────────────── 档案列表 ────────────────────────── */

export async function list(req: Request, res: Response): Promise<void> {
  const query = {
    keyword: String(req.query.keyword ?? ""),
    source: String(req.query.source ?? ""),
    industry: String(req.query.industry ?? ""),
  };

  const data = await getProfileList({ ...query, page: Number(req.query.page) || 1, pageSize: PAGE_SIZE });

  const pages: number[] = [];
  for (let p = 1; p <= data.totalPages; p++) pages.push(p);

  res.render("profileList", {
    ...data,
    pages,
    prevLink: data.page > 1 ? link("/profiles", data.page - 1, query) : null,
    nextLink: data.page < data.totalPages ? link("/profiles", data.page + 1, query) : null,
    exportLink: link("/profiles/export.csv", 1, query),
  });
}

/* ────────────────────────── 导出 CSV ────────────────────────── */

export async function exportCsv(req: Request, res: Response): Promise<void> {
  const rows = await getProfilesForExport({
    keyword: String(req.query.keyword ?? ""),
    source: String(req.query.source ?? ""),
    industry: String(req.query.industry ?? ""),
  });

  const table: unknown[][] = [
    ["编号", "公司名称", "联系人", "职位", "手机", "邮箱", "行业", "来源", "地址", "备注", "建档时间"],
    ...rows.map((p) => [
      p.id,
      p.companyName,
      p.contactName,
      p.position,
      p.phone,
      p.email,
      p.industry,
      p.source,
      p.address,
      p.remark,
      p.createdAt.toISOString().slice(0, 19).replace("T", " "),
    ]),
  ];

  const filename = `客户档案_${new Date().toISOString().slice(0, 10)}.csv`;
  const body = "﻿" + toCsv(table);

  res.set(csvHeaders(filename));
  res.send(body);
}

/* ══════════════════════ 批量导入 ══════════════════════ */

/** 导入页需要的模板信息 */
const TEMPLATE_HEADERS = [
  "公司名称", "联系人", "职位", "手机", "邮箱", "行业", "来源", "地址", "备注",
];

/** 下载 CSV 模板（含表头 + 两行示例） */
export function downloadTemplate(_req: Request, res: Response): void {
  const sample = [
    TEMPLATE_HEADERS,
    ["杭州云启科技有限公司", "王经理", "技术总监", "13800138000", "wang@example.com", "互联网", "转介绍", "杭州市西湖区文一西路 100 号", "由老客户引荐"],
    ["上海鼎新商贸有限公司", "李总", "总经理", "13900139000", "", "商贸零售", "官网咨询", "上海市浦东新区世纪大道 1 号", ""],
  ];
  // 末尾补一个空单元格，让用户在最后一行末尾也能填内容
  const body = "﻿" + toCsv(sample);
  res.set(csvHeaders("客户档案导入模板.csv"));
  res.send(body);
}

/** 导入页 */
export function importPage(_req: Request, res: Response): void {
  res.render("profileImport", {
    maxRows: MAX_ROWS,
    sources: SOURCES,
    templateHeaders: TEMPLATE_HEADERS,
    error: null,
    report: null,
  });
}

/** 把一行单元格映射成 ProfileInput */
function rowToInput(cells: string[], colIndex: Map<string, number>): ProfileInput {
  const get = (key: string) => {
    const i = colIndex.get(key);
    return i === undefined ? "" : (cells[i] ?? "");
  };
  return {
    companyName: get("companyName"),
    contactName: get("contactName"),
    position: get("position"),
    phone: get("phone"),
    email: get("email"),
    industry: get("industry"),
    source: get("source") || SOURCES[0],
    address: get("address"),
    remark: get("remark"),
  };
}

/**
 * 解析并校验上传的 CSV
 * @returns 合法行 + 错误行报告
 */
function parseAndValidate(text: string) {
  const rows = parseCsv(text);

  if (rows.length === 0) {
    return { error: "文件是空的，或没有任何有效数据行", valid: [], failed: [] as { line: number; reason: string; data: string }[] };
  }

  const header = rows[0].map(normalizeHeader);
  const colIndex = new Map<string, number>();
  header.forEach((h, i) => {
    const key = HEADER_ALIASES[h];
    if (key && !colIndex.has(key)) colIndex.set(key, i);
  });

  // 必填列
  const missing = ["companyName", "contactName", "phone"].filter((k) => !colIndex.has(k));
  if (missing.length) {
    const label: Record<string, string> = { companyName: "公司名称", contactName: "联系人", phone: "手机" };
    return {
      error: `缺少必需的列：${missing.map((m) => label[m]).join("、")}。请下载模板后按表头填写。`,
      valid: [] as ProfileRow[],
      failed: [] as { line: number; reason: string; data: string }[],
    };
  }

  const dataRows = rows.slice(1);

  if (dataRows.length === 0) {
    return { error: "只有表头，没有数据行", valid: [], failed: [] };
  }
  if (dataRows.length > MAX_ROWS) {
    // 注意：这是在写库之前就拦下的，本次导入不会写入任何数据
    return {
      error: `共 ${dataRows.length} 行，超过单次上限 ${MAX_ROWS} 行。本次未导入任何数据，请拆分成多个文件分批导入。`,
      valid: [],
      failed: [],
    };
  }

  const valid: ProfileRow[] = [];
  const failed: { line: number; reason: string; data: string }[] = [];
  const seenPhones = new Map<string, number>();

  dataRows.forEach((cells, idx) => {
    const line = idx + 2; // 1 是表头
    const input = rowToInput(cells, colIndex);

    const { ok, message } = validateProfile(input);
    if (!ok) {
      failed.push({ line, reason: message, data: `${input.companyName || "(空)"} / ${input.contactName || "(空)"} / ${input.phone || "(空)"}` });
      return;
    }

    // 文件内部重复：同一手机号出现多次
    if (seenPhones.has(input.phone)) {
      failed.push({ line, reason: `手机号与第 ${seenPhones.get(input.phone)} 行重复`, data: `${input.companyName} / ${input.phone}` });
      return;
    }
    seenPhones.set(input.phone, line);

    const row = toRow(input) as ProfileRow;
    valid.push(row);
  });

  return { error: null, valid, failed };
}

/** POST /profiles/import —— 执行导入 */
export async function importCsv(req: Request, res: Response): Promise<void> {
  const file = (req as any).file;

  if (!file) {
    res.status(400).render("profileImport", {
      maxRows: MAX_ROWS, sources: SOURCES, templateHeaders: TEMPLATE_HEADERS,
      error: "请选择一个 CSV 文件", report: null,
    });
    return;
  }

  const originalName = String(file.originalname ?? "");
  if (!/\.csv$/i.test(originalName)) {
    res.status(400).render("profileImport", {
      maxRows: MAX_ROWS, sources: SOURCES, templateHeaders: TEMPLATE_HEADERS,
      error: `只支持 .csv 文件，收到的是「${originalName}」`, report: null,
    });
    return;
  }

  const buffer: Buffer = file.buffer;
  // UTF-8 下 500 行中文 CSV 约 150KB，留足余量
  if (buffer.length > 2 * 1024 * 1024) {
    res.status(413).render("profileImport", {
      maxRows: MAX_ROWS, sources: SOURCES, templateHeaders: TEMPLATE_HEADERS,
      error: "文件超过 2MB，请拆分后再导入", report: null,
    });
    return;
  }

  const text = buffer.toString("utf8");
  const { error, valid, failed } = parseAndValidate(text);

  if (error) {
    res.status(400).render("profileImport", {
      maxRows: MAX_ROWS, sources: SOURCES, templateHeaders: TEMPLATE_HEADERS,
      error, report: null,
    });
    return;
  }

  if (valid.length === 0) {
    res.status(400).render("profileImport", {
      maxRows: MAX_ROWS, sources: SOURCES, templateHeaders: TEMPLATE_HEADERS,
      error: "没有任何一行通过校验",
      report: { total: failed.length, insertedCount: 0, updatedCount: 0, failed, rollbackToken: null },
    });
    return;
  }

  const { inserted, updated, backup } = await importProfiles(valid);

  res.render("profileImportResult", {
    fileName: originalName,
    total: valid.length + failed.length,
    inserted,
    updated,
    failed,
    // 回滚用：新建记录记 id，被更新的记录用【更新前】的原始值
    rollbackToken: JSON.stringify({
      insertedIds: inserted.map((r) => r.id),
      backup,
    }),
  });
}

/** POST /profiles/import/rollback —— 撤销本次导入 */
export async function rollbackImport(req: Request, res: Response): Promise<void> {
  const token = String(req.body.token ?? "");
  if (!token) {
    res.status(400).render("profileImport", {
      maxRows: MAX_ROWS, sources: SOURCES, templateHeaders: TEMPLATE_HEADERS,
      error: "缺少回滚数据", report: null,
    });
    return;
  }

  let parsed: { insertedIds: number[]; backup: any[] };
  try {
    parsed = JSON.parse(token);
  } catch {
    res.status(400).render("profileImport", {
      maxRows: MAX_ROWS, sources: SOURCES, templateHeaders: TEMPLATE_HEADERS,
      error: "回滚数据已损坏，无法撤销", report: null,
    });
    return;
  }

  const ids = Array.isArray(parsed.insertedIds) ? parsed.insertedIds : [];
  const backups = Array.isArray(parsed.backup) ? parsed.backup : [];

  // 先还原被更新的记录
  // ⚠️ 必须把 NULL 原样传回去，不能转成空字符串 ——
  //    空字符串会撞上「邮箱格式 / 非空长度」这些 CHECK 约束
  for (const b of backups) {
    if (!b?.id) continue;
    await updateProfile(Number(b.id), {
      companyName: String(b.companyName ?? ""),
      contactName: String(b.contactName ?? ""),
      position: b.position ?? null,
      phone: String(b.phone ?? ""),
      email: b.email ?? null,
      industry: b.industry ?? null,
      source: String(b.source ?? SOURCES[0]),
      address: b.address ?? null,
      remark: b.remark ?? null,
    });
  }

  // 再删除新建的记录
  const removed = await deleteProfilesByIds(ids.map(Number).filter(Number.isInteger));

  res.render("profileImport", {
    maxRows: MAX_ROWS, sources: SOURCES, templateHeaders: TEMPLATE_HEADERS,
    error: null,
    report: {
      total: backups.length + removed,
      insertedCount: 0, updatedCount: 0, failed: [],
      rollbackToken: null,
      rolledBack: { removed, restored: backups.length },
    },
  });
}

/* ────────────────────────── 建档 ────────────────────────── */

export function form(_req: Request, res: Response): void {
  res.render("profileForm", {
    ...formData(),
    title: "新建客户档案",
    action: "/profiles",
    submitText: "保存档案",
    error: null,
    values: blank(),
  });
}

export async function create(req: Request, res: Response): Promise<void> {
  const values = readForm(req.body);
  const { ok, message } = validateProfile(values);

  if (!ok) {
    res.status(400).render("profileForm", {
      ...formData(),
      title: "新建客户档案",
      action: "/profiles",
      submitText: "保存档案",
      error: message,
      values,
    });
    return;
  }

  const created = await createProfile(toRow(values));
  res.redirect(`/profiles/${created.id}`);
}

/* ────────────────────────── 档案详情 ────────────────────────── */

export async function detail(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  const profile = id === null ? undefined : await getProfileById(id);

  if (!profile) {
    res.status(404).render("customerNotFound", { id: req.params.id });
    return;
  }
  res.render("profileDetail", { profile });
}

/* ────────────────────────── 编辑 ────────────────────────── */

export async function editForm(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  const profile = id === null ? undefined : await getProfileById(id);

  if (!profile) {
    res.status(404).render("customerNotFound", { id: req.params.id });
    return;
  }

  res.render("profileForm", {
    ...formData(),
    title: `编辑档案 #${id}`,
    action: `/profiles/${id}`,
    submitText: "保存修改",
    error: null,
    values: profile,
  });
}

export async function update(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);

  if (id === null) {
    res.status(404).render("customerNotFound", { id: req.params.id });
    return;
  }

  const existing = await getProfileById(id);
  if (!existing) {
    res.status(404).render("customerNotFound", { id: req.params.id });
    return;
  }

  const values = readForm(req.body);
  const { ok, message } = validateProfile(values);

  if (!ok) {
    res.status(400).render("profileForm", {
      ...formData(),
      title: `编辑档案 #${id}`,
      action: `/profiles/${id}`,
      submitText: "保存修改",
      error: message,
      values: { ...existing, ...values, id },
    });
    return;
  }

  const updated = await updateProfile(id, toRow(values));
  if (!updated) {
    res.status(404).render("customerNotFound", { id: req.params.id });
    return;
  }
  res.redirect(`/profiles/${id}`);
}

/* ────────────────────────── 删除 ────────────────────────── */

export async function remove(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);

  if (id === null) {
    res.status(404).render("customerNotFound", { id: req.params.id });
    return;
  }

  const deleted = await deleteProfile(id);
  if (!deleted) {
    res.status(404).render("customerNotFound", { id: req.params.id });
    return;
  }
  res.redirect("/profiles");
}