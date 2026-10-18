import { STATUSES, SOURCES } from "../db/schema";

/** 各字段的长度上限（与数据库 CHECK 约束保持一致） */
export const LIMITS = {
  customerName: 60,
  contactName: 30,
  phone: 20,
  demand: 1000,
} as const;

export type FieldName = keyof typeof LIMITS;

/** 手机号：中国大陆 11 位，1 开头，第二位 3-9 */
const PHONE_RE = /^1[3-9]\d{9}$/;

/** 单个字段的校验规则 */
export const RULES: Record<FieldName, { label: string; test: (v: string) => boolean; hint: string }> = {
  customerName: {
    label: "客户名",
    test: (v) => v.length > 0 && v.length <= LIMITS.customerName,
    hint: `必填，不超过 ${LIMITS.customerName} 字`,
  },
  contactName: {
    label: "联系人",
    test: (v) => v.length > 0 && v.length <= LIMITS.contactName,
    hint: `必填，不超过 ${LIMITS.contactName} 字`,
  },
  phone: {
    label: "手机",
    test: (v) => PHONE_RE.test(v),
    hint: "必须是 1 开头的 11 位手机号",
  },
  demand: {
    label: "需求描述",
    test: (v) => v.length > 0 && v.length <= LIMITS.demand,
    hint: `必填，不超过 ${LIMITS.demand} 字`,
  },
};

export interface ValidationResult {
  ok: boolean;
  /** 第一条错误信息，用于直接展示 */
  message: string;
}

/** 校验整份表单 */
export function validateCustomer(input: {
  customerName: string;
  contactName: string;
  phone: string;
  demand: string;
  status: string;
}): ValidationResult {
  for (const field of Object.keys(RULES) as FieldName[]) {
    const rule = RULES[field];
    const value = input[field];
    if (!rule.test(value)) {
      return { ok: false, message: `${rule.label}：${rule.hint}` };
    }
  }

  // 状态必须在白名单内（防止前端被绕过）
  if (!STATUSES.includes(input.status as never)) {
    return { ok: false, message: `状态：只能是「${STATUSES.join("、")}」之一` };
  }

  return { ok: true, message: "" };
}

/* ─────────────────── 客户档案 ─────────────────── */

/** 客户档案各字段的长度上限（与数据库 CHECK 约束一致） */
export const PROFILE_LIMITS = {
  companyName: 60,
  contactName: 30,
  position: 30,
  phone: 20,
  email: 100,
  industry: 30,
  address: 200,
  remark: 500,
} as const;

export type ProfileField = keyof typeof PROFILE_LIMITS;

/** 简单邮箱格式检查 */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * 客户档案字段规则
 * optional=true 表示允许为空，为空时跳过格式校验但仍要查长度
 */
export const PROFILE_RULES: Record<
  ProfileField,
  { label: string; required: boolean; test?: (v: string) => boolean; hint: string }
> = {
  companyName: { label: "公司名称", required: true, hint: `必填，不超过 ${PROFILE_LIMITS.companyName} 字` },
  contactName: { label: "联系人", required: true, hint: `必填，不超过 ${PROFILE_LIMITS.contactName} 字` },
  position: { label: "职位", required: false, hint: `选填，不超过 ${PROFILE_LIMITS.position} 字` },
  phone: {
    label: "手机",
    required: true,
    // ⚠️ 必须用箭头函数包一层，不能直接写 PHONE_RE.test
    //    —— 正则的 test 方法脱离 this 调用会抛 "can only be called on a RegExp object"
    test: (v) => PHONE_RE.test(v),
    hint: "必填，1 开头的 11 位手机号",
  },
  email: {
    label: "邮箱",
    required: false,
    test: (v) => EMAIL_RE.test(v),
    hint: "选填，格式如 name@example.com",
  },
  industry: { label: "行业", required: false, hint: `选填，不超过 ${PROFILE_LIMITS.industry} 字` },
  address: { label: "地址", required: false, hint: `选填，不超过 ${PROFILE_LIMITS.address} 字` },
  remark: { label: "备注", required: false, hint: `选填，不超过 ${PROFILE_LIMITS.remark} 字` },
};

export interface ProfileInput {
  companyName: string;
  contactName: string;
  position: string;
  phone: string;
  email: string;
  industry: string;
  source: string;
  address: string;
  remark: string;
}

/** 校验客户档案表单 */
export function validateProfile(input: ProfileInput): ValidationResult {
  for (const field of Object.keys(PROFILE_RULES) as ProfileField[]) {
    const rule = PROFILE_RULES[field];
    const value = input[field];

    if (value === "") {
      if (rule.required) return { ok: false, message: `${rule.label}：必填` };
      continue; // 选填字段留空直接跳过
    }

    if (value.length > PROFILE_LIMITS[field]) {
      return { ok: false, message: `${rule.label}：${rule.hint}` };
    }
    if (rule.test && !rule.test(value)) {
      return { ok: false, message: `${rule.label}：${rule.hint}` };
    }
  }

  if (!SOURCES.includes(input.source as never)) {
    return { ok: false, message: `来源：只能是「${SOURCES.join("、")}」之一` };
  }

  return { ok: true, message: "" };
}