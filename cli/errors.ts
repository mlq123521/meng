/** CLI 的数据库错误提示 */
import { isUniqueViolation, isCheckViolation, pgConstraint } from "../utils/pgError";
import { fail } from "./format";

/**
 * 把数据库异常转成人话
 * @returns true 表示已经提示过，调用方应直接返回错误码
 */
export function reportDbError(err: unknown): boolean {
  if (isUniqueViolation(err)) {
    const c = pgConstraint(err);
    if (c?.includes("phone")) {
      fail("该手机号已被其他档案占用（phone 有唯一约束）");
    } else {
      fail(`违反唯一约束：${c ?? "unknown"}`);
    }
    return true;
  }

  if (isCheckViolation(err)) {
    const c = pgConstraint(err);
    fail(`字段不符合数据库约束${c ? `（${c}）` : ""}`);
    return true;
  }

  return false;
}