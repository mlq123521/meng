import type { Request, Response } from "express";
import {
  getCustomerList,
  getCustomersForExport,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  PAGE_SIZE,
  type CustomerInput,
} from "../models/customer";
import { STATUSES } from "../db/schema";
import { oneLine, countLines } from "../utils/text";
import { validateCustomer } from "../utils/validate";
import { toCsv, csvHeaders } from "../utils/csv";

/** 表单初始值 */
const blank = (): CustomerInput => ({
  customerName: "",
  contactName: "",
  phone: "",
  demand: "",
  status: STATUSES[0],
});

/** 从 req.body 提取并清洗表单字段（含长度上限截断） */
function readForm(body: unknown): CustomerInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  return {
    customerName: clip(b.customerName, 200),
    contactName: clip(b.contactName, 200),
    phone: clip(b.phone, 200),
    demand: clip(b.demand, 5000),
    status: String(b.status ?? STATUSES[0]).slice(0, 20),
  };
}

/** 校验表单：长度上限 + 手机号格式 + 状态白名单 */
function validate(input: CustomerInput): string {
  return validateCustomer(input).message;
}

/** 把 id 转成正整数，非法返回 null */
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/* ────────────────────────── 查询（列表） ────────────────────────── */

/** 列表页需求描述的摘要长度 */
const DEMAND_SUMMARY_LEN = 36;

/** 构造分页链接：保留筛选条件，只换 page */
export function pageLink(base: string, page: number, keyword: string, status: string): string {
  const p = new URLSearchParams();
  if (keyword) p.set("keyword", keyword);
  if (status) p.set("status", status);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}

export async function list(req: Request, res: Response): Promise<void> {
  const keyword = String(req.query.keyword ?? "");
  const status = String(req.query.status ?? "");
  const page = Number(req.query.page) || 1;

  const data = await getCustomerList({ keyword, status, page, pageSize: PAGE_SIZE });

  // 预先算好分页条，模板里直接用
  const pages: number[] = [];
  for (let p = 1; p <= data.totalPages; p++) pages.push(p);

  // 需求描述在列表页只显示摘要，完整内容去详情页看
  const list = data.list.map((c) => ({
    ...c,
    demandSummary: oneLine(c.demand, DEMAND_SUMMARY_LEN),
    demandLines: countLines(c.demand),
  }));

  res.render("customerList", {
    ...data,
    list,
    summaryLen: DEMAND_SUMMARY_LEN,
    pages,
    prevLink: data.page > 1 ? pageLink("/", data.page - 1, keyword, status) : null,
    nextLink: data.page < data.totalPages ? pageLink("/", data.page + 1, keyword, status) : null,
    exportLink: pageLink("/export.csv", 1, keyword, status),
  });
}

/* ────────────────────────── 导出 CSV ────────────────────────── */

export async function exportCsv(req: Request, res: Response): Promise<void> {
  const rows = await getCustomersForExport({
    keyword: String(req.query.keyword ?? ""),
    status: String(req.query.status ?? ""),
  });

  const table: unknown[][] = [
    ["编号", "客户名", "联系人", "手机", "需求描述", "状态", "登记时间"],
    ...rows.map((c) => [
      c.id,
      c.customerName,
      c.contactName,
      c.phone,
      c.demand,
      c.status,
      c.createdAt.toISOString().slice(0, 19).replace("T", " "),
    ]),
  ];

  const filename = `客户需求登记_${new Date().toISOString().slice(0, 10)}.csv`;

  // U+FEFF BOM：没有它 Excel 打开中文表头会乱码
  const body = "\uFEFF" + toCsv(table);

  res.set(csvHeaders(filename));
  res.send(body);
}

/* ────────────────────────── 新增 ────────────────────────── */

export function form(_req: Request, res: Response): void {
  res.render("customerForm", {
    title: "登记客户需求",
    action: "/",
    submitText: "提交登记",
    statuses: STATUSES,
    error: null,
    values: blank(),
  });
}

export async function create(req: Request, res: Response): Promise<void> {
  const values = readForm(req.body);
  const error = validate(values);

  if (error) {
    res.status(400).render("customerForm", {
      title: "登记客户需求",
      action: "/",
      submitText: "提交登记",
      statuses: STATUSES,
      error,
      values, // 回填已填内容
    });
    return;
  }

  await createCustomer(values);
  res.redirect("/");
}

/* ────────────────────────── 详情 ────────────────────────── */

export async function detail(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  const customer = id === null ? undefined : await getCustomerById(id);

  if (!customer) {
    res.status(404).render("customerNotFound", { id: req.params.id });
    return;
  }
  res.render("customerDetail", { customer });
}

/* ────────────────────────── 编辑 ────────────────────────── */

export async function editForm(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  const customer = id === null ? undefined : await getCustomerById(id);

  if (!customer) {
    res.status(404).render("customerNotFound", { id: req.params.id });
    return;
  }
  res.render("customerForm", {
    title: `编辑需求 #${customer.id}`,
    action: `/customers/${customer.id}`,
    submitText: "保存修改",
    statuses: STATUSES,
    error: null,
    values: customer, // 用数据库里的值回填
  });
}

export async function update(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);

  if (id === null) {
    res.status(404).render("customerNotFound", { id: req.params.id });
    return;
  }

  const existing = await getCustomerById(id);
  if (!existing) {
    res.status(404).render("customerNotFound", { id: req.params.id });
    return;
  }

  const values = readForm(req.body);
  const error = validate(values);

  if (error) {
    // customer 在前、values 在后 → 用户提交的值优先，其余字段沿用库里已有的
    res.status(400).render("customerForm", {
      title: `编辑需求 #${id}`,
      action: `/customers/${id}`,
      submitText: "保存修改",
      statuses: STATUSES,
      error,
      values: { ...existing, ...values, id },
    });
    return;
  }

  const updated = await updateCustomer(id, values);
  if (!updated) {
    res.status(404).render("customerNotFound", { id: req.params.id });
    return;
  }
  res.redirect(`/customers/${id}`); // 回详情页看结果
}

/* ────────────────────────── 删除 ────────────────────────── */

export async function remove(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);

  if (id === null) {
    res.status(404).render("customerNotFound", { id: req.params.id });
    return;
  }

  const deleted = await deleteCustomer(id);
  if (!deleted) {
    res.status(404).render("customerNotFound", { id: req.params.id });
    return;
  }
  res.redirect("/");
}
