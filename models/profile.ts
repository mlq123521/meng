import { and, or, desc, count, eq, inArray, sql, type SQL } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";
import { db } from "../db";
import {
  customerProfiles,
  importBatches,
  importBatchItems,
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
 * 整批只发【一条】SQL：
 *   INSERT INTO customer_profiles (...) VALUES (...), (...), (...)
 *   ON CONFLICT (phone) DO UPDATE SET ...
 * 依赖 phone 上的 UNIQUE 约束，性能远好于逐行 INSERT/UPDATE。
 *
 * 整个过程包在事务里：中途失败整批回滚。
 */
export async function importProfiles(rows: ProfileRow[]): Promise<ImportOutcome> {
  if (rows.length === 0) return { inserted: [], updated: [], backup: [] };

  return db.transaction(async (tx) => {
    const phones = rows.map((r) => r.phone);

    // ① 先查出已存在的记录，作为回滚用的「更新前快照」
    const existingRows = await tx
      .select()
      .from(customerProfiles)
      .where(inArray(customerProfiles.phone, phones));
    const existing = new Map(existingRows.map((r) => [r.phone, r]));

    // ② 一条 UPSERT 完成全部新增与更新
    const result = await tx
      .insert(customerProfiles)
      .values(rows)
      .onConflictDoUpdate({
        target: customerProfiles.phone,
        set: {
          companyName: sql`excluded.company_name`,
          contactName: sql`excluded.contact_name`,
          position: sql`excluded.position`,
          email: sql`excluded.email`,
          industry: sql`excluded.industry`,
          source: sql`excluded.source`,
          address: sql`excluded.address`,
          remark: sql`excluded.remark`,
        },
      })
      .returning({
        ...getTableColumns(customerProfiles),
        // PostgreSQL 小技巧：xmax = 0 说明这行是本次 INSERT 的（而非 UPDATE 的）
        isInserted: sql<boolean>`(xmax = 0)`,
      });

    const inserted = result.filter((r) => r.isInserted);
    const updated = result.filter((r) => !r.isInserted);

    return {
      inserted,
      updated,
      backup: existingRows, // 更新前的原始行
    };
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

/** 查询指定 id 列表 */
export async function getProfilesByIds(ids: number[]): Promise<CustomerProfile[]> {
  if (ids.length === 0) return [];
  return db.select().from(customerProfiles).where(inArray(customerProfiles.id, ids));
}

/* ════════════════ 导入批次 ════════════════ */

/** 记录一次导入（含每条变更的明细），返回批次 id */
export async function recordBatch(params: {
  fileName: string;
  totalRows: number;
  failedCount: number;
  inserted: CustomerProfile[];
  backup: CustomerProfile[];
}): Promise<number> {
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(importBatches)
      .values({
        fileName: params.fileName,
        totalRows: params.totalRows,
        insertedCount: params.inserted.length,
        updatedCount: params.backup.length,
        failedCount: params.failedCount,
        status: "committed",
      })
      .returning({ id: importBatches.id });

    const items = [
      ...params.inserted.map((p) => ({
        batchId: batch.id,
        profileId: p.id,
        action: "inserted" as const,
        beforeData: null,
      })),
      ...params.backup.map((p) => ({
        batchId: batch.id,
        profileId: p.id,
        action: "updated" as const,
        // 存更新前的整行，回滚时原样写回
        beforeData: {
          companyName: p.companyName,
          contactName: p.contactName,
          position: p.position,
          phone: p.phone,
          email: p.email,
          industry: p.industry,
          source: p.source,
          address: p.address,
          remark: p.remark,
        },
      })),
    ];

    if (items.length) await tx.insert(importBatchItems).values(items);
    return batch.id;
  });
}

/** 最近的导入批次列表 */
export async function listBatches(limit = 20) {
  return db
    .select()
    .from(importBatches)
    .orderBy(desc(importBatches.id))
    .limit(limit);
}

/**
 * 撤销一个批次
 * - action=inserted → 删除对应档案
 * - action=updated  → 用 beforeData 原样还原
 * 幂等：已撤销过的批次直接返回
 */
export async function rollbackBatch(batchId: number): Promise<{
  ok: boolean;
  removed: number;
  restored: number;
  message: string;
}> {
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(importBatches)
      .where(eq(importBatches.id, batchId))
      .limit(1);

    if (!batch) return { ok: false, removed: 0, restored: 0, message: "批次不存在" };
    if (batch.status === "rolled_back") {
      return { ok: false, removed: 0, restored: 0, message: "该批次已经撤销过了" };
    }

    const items = await tx
      .select()
      .from(importBatchItems)
      .where(eq(importBatchItems.batchId, batchId));

    // ① 删除本次新增的
    const insertedIds = items.filter((i) => i.action === "inserted").map((i) => i.profileId);
    let removed = 0;
    if (insertedIds.length) {
      const deleted = await tx
        .delete(customerProfiles)
        .where(inArray(customerProfiles.id, insertedIds))
        .returning({ id: customerProfiles.id });
      removed = deleted.length;
    }

    // ② 还原被覆盖的
    let restored = 0;
    for (const item of items) {
      if (item.action !== "updated" || !item.beforeData) continue;
      const b = item.beforeData as Record<string, string | null>;
      const [done] = await tx
        .update(customerProfiles)
        .set({
          companyName: String(b.companyName ?? ""),
          contactName: String(b.contactName ?? ""),
          position: b.position ?? null,
          email: b.email ?? null,
          industry: b.industry ?? null,
          source: String(b.source ?? "其他"),
          address: b.address ?? null,
          remark: b.remark ?? null,
        })
        .where(eq(customerProfiles.id, item.profileId))
        .returning({ id: customerProfiles.id });
      if (done) restored++;
    }

    await tx
      .update(importBatches)
      .set({ status: "rolled_back", rolledBackAt: new Date() })
      .where(eq(importBatches.id, batchId));

    return { ok: true, removed, restored, message: "已撤销" };
  });
}