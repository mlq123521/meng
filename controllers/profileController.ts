import type { Request, Response } from "express";
import {
  getProfileList,
  getProfilesForExport,
  getProfileById,
  createProfile,
  updateProfile,
  deleteProfile,
  PAGE_SIZE,
} from "../models/profile";
import { SOURCES } from "../db/schema";
import { validateProfile, type ProfileInput } from "../utils/validate";
import { toCsv, csvHeaders } from "../utils/csv";

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

/** 表单页需要的公共数据 */
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
    // 导出链接带上当前筛选条件，但去掉分页参数（导出是全量）
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

  // U+FEFF BOM：没有它 Excel 打开中文表头会乱码
  const body = "\uFEFF" + toCsv(table);

  res.set(csvHeaders(filename));
  res.send(body);
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
      values, // 回填已填内容
    });
    return;
  }

  const created = await createProfile(toRow(values));
  res.redirect(`/profiles/${created.id}`); // PRG：跳详情页
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
    values: profile, // 用库里的值回填
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
    // existing 在前、values 在后 → 用户提交的优先，其余字段沿用库里已有的
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