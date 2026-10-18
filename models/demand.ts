import { and, or, desc, count, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { demands, customerProfiles, STATUSES, type Demand } from "../db/schema";
import { likePattern } from "../utils/like";

/** 默认每页条数 */
export const PAGE_SIZE = 10;
/** 每页条数允许的范围，防止 ?pageSize=99999 拖库 */
const PAGE_SIZE_MIN = 5;
const PAGE_SIZE_MAX = 100;
/** 搜索关键词最大长度，超出直接截断 */
const KEYWORD_MAX = 60;

/** 列表查询条件 */
export interface ListQuery {
  keyword?: string; // 同时搜客户档案和需求内容
  status?: string;
  profileId?: number; // 只看某个客户的需求
  page?: number;
  pageSize?: number;
}

/** 列表页数据 */
export interface DemandListData {
  list: Demand[];
  total: number;
  allTotal: number;
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

/** 构造查询条件：客户档案侧 + 需求侧 */
function buildWhere(q: ListQuery) {
  const keyword = (q.keyword ?? "").trim().slice(0, KEYWORD_MAX);
  const status = (q.status ?? "").trim();
  const conditions = [];

  // 关键词：客户档案的公司/联系人/手机 + 需求描述/备注
  if (keyword) {
    const pattern = likePattern(keyword);
    const ilike = (col: SQL) => safeILike(col, pattern);
    conditions.push(
      or(
        ilike(customerProfiles.companyName),
        ilike(customerProfiles.contactName),
        ilike(customerProfiles.phone),
        ilike(demands.demand),
        ilike(demands.remark),
      ),
    );
  }

  if (status) conditions.push(eq(demands.status, status));
  if (q.profileId) conditions.push(eq(demands.profileId, q.profileId));

  return { keyword, status, where: conditions.length ? and(...conditions) : undefined };
}

/** 把每页条数夹到合法区间 */
function clampPageSize(n?: number): number {
  if (!Number.isFinite(n)) return PAGE_SIZE;
  return Math.min(PAGE_SIZE_MAX, Math.max(PAGE_SIZE_MIN, Math.floor(Number(n))));
}

/** 需求列表（含客户信息），带筛选与分页 */
export async function getDemandList(q: ListQuery = {}): Promise<DemandListData> {
  const { keyword, status, where } = buildWhere(q);
  const pageSize = clampPageSize(q.pageSize);

  const base = db
    .select({
      id: demands.id,
      profileId: demands.profileId,
      demand: demands.demand,
      status: demands.status,
      remark: demands.remark,
      createdAt: demands.createdAt,
      companyName: customerProfiles.companyName,
      contactName: customerProfiles.contactName,
      phone: customerProfiles.phone,
    })
    .from(demands)
    .innerJoin(customerProfiles, eq(demands.profileId, customerProfiles.id));

  const countBase = db
    .select({ n: count() })
    .from(demands)
    .innerJoin(customerProfiles, eq(demands.profileId, customerProfiles.id));

  const [[row], [allRow]] = await Promise.all([
    countBase.where(where),
    db.select({ n: count() }).from(demands),
  ]);

  const total = row.n;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(Number(q.page) || 1)), totalPages);

  const list = await base
    .where(where)
    .orderBy(desc(demands.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { list, total, allTotal: allRow.n, page, pageSize, totalPages, keyword, status, statuses: STATUSES };
}

/** 导出用：全部匹配的需求（不分页） */
export async function getDemandsForExport(q: ListQuery = {}): Promise<Demand[]> {
  const { where } = buildWhere(q);
  return db
    .select({
      id: demands.id,
      profileId: demands.profileId,
      demand: demands.demand,
      status: demands.status,
      remark: demands.remark,
      createdAt: demands.createdAt,
      companyName: customerProfiles.companyName,
      contactName: customerProfiles.contactName,
      phone: customerProfiles.phone,
    })
    .from(demands)
    .innerJoin(customerProfiles, eq(demands.profileId, customerProfiles.id))
    .where(where)
    .orderBy(desc(demands.id));
}

/** 表单提交的数据 */
export interface DemandInput {
  profileId: number;
  demand: string;
  remark: string;
  status: string;
}

/** 按 id 查需求（含客户信息） */
export async function getDemandById(id: number): Promise<Demand | undefined> {
  const [row] = await db
    .select({
      id: demands.id,
      profileId: demands.profileId,
      demand: demands.demand,
      status: demands.status,
      remark: demands.remark,
      createdAt: demands.createdAt,
      companyName: customerProfiles.companyName,
      contactName: customerProfiles.contactName,
      phone: customerProfiles.phone,
    })
    .from(demands)
    .innerJoin(customerProfiles, eq(demands.profileId, customerProfiles.id))
    .where(eq(demands.id, id))
    .limit(1);
  return row;
}

/** 新建需求 */
export async function createDemand(data: DemandInput): Promise<Demand> {
  const created = await db
    .insert(demands)
    .values({ ...data, remark: data.remark || null })
    .returning();
  // returning 只有 demands 自己的字段，客户信息要再查一次
  return (await getDemandById(created[0].id))!;
}

/** 按 id 更新，返回更新后的需求（不存在返回 undefined） */
export async function updateDemand(id: number, data: DemandInput): Promise<Demand | undefined> {
  const [updated] = await db
    .update(demands)
    .set({ ...data, remark: data.remark || null })
    .where(eq(demands.id, id))
    .returning();
  if (!updated) return undefined;
  return getDemandById(id);
}

/** 按 id 删除，返回被删的需求（不存在返回 undefined） */
export async function deleteDemand(id: number): Promise<Demand | undefined> {
  // ⚠️ 必须先取出完整数据（含关联的客户信息）再删 ——
  //    删完再查就查不到了，会被误判成「记录不存在」
  const snapshot = await getDemandById(id);
  if (!snapshot) return undefined;

  await db.delete(demands).where(eq(demands.id, id));
  return snapshot;
}

/** 批量删除 */
export async function deleteDemands(ids: number[]): Promise<Demand[]> {
  if (ids.length === 0) return [];
  // 同样先取快照，删完行就没了
  const snapshots = await Promise.all(ids.map((id) => getDemandById(id)));
  const existing = snapshots.filter((d): d is Demand => Boolean(d));
  if (existing.length) {
    await db.delete(demands).where(inArray(demands.id, existing.map((d) => d.id)));
  }
  return existing;
}

/** 某客户档案下的所有需求（详情页用） */
export async function getDemandsByProfile(profileId: number): Promise<Demand[]> {
  return db
    .select({
      id: demands.id,
      profileId: demands.profileId,
      demand: demands.demand,
      status: demands.status,
      remark: demands.remark,
      createdAt: demands.createdAt,
      companyName: customerProfiles.companyName,
      contactName: customerProfiles.contactName,
      phone: customerProfiles.phone,
    })
    .from(demands)
    .innerJoin(customerProfiles, eq(demands.profileId, customerProfiles.id))
    .where(eq(demands.profileId, profileId))
    .orderBy(desc(demands.id));
}

/** 可供选择客户的档案列表（下拉框用） */
export async function listProfilesForSelect(limit = 500) {
  return db
    .select({
      id: customerProfiles.id,
      companyName: customerProfiles.companyName,
      contactName: customerProfiles.contactName,
      phone: customerProfiles.phone,
    })
    .from(customerProfiles)
    .orderBy(desc(customerProfiles.id))
    .limit(limit);
}