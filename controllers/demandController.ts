import type { Request, Response } from "express";
import {
  getDemandList,
  getDemandsForExport,
  getDemandById,
  createDemand,
  updateDemand,
  deleteDemand,
  listProfilesForSelect,
  PAGE_SIZE,
  type DemandInput,
} from "../models/demand";
import { STATUSES } from "../db/schema";
import { validateDemand } from "../utils/validate";
import { isForeignKeyViolation } from "../utils/pgError";
import { oneLine, countLines } from "../utils/text";
import { toCsv, csvHeaders } from "../utils/csv";

/** 列表页需求描述的摘要长度 */
const DEMAND_SUMMARY_LEN = 36;
/** 列表页备注的摘要长度 */
const REMARK_SUMMARY_LEN = 24;

/** 表单初始值 */
const blank = () => ({
  profileId: "",
  demand: "",
  remark: "",
  status: STATUSES[0],
});

/** 从 req.body 提取并清洗（含长度上限截断） */
function readForm(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  return {
    profileId: clip(b.profileId, 20),
    demand: clip(b.demand, 5000),
    remark: clip(b.remark, 2000),
    status: String(b.status ?? STATUSES[0]).slice(0, 20),
  };
}

/** 表单数据 → 模型入参 */
function toInput(f: ReturnType<typeof readForm>): DemandInput {
  return { profileId: Number(f.profileId), demand: f.demand, remark: f.remark, status: f.status };
}

/** id → 正整数，非法返回 null */
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** 构造分页链接：保留筛选条件，只换 page */
function pageLink(base: string, page: number, keyword: string, status: string): string {
  const p = new URLSearchParams();
  if (keyword) p.set("keyword", keyword);
  if (status) p.set("status", status);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}

/* ────────────────────────── 需求列表 ────────────────────────── */

export async function list(req: Request, res: Response): Promise<void> {
  const keyword = String(req.query.keyword ?? "");
  const status = String(req.query.status ?? "");
  const page = Number(req.query.page) || 1;

  const data = await getDemandList({ keyword, status, page, pageSize: PAGE_SIZE });

  const pages: number[] = [];
  for (let p = 1; p <= data.totalPages; p++) pages.push(p);

  // 列表页只显示摘要，完整内容去详情页看
  const list = data.list.map((d) => ({
    ...d,
    demandSummary: oneLine(d.demand, DEMAND_SUMMARY_LEN),
    demandLines: countLines(d.demand),
    remarkSummary: oneLine(d.remark, REMARK_SUMMARY_LEN),
  }));

  res.render("demandList", {
    ...data,
    list,
    pages,
    prevLink: data.page > 1 ? pageLink("/", data.page - 1, keyword, status) : null,
    nextLink: data.page < data.totalPages ? pageLink("/", data.page + 1, keyword, status) : null,
    exportLink: pageLink("/export.csv", 1, keyword, status),
  });
}

/* ────────────────────────── 导出 CSV ────────────────────────── */

export async function exportCsv(req: Request, res: Response): Promise<void> {
  const rows = await getDemandsForExport({
    keyword: String(req.query.keyword ?? ""),
    status: String(req.query.status ?? ""),
  });

  const table: unknown[][] = [
    ["编号", "客户名", "联系人", "手机", "需求描述", "状态", "备注", "登记时间"],
    ...rows.map((d) => [
      d.id, d.companyName, d.contactName, d.phone,
      d.demand, d.status, d.remark,
      d.createdAt.toISOString().slice(0, 19).replace("T", " "),
    ]),
  ];

  const filename = `客户需求登记_${new Date().toISOString().slice(0, 10)}.csv`;
  const body = "﻿" + toCsv(table);

  res.set(csvHeaders(filename));
  res.send(body);
}

/* ────────────────────────── 新增 ────────────────────────── */

export async function form(req: Request, res: Response): Promise<void> {
  const profiles = await listProfilesForSelect();

  // 一个客户档案都没有 → 提示先去建档
  if (profiles.length === 0) {
    res.render("demandNoProfile");
    return;
  }

  // 从档案详情页点「+ 登记需求」进来时，预选中该客户
  const preselect = String(req.query.profileId ?? "");

  res.render("demandForm", {
    title: "登记客户需求",
    action: "/",
    submitText: "提交登记",
    profiles,
    statuses: STATUSES,
    error: null,
    values: { ...blank(), profileId: preselect },
  });
}

export async function create(req: Request, res: Response): Promise<void> {
  const f = readForm(req.body);
  const { ok, message } = validateDemand(f);

  if (ok) {
    try {
      const created = await createDemand(toInput(f));
      res.redirect(`/demands/${created.id}`);
      return;
    } catch (err) {
      // 外键冲突 = 选中的客户档案不存在
      if (!isForeignKeyViolation(err)) throw err;
    }
  }

  // 校验失败 或 客户档案不存在
  res.status(400).render("demandForm", {
    title: "登记客户需求",
    action: "/",
    submitText: "提交登记",
    profiles: await listProfilesForSelect(),
    statuses: STATUSES,
    error: ok ? "选中的客户档案不存在，请重新选择" : message,
    values: f,
  });
}

/* ────────────────────────── 详情 ────────────────────────── */

export async function detail(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  const demand = id === null ? undefined : await getDemandById(id);

  if (!demand) {
    res.status(404).render("recordNotFound", { id: req.params.id });
    return;
  }
  res.render("demandDetail", { demand });
}

/* ────────────────────────── 编辑 ────────────────────────── */

export async function editForm(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  const demand = id === null ? undefined : await getDemandById(id);

  if (!demand) {
    res.status(404).render("recordNotFound", { id: req.params.id });
    return;
  }

  res.render("demandForm", {
    title: `编辑需求 #${id}`,
    action: `/demands/${id}`,
    submitText: "保存修改",
    profiles: await listProfilesForSelect(),
    statuses: STATUSES,
    error: null,
    values: demand,
  });
}

export async function update(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);

  if (id === null) {
    res.status(404).render("recordNotFound", { id: req.params.id });
    return;
  }

  const existing = await getDemandById(id);
  if (!existing) {
    res.status(404).render("recordNotFound", { id: req.params.id });
    return;
  }

  const f = readForm(req.body);
  const { ok, message } = validateDemand(f);

  if (ok) {
    try {
      const updated = await updateDemand(id, toInput(f));
      if (updated) {
        res.redirect(`/demands/${id}`);
        return;
      }
      res.status(404).render("recordNotFound", { id: req.params.id });
      return;
    } catch (err) {
      if (!isForeignKeyViolation(err)) throw err;
    }
  }

  res.status(400).render("demandForm", {
    title: `编辑需求 #${id}`,
    action: `/demands/${id}`,
    submitText: "保存修改",
    profiles: await listProfilesForSelect(),
    statuses: STATUSES,
    error: ok ? "选中的客户档案不存在，请重新选择" : message,
    // existing 在前、f 在后 → 用户提交的优先
    values: { ...existing, ...f },
  });
}

/* ────────────────────────── 删除 ────────────────────────── */

export async function remove(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);

  if (id === null) {
    res.status(404).render("recordNotFound", { id: req.params.id });
    return;
  }

  const deleted = await deleteDemand(id);
  if (!deleted) {
    res.status(404).render("recordNotFound", { id: req.params.id });
    return;
  }
  res.redirect("/");
}