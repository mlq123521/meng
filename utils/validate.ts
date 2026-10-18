import { STATUSES, SOURCES } from "../db/schema";

/** 各字段的长度上限（与数据库 CHECK 约束保持一致） */
export const LIMITS = {
  customerName: 60,
  contactName: 30,
  phone: 20,
  demand: 1000,
  remark: 500,
} as const;

/** 手机号：中国大陆 11 位，1 开头，第二位 3-9 */
const PHONE_RE = /^1[3-9]\d{9}$/;

export interface ValidationResult {
  ok: boolean;
  /** 第一条错误信息，用于直接展示 */
  message: string;
}

/** 需求（demands）表单校验 */
export interface DemandForm {
  profileId: string; // 从表单传来是字符串
  demand: string;
  remark: string;
  status: string;
}

/**
 * 校验需求表单
 * 客户档案是外键，这里只校验「选了没选、是不是数字」，
 * 真正的存在性由数据库外键兜底
 */
export function validateDemand(input: DemandForm): ValidationResult {
  const pid = Number(input.profileId);
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, message: "请选择一个客户档案" };
  }

  if (!input.demand || input.demand.length === 0) {
    return { ok: false, message: `需求描述：必填，不超过 ${LIMITS.demand} 字` };
  }
  if (input.demand.length > LIMITS.demand) {
    return { ok: false, message: `需求描述：必填，不超过 ${LIMITS.demand} 字` };
  }

  if (input.remark.length > LIMITS.remark) {
    return { ok: false, message: `备注：选填，不超过 ${LIMITS.remark} 字` };
  }

  if (!STATUSES.includes(input.status as never)) {
    return { ok: false, message: `状态：只能是「${STATUSES.join("、")}」之一` };
  }

  return { ok: true, message: "" };
}

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