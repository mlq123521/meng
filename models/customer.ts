import { and, or, desc, count, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  customers,
  STATUSES,
  type Customer,
  type NewCustomer,
} from "../db/schema";
import { likePattern } from "../utils/like";

/** 默认每页条数 */
export const PAGE_SIZE = 10;
/** 每页条数允许的范围，防止 ?pageSize=99999 拖库 */
const PAGE_SIZE_MIN = 5;
const PAGE_SIZE_MAX = 100;
/** 搜索关键词最大长度，超出直接截断 */
const KEYWORD_MAX = 60;

/** 列表页查询条件 */
export interface ListQuery {
  keyword?: string; // 搜客户名 / 联系人 / 手机 / 需求描述
  status?: string;  // 按状态筛选
  page?: number;    // 第几页，从 1 开始
  pageSize?: number;
}

/** 列表页数据 */
export interface CustomerListData {
  list: Customer[];
  total: number;      // 筛选后的总数
  allTotal: number;   // 不筛选的总记录数
  page: number;
  pageSize: number;
  totalPages: number;
  keyword: string;
  status: string;
  statuses: readonly string[];
}

/** 安全的大小写不敏感模糊匹配：转义通配符 + 指定 ESCAPE 字符 */
function safeILike(column: SQL, pattern: string): SQL {
  return sql`${column} ILIKE ${pattern} ESCAPE ${"\\"}`;
}

/** 把关键词 + 状态拼成 where 条件 */
function buildWhere(q: ListQuery) {
  const keyword = (q.keyword ?? "").trim().slice(0, KEYWORD_MAX);
  const status = (q.status ?? "").trim();
  const conditions = [];

  if (keyword) {
    const pattern = likePattern(keyword); // % 和 _ 已转义
    conditions.push(
      or(
        safeILike(customers.customerName, pattern),
        safeILike(customers.contactName, pattern),
        safeILike(customers.phone, pattern),
        safeILike(customers.demand, pattern),
      ),
    );
  }
  if (status) conditions.push(eq(customers.status, status));

  return { keyword, status, where: conditions.length ? and(...conditions) : undefined };
}

/** 把 pageSize 夹到合法区间 */
function clampPageSize(n?: number): number {
  if (!Number.isFinite(n)) return PAGE_SIZE;
  return Math.min(PAGE_SIZE_MAX, Math.max(PAGE_SIZE_MIN, Math.floor(Number(n))));
}

/** 需求列表：关键词搜索 + 状态筛选 + 分页 */
export async function getCustomerList(q: ListQuery = {}): Promise<CustomerListData> {
  const { keyword, status, where } = buildWhere(q);

  const pageSize = clampPageSize(q.pageSize);
  const [[row], [allRow]] = await Promise.all([
    db.select({ n: count() }).from(customers).where(where),
    db.select({ n: count() }).from(customers),
  ]);

  const total = row.n;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // 页码越界时回退到最后一页
  const rawPage = Math.floor(Number(q.page) || 1);
  const page = Math.min(Math.max(1, rawPage), totalPages);

  const list = await db
    .select()
    .from(customers)
    .where(where)
    .orderBy(desc(customers.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { list, total, allTotal: allRow.n, page, pageSize, totalPages, keyword, status, statuses: STATUSES };
}

/** 导出用：取出全部匹配记录（不分页） */
export async function getCustomersForExport(q: ListQuery = {}): Promise<Customer[]> {
  const { where } = buildWhere(q);
  return db.select().from(customers).where(where).orderBy(desc(customers.id));
}

/** 表单提交的数据 */
export interface CustomerInput {
  customerName: string;
  contactName: string;
  phone: string;
  demand: string;
  remark: string;
  status: string;
}

/** 新建一条需求登记 */
export async function createCustomer(data: CustomerInput): Promise<Customer> {
  const [created] = await db.insert(customers).values(data).returning();
  return created;
}

/** 按 id 查一条 */
export async function getCustomerById(id: number): Promise<Customer | undefined> {
  return db.query.customers.findFirst({ where: eq(customers.id, id) });
}

/** 按 id 更新，返回更新后的记录（不存在返回 undefined） */
export async function updateCustomer(id: number, data: CustomerInput): Promise<Customer | undefined> {
  const [updated] = await db.update(customers).set(data).where(eq(customers.id, id)).returning();
  return updated;
}

/** 按 id 删除，返回被删的记录（不存在返回 undefined） */
export async function deleteCustomer(id: number): Promise<Customer | undefined> {
  const [deleted] = await db.delete(customers).where(eq(customers.id, id)).returning();
  return deleted;
}

/** 批量删除，返回实际删除的记录 */
export async function deleteCustomers(ids: number[]): Promise<Customer[]> {
  if (ids.length === 0) return [];
  return db.delete(customers).where(inArray(customers.id, ids)).returning();
}