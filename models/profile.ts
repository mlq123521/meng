import { and, or, desc, count, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  customerProfiles,
  SOURCES,
  type CustomerProfile,
} from "../db/schema";
import { likePattern } from "../utils/like";

/** 默认每页条数 */
export const PAGE_SIZE = 10;
const PAGE_SIZE_MIN = 5;
const PAGE_SIZE_MAX = 100;
const KEYWORD_MAX = 60;

export interface ListQuery {
  keyword?: string;
  source?: string;
  industry?: string;
  page?: number;
  pageSize?: number;
}

export interface ProfileListData {
  list: CustomerProfile[];
  total: number;
  allTotal: number;
  page: number;
  pageSize: number;
  totalPages: number;
  keyword: string;
  source: string;
  industry: string;
  sources: readonly string[];
  /** 已存在的行业列表，供筛选下拉用 */
  industries: string[];
}

/** 安全的大小写不敏感模糊匹配 */
function safeILike(column: SQL, pattern: string): SQL {
  return sql`${column} ILIKE ${pattern} ESCAPE ${"\\"}`;
}

function buildWhere(q: ListQuery) {
  const keyword = (q.keyword ?? "").trim().slice(0, KEYWORD_MAX);
  const source = (q.source ?? "").trim();
  const industry = (q.industry ?? "").trim();
  const conditions = [];

  if (keyword) {
    const pattern = likePattern(keyword);
    conditions.push(
      or(
        safeILike(customerProfiles.companyName, pattern),
        safeILike(customerProfiles.contactName, pattern),
        safeILike(customerProfiles.phone, pattern),
        safeILike(customerProfiles.email, pattern),
        safeILike(customerProfiles.position, pattern),
      ),
    );
  }
  if (source) conditions.push(eq(customerProfiles.source, source));
  if (industry) conditions.push(eq(customerProfiles.industry, industry));

  return { keyword, source, industry, where: conditions.length ? and(...conditions) : undefined };
}

function clampPageSize(n?: number): number {
  if (!Number.isFinite(n)) return PAGE_SIZE;
  return Math.min(PAGE_SIZE_MAX, Math.max(PAGE_SIZE_MIN, Math.floor(Number(n))));
}

/** 档案列表：关键词 + 来源 + 行业筛选 + 分页 */
export async function getProfileList(q: ListQuery = {}): Promise<ProfileListData> {
  const { keyword, source, industry, where } = buildWhere(q);
  const pageSize = clampPageSize(q.pageSize);

  const [[row], [allRow], industryRows] = await Promise.all([
    db.select({ n: count() }).from(customerProfiles).where(where),
    db.select({ n: count() }).from(customerProfiles),
    db.selectDistinct({ v: customerProfiles.industry }).from(customerProfiles),
  ]);

  const total = row.n;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(Number(q.page) || 1)), totalPages);

  const list = await db
    .select()
    .from(customerProfiles)
    .where(where)
    .orderBy(desc(customerProfiles.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const industries = industryRows
    .map((r) => r.v)
    .filter((v): v is string => Boolean(v))
    .sort();

  return {
    list,
    total,
    allTotal: allRow.n,
    page,
    pageSize,
    totalPages,
    keyword,
    source,
    industry,
    sources: SOURCES,
    industries,
  };
}

/** 按 id 查档案 */
export async function getProfileById(id: number): Promise<CustomerProfile | undefined> {
  return db.query.customerProfiles.findFirst({ where: eq(customerProfiles.id, id) });
}

/** 导出用：取出全部匹配记录（不分页） */
export async function getProfilesForExport(q: ListQuery = {}): Promise<CustomerProfile[]> {
  const { where } = buildWhere(q);
  return db
    .select()
    .from(customerProfiles)
    .where(where)
    .orderBy(desc(customerProfiles.id));
}

/** 新建档案 */
export async function createProfile(
  data: Omit<CustomerProfile, "id" | "createdAt">,
): Promise<CustomerProfile> {
  const [created] = await db.insert(customerProfiles).values(data).returning();
  return created;
}

/** 按 id 更新，返回更新后的记录（不存在返回 undefined） */
export async function updateProfile(
  id: number,
  data: Omit<CustomerProfile, "id" | "createdAt">,
): Promise<CustomerProfile | undefined> {
  const [updated] = await db
    .update(customerProfiles)
    .set(data)
    .where(eq(customerProfiles.id, id))
    .returning();
  return updated;
}

/** 按 id 删除，返回被删的记录（不存在返回 undefined） */
export async function deleteProfile(id: number): Promise<CustomerProfile | undefined> {
  const [deleted] = await db
    .delete(customerProfiles)
    .where(eq(customerProfiles.id, id))
    .returning();
  return deleted;
}

/* ────────────────────批量导入 ──────────────────── */

/** 一行导入数据（已通过校验） */
export interface ProfileRow {
  companyName: string;
  contactName: string;
  position: string | null;
  phone: string;
  email: string | null;
  industry: string | null;
  source: string;
  address: string | null;
  remark: string | null;
}

/** 批量导入结果 */
export interface ImportOutcome {
  inserted: CustomerProfile[];
  updated: CustomerProfile[];
  /** 更新前的原始记录 —— 回滚时用它还原，绝不能取更新后的值 */
  backup: CustomerProfile[];
}

/** 查库里已存在的手机号 → 记录 */
async function findByPhones(phones: string[]): Promise<Map<string, CustomerProfile>> {
  const rows = await db
    .select()
    .from(customerProfiles)
    .where(inArray(customerProfiles.phone, phones));
  return new Map(rows.map((r) => [r.phone, r]));
}

/**
 * 按手机号判断：存在则更新，不存在则新增
 *
 * 整个过程包在一个事务里：
 * 中途任何一条失败，整批回滚，不会留下「导了一半」的数据。
 * 返回 backup（更新前的原始记录）供一键回滚使用。
 */
export async function importProfiles(rows: ProfileRow[]): Promise<ImportOutcome> {
  if (rows.length === 0) return { inserted: [], updated: [], backup: [] };

  return db.transaction(async (tx) => {
    const phones = rows.map((r) => r.phone);
    const existingRows = await tx
      .select()
      .from(customerProfiles)
      .where(inArray(customerProfiles.phone, phones));
    const existing = new Map(existingRows.map((r) => [r.phone, r]));

    const toInsert = rows.filter((r) => !existing.has(r.phone));
    const toUpdate = rows.filter((r) => existing.has(r.phone));

    let inserted: CustomerProfile[] = [];
    if (toInsert.length) {
      inserted = await tx.insert(customerProfiles).values(toInsert).returning();
    }

    let updated: CustomerProfile[] = [];
    for (const row of toUpdate) {
      const old = existing.get(row.phone)!;
      const [u] = await tx
        .update(customerProfiles)
        .set(row)
        .where(eq(customerProfiles.id, old.id))
        .returning();
      if (u) updated.push(u);
    }

    // ⚠️ 必须留存【更新前】的值 —— existingRows 是更新前的快照
    const backup = toUpdate.map((r) => existing.get(r.phone)!).filter(Boolean);

    return { inserted, updated, backup };
  });
}

/** 批量删除指定 id（用于导入回滚） */
export async function deleteProfilesByIds(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .delete(customerProfiles)
    .where(inArray(customerProfiles.id, ids))
    .returning({ id: customerProfiles.id });
  return rows.length;
}

/** 查询指定 id 列表（回滚前先记录原始值） */
export async function getProfilesByIds(ids: number[]): Promise<CustomerProfile[]> {
  if (ids.length === 0) return [];
  return db.select().from(customerProfiles).where(inArray(customerProfiles.id, ids));
}