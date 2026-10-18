import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  check,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** 需求状态的可选值（先定义，CHECK 约束要用） */
export const STATUSES = ["待跟进", "沟通中", "已报价", "已成交", "已流失"] as const;
export type Status = (typeof STATUSES)[number];

/**
 * 生成 SQL 片段：ARRAY['待跟进','沟通中',...]
 * 用 sql.raw 内联字面量 —— 因为 drizzle-kit 生成 DDL 时不会给 CHECK 约束传参。
 * ⚠️ sql.raw 是字符串拼接，只有 STATUSES 这类「硬编码常量」才安全，
 *    绝不能把用户输入塞进来。
 */
const statusArray = () => sql.raw(`ARRAY[${STATUSES.map((s) => `'${s}'`).join(",")}]`);

/** 客户来源渠道 */
export const SOURCES = ["官网咨询", "电话咨询", "转介绍", "展会", "广告投放", "其他"] as const;
export type Source = (typeof SOURCES)[number];

const sourceArray = () => sql.raw(`ARRAY[${SOURCES.map((s) => `'${s}'`).join(",")}]`);

/**
 * customers 表 —— 客户需求登记
 * 左侧 = TypeScript 变量名，右侧字符串 = 数据库里的真实列名
 * 长度和状态都用 CHECK 约束在数据库层兜底，
 * 即使有人绕过应用层直接写库，也插不进脏数据
 */
export const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    customerName: text("customer_name").notNull(),
    contactName: text("contact_name").notNull(),
    phone: text("phone").notNull(),
    demand: text("demand").notNull(),
    status: text("status").notNull().default("待跟进"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    check("customers_customer_name_len", sql`char_length(${t.customerName}) BETWEEN 1 AND 60`),
    check("customers_contact_name_len", sql`char_length(${t.contactName}) BETWEEN 1 AND 30`),
    check("customers_phone_format", sql`${t.phone} ~ '^1[3-9][0-9]{9}$'`),
    check("customers_demand_len", sql`char_length(${t.demand}) BETWEEN 1 AND 1000`),
    check("customers_status_valid", sql`${t.status} = ANY (${statusArray()})`),
  ],
);

/** 查询出来的对象长这样 */
export type Customer = typeof customers.$inferSelect;
/** 新建时能传的对象长这样（id / createdAt 由数据库生成，不用传） */
export type NewCustomer = typeof customers.$inferInsert;

/**
 * customer_profiles 表 —— 客户档案
 * 与 customers（需求登记）是两张独立的表，目前没有外键关联。
 */
export const customerProfiles = pgTable(
  "customer_profiles",
  {
    id: serial("id").primaryKey(),
    companyName: text("company_name").notNull(),
    contactName: text("contact_name").notNull(),
    position: text("position"),
    // ⚠️ UNIQUE：手机号是客户的唯一标识，导入时的 upsert 也依赖它
    phone: text("phone").notNull().unique(),
    email: text("email"),
    industry: text("industry"),
    source: text("source").notNull().default("其他"),
    address: text("address"),
    remark: text("remark"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    check("profiles_company_len", sql`char_length(${t.companyName}) BETWEEN 1 AND 60`),
    check("profiles_contact_len", sql`char_length(${t.contactName}) BETWEEN 1 AND 30`),
    check("profiles_phone_format", sql`${t.phone} ~ '^1[3-9][0-9]{9}$'`),
    check("profiles_email_format", sql`${t.email} IS NULL OR ${t.email} ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'`),
    check("profiles_position_len", sql`${t.position} IS NULL OR char_length(${t.position}) <= 30`),
    check("profiles_industry_len", sql`${t.industry} IS NULL OR char_length(${t.industry}) <= 30`),
    check("profiles_address_len", sql`${t.address} IS NULL OR char_length(${t.address}) <= 200`),
    check("profiles_remark_len", sql`${t.remark} IS NULL OR char_length(${t.remark}) <= 500`),
    check("profiles_source_valid", sql`${t.source} = ANY (${sourceArray()})`),
  ],
);

/** 查询出来的客户档案 */
export type CustomerProfile = typeof customerProfiles.$inferSelect;
/** 新建客户档案时能传的对象 */
export type NewCustomerProfile = typeof customerProfiles.$inferInsert;

/* ═══════════════ 导入批次（支持事后回滚） ═══════════════ */

/** 一次 CSV 导入 = 一个批次 */
export const importBatches = pgTable(
  "import_batches",
  {
    id: serial("id").primaryKey(),
    fileName: text("file_name").notNull(),
    totalRows: integer("total_rows").notNull(),
    insertedCount: integer("inserted_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    /** committed = 已生效；rolled_back = 已撤销 */
    status: text("status").notNull().default("committed"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    rolledBackAt: timestamp("rolled_back_at"),
  },
  (t) => [
    check("batches_status_valid", sql`${t.status} = ANY (ARRAY['committed','rolled_back'])`),
  ],
);

/** 批次内的每条变更 —— 回滚时靠它精确还原 */
export const importBatchItems = pgTable(
  "import_batch_items",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    /** 涉及的档案 id */
    profileId: integer("profile_id").notNull(),
    /** inserted = 本次新增；updated = 本次覆盖了旧值 */
    action: text("action").notNull(),
    /** 更新前的整行快照（仅 action='updated' 时有值） */
    beforeData: jsonb("before_data"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    check("batch_items_action_valid", sql`${t.action} = ANY (ARRAY['inserted','updated'])`),
    index("batch_items_batch_idx").on(t.batchId),
  ],
);

export type ImportBatch = typeof importBatches.$inferSelect;
export type ImportBatchItem = typeof importBatchItems.$inferSelect;