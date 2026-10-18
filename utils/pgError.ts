/**
 * PostgreSQL 错误码提取
 *
 * Drizzle 会把底层错误包进 DrizzleQueryError，
 * 真正的 PostgresError 藏在 cause 里，
 * 所以直接读 err.code 拿不到 23505 之类的错误码。
 */

/** PostgreSQL SQLSTATE 错误码 */
export type PgErrorCode = "23505" | "23514" | "23503" | "22001" | string;

/** 沿 cause 链往下找，直到找到带 code 的 PostgreSQL 错误 */
export function pgErrorCode(err: unknown): PgErrorCode | null {
  let cur: any = err;
  const seen = new Set<unknown>();

  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);

    // PostgresError 的错误码在 errno 上（Bun 的实现），标准实现则在 code 上
    const code = cur.errno ?? cur.code;
    if (typeof code === "string" && /^\d{5}$/.test(code)) return code;

    // 唯一约束冲突
    if (typeof cur.constraint === "string" && cur.constraint) return "23505";

    cur = cur.cause ?? cur.originalError ?? null;
  }
  return null;
}

/** 约束名（用于生成可读提示） */
export function pgConstraint(err: unknown): string | null {
  let cur: any = err;
  const seen = new Set<unknown>();
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    if (typeof cur.constraint === "string" && cur.constraint) return cur.constraint;
    cur = cur.cause ?? cur.originalError ?? null;
  }
  return null;
}

/** 是否是唯一约束冲突 */
export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === "23505";
}

/** 是否是 CHECK 约束冲突 */
export function isCheckViolation(err: unknown): boolean {
  return pgErrorCode(err) === "23514";
}

/** 是否是外键冲突（引用了不存在的记录，或还有子记录不让删） */
export function isForeignKeyViolation(err: unknown): boolean {
  return pgErrorCode(err) === "23503";
}