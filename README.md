# 客户管理（MVC 教学 / MVP）

基于 **Bun + Express 5 + EJS + Drizzle ORM + PostgreSQL** 的客户管理系统，采用 MVC 分层结构。

包含两个业务模块：**需求登记** 与 **客户档案**。

---

## 快速开始

### 环境要求

| 组件 | 版本 |
|------|------|
| [Bun](https://bun.sh) | ≥ 1.2（需要内置 PostgreSQL 支持） |
| [PostgreSQL](https://www.postgresql.org) | ≥ 12 |

### 安装依赖

```bash
bun install
```

### 配置数据库连接

```bash
cp .env.example .env
```

编辑 `.env`，填入你的数据库信息：

```env
DATABASE_URL=postgres://postgres:你的密码@localhost:5432/mydb
```

### 建库建表

```bash
# 建数据库
createdb -U postgres -h localhost mydb

# 按 db/schema.ts 生成表结构
bun run db:push
```

### 启动

```bash
bun run dev   # 热重载
```

打开 http://localhost:3000

---

## 常用命令

| 命令 | 说明 |
|------|------|
| `bun run dev` | 热重载启动（开发用） |
| `bun run start` | 普通启动 |
| `bun run db:push` | 改完 `db/schema.ts` 后同步表结构 |
| `bun run db:generate` | 生成迁移 SQL 文件 |
| `bun run db:migrate` | 执行迁移 |
| `bun run db:studio` | 启动网页版数据库客户端 |
| `bun run test:all` | 跑全部测试（需服务已启动） |
| `bun run test:smoke` | 通用功能冒烟 + 边界 + 安全（136 项） |
| `bun run test:import` | 导入功能专项（43 项） |
| `bun run test:atomic` | 事务原子性（18 项） |
| `bun run test:batch` | 批次回滚 + 性能（20 项） |

---

## 功能

### 需求登记 `/`

| 功能 | 说明 |
|------|------|
| 增删改查 | 新建、详情、编辑、删除 |
| 搜索 | 关键词匹配客户名 / 联系人 / 手机 / 需求描述 |
| 筛选 | 按状态（待跟进 / 沟通中 / 已报价 / 已成交 / 已流失） |
| 分页 | 每页 10 条，页码越界自动回退 |
| 导出 | CSV 全量导出，继承当前筛选条件 |

### 客户档案 `/profiles`

| 功能 | 说明 |
|------|------|
| 增删改查 | 建档、详情、编辑、删除 |
| 搜索 | 关键词匹配公司 / 联系人 / 手机 / 邮箱 / 职位 |
| 筛选 | 按来源渠道、所属行业 |
| 分页 | 每页 10 条 |
| 导出 | CSV 全量导出 |
| **导入** | CSV 批量导入，按手机号 upsert |

### 批量导入 `/profiles/import`

| 能力 | 说明 |
|------|------|
| 模板下载 | `/profiles/template.csv`，含表头与示例行 |
| 按手机号 upsert | 手机号已存在 → 更新；不存在 → 新增 |
| 整批一条 SQL | `INSERT ... ON CONFLICT (phone) DO UPDATE`，500 行实测约 250ms |
| 错误行报告 | 出错的行跳过，列出行号 + 原因，不影响其他行 |
| 行数上限 | 单次 500 行，超限直接拒绝且不写入任何数据 |
| 事务原子性 | 中途失败整批回滚，不会留下「导了一半」的数据 |
| **按批次回滚** | 每次导入生成批次号，事后随时撤销：删新增、还原覆盖 |
| 表头容错 | 「公司名」「客户名称」「company」等写法都能识别 |

回滚入口保留在导入页的**导入历史**里，关掉结果页也能撤销。已撤销的批次会标记为 `rolled_back`，不可重复撤销。

> 客户档案与需求登记目前是**两张独立的数据表**，尚未建立外键关联。

---

## 项目结构

```
.
├─ index.ts                入口：中间件、路由、错误处理
├─ drizzle.config.ts       Drizzle Kit 配置
├─ .env.example            环境变量模板
│
├─ db/                     ORM 底座
│  ├─ schema.ts            表结构 + CHECK 约束 + 枚举常量
│  └─ index.ts             数据库连接实例
│
├─ models/                 M —— 数据访问
│  ├─ customer.ts
│  └─ profile.ts
│
├─ controllers/            C —— 业务编排
│  ├─ customerController.ts
│  └─ profileController.ts
│
├─ routes/                 R —— 路由表
│  ├─ index.ts             总入口，合并挂载各模块
│  ├─ customer.ts
│  └─ profile.ts
│
├─ middleware/
│  └─ errorHandler.ts      404 兜底 + 全局错误处理
│
├─ utils/
│  ├─ csv.ts               CSV 转义 + 公式注入防护
│  ├─ like.ts              LIKE 通配符转义
│  └─ validate.ts          字段校验规则
│
├─ views/                  V —— EJS 模板
│  ├─ partials/nav.ejs     共用导航片段
│  ├─ customerList.ejs / customerForm.ejs / customerDetail.ejs
│  ├─ profileList.ejs / profileForm.ejs / profileDetail.ejs
│  ├─ customerNotFound.ejs
│  └─ error.ejs
│
└─ test/
   └─ smoke.ts             136 项冒烟 / 边界 / 安全测试
```

### 请求流程

```
HTTP 请求
   ↓
routes/        匹配 URL → 找到处理函数
   ↓
controllers/   调 Model 取数据、判分支、选视图
   ↓
models/        查数据库（Drizzle）
   ↓
db/            Bun SQL → PostgreSQL
   ↓
controllers/   res.render(view, data)
   ↓
views/         EJS 把 <%= %> 替换成实际值
   ↓
HTTP 响应
```

---

## 数据表约束

所有字段在**应用层和数据库层双重校验**，绕过应用直接写库也会被拦住。

### `customers`（需求登记）

| 约束 |
|------|
| `customer_name` 1–60 字 |
| `contact_name` 1–30 字 |
| `phone` 匹配 `^1[3-9][0-9]{9}$` |
| `demand` 1–1000 字 |
| `status` ∈ {待跟进, 沟通中, 已报价, 已成交, 已流失} |

### `customer_profiles`（客户档案）

| 约束 |
|------|
| `company_name` 1–60 字 |
| `contact_name` 1–30 字 |
| `phone` 匹配 `^1[3-9][0-9]{9}$` 且 **UNIQUE** |
| `email` 匹配邮箱格式（可空） |
| `position` ≤ 30 字（可空） |
| `industry` ≤ 30 字（可空） |
| `address` ≤ 200 字（可空） |
| `remark` ≤ 500 字（可空） |
| `source` ∈ {官网咨询, 电话咨询, 转介绍, 展会, 广告投放, 其他} |

### `import_batches` / `import_batch_items`（导入批次）

| 表 | 用途 |
|----|------|
| `import_batches` | 记录每次导入：文件名、行数、新增/更新/失败数、状态、时间 |
| `import_batch_items` | 每条变更的明细：`profileId`、动作（inserted/updated）、更新前的完整快照（jsonb） |

`phone` 上的 UNIQUE 约束有两个作用：
1. 业务上保证「一个手机号只对应一个客户」，手工建档重复时返回 409
2. 技术上作为 `ON CONFLICT (phone)` 的冲突目标，让整批导入只用一条 SQL

---

## 安全措施

| 措施 | 实现 |
|------|------|
| SQL 注入 | Drizzle 参数化查询；LIKE 通配符 `%` `_` 转义 + `ESCAPE` 子句 |
| XSS | EJS `<%= %>` 默认 HTML 转义 |
| CSV 公式注入 | 以 `=` `+` `-` `@` 开头的值前置单引号 |
| CSV 中文乱码 | 输出 UTF-8 BOM |
| 请求体过大 | 限制 100kb，超出返回 413 |
| 信息泄露 | 4xx 只记一行摘要，5xx 才打堆栈；生产环境不返回内部错误 |
| 点击劫持 | `X-Frame-Options: DENY` |
| MIME 嗅探 | `X-Content-Type-Options: nosniff` |
| 框架标识 | `app.disable("x-powered-by")` |
| 路径参数 | `id` 严格校验为正整数 |

---

## 测试

```bash
bun run dev            # 终端 1
bun run test:smoke     # 终端 2
```

覆盖 20 个场景、136 项断言，包括：CRUD、校验边界（60 vs 61 字、手机/邮箱格式）、SQL 注入、XSS 转义、CSV 注入、分页越界、非法 id、并发写入、Unicode、CSV 导出等。

测试数据自带清理逻辑，可重复运行且不留残留。

---

## 已知限制

- **无登录鉴权**：任何人都能读写全部数据，仅适合内网使用
- 客户档案与需求登记**未建立关联**
- 删除为硬删除，无回收站

---

## 技术选型说明

| 选择 | 理由 |
|------|------|
| Bun | 内置 PostgreSQL 驱动、TypeScript 直跑、热重载 |
| Drizzle ORM | 纯 TS 无二进制、链式调用即 SQL、可推断类型 |
| EJS | Express 官方示例模板，语法直观 |
| CHECK 约束 | 数据库层兜底，防止绕过应用的脏数据 |