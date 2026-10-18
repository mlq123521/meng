# 客户管理（MVC 教学 / MVP）

基于 **Bun + Express 5 + EJS + Drizzle ORM + PostgreSQL** 的客户管理系统，采用 MVC 分层结构。

包含两个业务模块：**需求登记** 与 **客户档案**，两者是主从关系 —— 一个客户档案下可以挂多条需求。

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
| `bun run test:cli` | CLI 工具（63 项） |
| `bun run cli` | 命令行工具，见下文 |

---

## 命令行工具

CLI 直连数据库，**不需要启动 Web 服务**。

```bash
bun run cli --help              # 总体帮助
bun run cli demand --help       # 需求登记字段说明
bun run cli profile --help      # 客户档案字段说明
```

### 模块与命令

| 模块 | 说明 |
|------|------|
| `demand` | 需求登记 |
| `profile` | 客户档案 |

两个模块都支持：`list` / `get <id>` / `add` / `update <id>` / `remove <id...>` / `export`

### 常用示例

```bash
# 列表与筛选
bun run cli demand list
bun run cli demand list --status 待跟进 --keyword 云启
bun run cli demand list --page 2 --limit 20 --json

# 查看 / 新增 / 修改
bun run cli demand get 1
bun run cli demand profiles                  # 先看可选的客户档案 id
bun run cli demand add --profile 1 --demand 需要一套CRM系统 --remark 老客户引荐
bun run cli demand update 1 --status 已成交     # 只改传入的字段

# 批量删除（先预览，确认后加 --force）
bun run cli demand remove 3 4 5
bun run cli demand remove 3,4,5 --force

# 导出 CSV
bun run cli demand export -o demands.csv

# 客户档案
bun run cli profile list --source 展会
bun run cli profile add --company 某科技 --contact 李总 --phone 13900139000 --industry 互联网

# 脚本里用 JSON
bun run cli profile list --json | jq '.list[] | select(.source=="展会")'
```

### 设计要点

| 点 | 说明 |
|----|------|
| 复用 models/utils | 与 Web 端共用数据访问和校验逻辑，不重复实现 |
| `--json` | 表格给人看，JSON 给脚本用 |
| 批量删除默认需确认 | 不加 `--force` 只打印预览并以非 0 退出，避免手滑删错 |
| 中文列宽对齐 | `cli/format.ts` 计算全角字符占 2 列，否则表格会错位 |
| 约束错误转人话 | 唯一约束冲突输出「该手机号已被其他档案占用」而不是 Drizzle 原始异常 |

> ⚠️ Windows 下 `bun run cli ... --keyword "%"` 会被 cmd.exe 拦下（`%` 是特殊字符）。
> 这是 shell 层面的限制。**MCP 方式没有这个问题** —— 它直接调函数，不经过 shell。

---

## MCP Server

把数据访问能力暴露给 AI 助手（OpenCode、Claude Desktop 等任意 MCP 客户端）。

```bash
bun run mcp              # 手动启动（stdio）
bun run test:mcp         # 66 项集成测试
```

注册到 OpenCode（已配好，见 `.opencode/opencode.jsonc`）：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "crm": {
        "type": "local",
        "command": ["bun", "run", "--env-file=.env", "mcp/server.ts"],
        "cwd": "E:/mytest"
      }
    }
  }
}
```

### 11 个工具

| 模块 | 工具 | 说明 |
|------|------|------|
| 客户档案 | `profile_list` | 关键词 / 来源 / 行业筛选 + 分页 |
| | `profile_get` | 详情，**含该客户名下的需求列表** |
| | `profile_add` | 建档 |
| | `profile_update` | 改档案，只传要改的字段 |
| | `profile_delete` | 删档案（两段式确认） |
| | `profile_pick` | 轻量查询，只返回 id/公司/联系人/手机 |
| 需求登记 | `demand_list` | 关键词 / 状态 / 客户筛选 + 分页 |
| | `demand_get` | 详情，含客户信息 |
| | `demand_add` | 登记需求，`profileId` 必填 |
| | `demand_update` | 改需求，只传要改的字段 |
| | `demand_delete` | 删需求（两段式确认） |

### 设计要点

| 点 | 说明 |
|----|------|
| 直接 import models | **不经过 shell** —— 中文参数、引号、`%` 都不会被 PowerShell/cmd 拦下，也不用拼命令行字符串 |
| 双层校验 | zod schema 在协议层拦一次，`utils/validate.ts` 在业务层再拦一次 |
| 错误翻译成中文 | 23505 → 「手机号已存在」，23503 → 「客户档案不存在」，而不是抛原始 DB 异常 |
| 删除两段式 | 第一次调用只返回待删清单（连同会被连带删除的需求数）；用户确认后传 `confirm=true` 才真删 |
| stdout 只走协议 | 任何日志都写 stderr，`console.log` 会污染 JSON-RPC 帧 |
| 复用同一套校验 | 和 Web 端、CLI 走完全相同的规则，不会出现「MCP 能过但页面提交失败」 |

### 删档案时的连带影响

`profile_delete` 的预览会显式告诉你会连带删掉多少条需求：

```jsonc
// 第一次调用（不带 confirm）
{
  "ok": false,
  "needsConfirm": true,
  "message": "这是预览，尚未删除。将删除 1 份档案及其名下全部需求。确认无误后，用相同的 ids 再调用一次并传 confirm=true。",
  "targets": [
    { "id": 4, "companyName": "杭州云启科技有限公司", "demandCount": 1 }
  ]
}
```

---

## 功能

### 需求登记 `/`

| 功能 | 说明 |
|------|------|
| 增删改查 | 新建、详情、编辑、删除 |
| 归属客户 | **每条需求必须挂在一个客户档案下**（外键 NOT NULL） |
| 搜索 | 关键词同时匹配客户名 / 联系人 / 手机 / 需求描述 / 备注 |
| 筛选 | 按状态（待跟进 / 沟通中 / 已报价 / 已成交 / 已流失） |
| 分页 | 每页 10 条，页码越界自动回退 |
| 导出 | CSV 全量导出，继承当前筛选条件 |

### 客户档案 `/profiles`

| 功能 | 说明 |
|------|------|
| 建档 | 建档、详情、编辑、删除 |
| 搜索 | 关键词匹配公司 / 联系人 / 手机 / 邮箱 / 职位 |
| 筛选 | 按来源渠道、所属行业 |
| 分页 | 每页 10 条 |
| 导出 | CSV 全量导出 |
| **导入** | CSV 批量导入，按手机号 upsert |
| **名下需求** | 详情页内嵌该客户的需求列表，可直接跳过去登记一条 |

### 两张表的关系

```
customer_profiles（客户档案，主表）
   │ 1
   │
   │ N
demands（需求登记，子表，profile_id NOT NULL → customer_profiles.id ON DELETE CASCADE)
```

- **一个客户档案可以有多条需求**，详情页直接看到名下全部需求
- 需求表**不冗余存客户名 / 联系人 / 手机**，一律 join 档案表取 —— 单一事实来源，改一次客户名，需求列表同步更新，不会出现「档案叫 A、需求叫 A 公司」的不一致
- 登记需求时如果一个客户档案都没有，会引导先去建档（`views/demandNoProfile.ejs`）
- 删除客户档案会**级联删除**其名下全部需求，删除确认框里会提示「其下的 N 条需求也会一并删除」

> 从档案详情页点「+ 登记需求」会带上 `?profileId=N`，表单自动预选中该客户。

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

---

## 项目结构

```
.
├─ index.ts                入口：中间件、路由、错误处理
├─ drizzle.config.ts       Drizzle Kit 配置
├─ .env.example            环境变量模板
│
├─ db/                     ORM 底座
│  ├─ schema.ts            表结构 + CHECK 约束 + 外键 + 枚举常量
│  ├─ index.ts             数据库连接实例
│  └─ migrate-demands.ts   一次性迁移：customers → demands（已执行，可删）
│
├─ models/                 M —— 数据访问
│  ├─ demand.ts            需求登记（含 join 客户档案）
│  └─ profile.ts           客户档案 + CSV 导入 + 批次回滚
│
├─ controllers/            C —— 业务编排
│  ├─ demandController.ts
│  └─ profileController.ts
│
├─ routes/                 R —— 路由表
│  ├─ index.ts             总入口，合并挂载各模块
│  ├─ demand.ts
│  └─ profile.ts
│
├─ cli/                    命令行入口（直连数据库，不依赖 Web 服务）
│  ├─ index.ts
│  ├─ args.ts / format.ts / errors.ts
│  └─ commands/            demand.ts / profile.ts
│
├─ mcp/
│  └─ server.ts            MCP Server：把 models/ 包装成 11 个工具
│
├─ middleware/
│  └─ errorHandler.ts      404 兜底 + 全局错误处理
│
├─ utils/
│  ├─ csv.ts               CSV 转义 + 公式注入防护
│  ├─ csvParser.ts         RFC4180 CSV 解析
│  ├─ like.ts              LIKE 通配符转义
│  ├─ pgError.ts           从 SQLSTATE 判断错误类型（23503/23505/23514）
│  ├─ text.ts              摘要 / 行数统计
│  └─ validate.ts          字段校验规则
│
├─ views/                  V —— EJS 模板
│  ├─ partials/nav.ejs     共用导航片段
│  ├─ demandList.ejs / demandForm.ejs / demandDetail.ejs / demandNoProfile.ejs
│  ├─ profileList.ejs / profileForm.ejs / profileDetail.ejs
│  ├─ profileImport.ejs / profileImportResult.ejs
│  ├─ recordNotFound.ejs
│  └─ error.ejs
│
├─ test/                   六套测试，共 398 项断言
│  ├─ smoke.ts / import.test.ts / atomic.test.ts
│  ├─ batch.test.ts / cli.test.ts / mcp.test.ts
│
└─ .opencode/
   └─ opencode.jsonc       注册 crm 这个 MCP server
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

### `demands`（需求登记）

| 约束 |
|------|
| `profile_id` **NOT NULL**，外键 → `customer_profiles(id)`，`ON DELETE CASCADE` |
| `demand` 1–1000 字 |
| `status` ∈ {待跟进, 沟通中, 已报价, 已成交, 已流失} |
| `remark` ≤ 500 字（可空） |

客户名 / 联系人 / 手机**不存在这张表**，join `customer_profiles` 取，所以不存在「两份数据对不上」的问题。

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
bun run dev            # 终端 1：启动服务
bun run test:all       # 终端 2：跑全部五套测试（需服务在运行）
```

六个套件共 **398 项断言**：

| 套件 | 项数 | 覆盖 |
|------|-----|------|
| `test/smoke.ts` | 179 | 21 个场景：CRUD、校验边界、外键约束、SQL 注入、XSS 转义、CSV 注入、分页越界、非法 id、并发写入、Unicode、摘要截断、备注字段 |
| `test/import.test.ts` | 43 | CSV 解析、表头容错、行数上限、upsert、错误行报告、公式注入防护 |
| `test/atomic.test.ts` | 18 | 导入的事务原子性与回滚 |
| `test/batch.test.ts` | 27 | 批次记录与撤销、500 行性能、**档案↔需求的关联与级联** |
| `test/cli.test.ts` | 65 | CLI 全命令、`--json`、批量删除的确认机制 |
| `test/mcp.test.ts` | 66 | MCP 协议握手、工具目录、双层校验、两段式删除、跨表搜索 |

测试数据自带清理逻辑，可重复运行且不留残留。

---

## 已知限制

- **无登录鉴权**：任何人都能读写全部数据，仅适合内网使用
- 删除为硬删除，无回收站（档案删除会级联删掉名下需求）

---

## 技术选型说明

| 选择 | 理由 |
|------|------|
| Bun | 内置 PostgreSQL 驱动、TypeScript 直跑、热重载 |
| Drizzle ORM | 纯 TS 无二进制、链式调用即 SQL、可推断类型 |
| EJS | Express 官方示例模板，语法直观 |
| CHECK 约束 | 数据库层兜底，防止绕过应用的脏数据 |

### ⚠️ 为什么 `pg` 在 devDependencies 里

应用代码**不依赖** `pg` —— 数据库连接走 Bun 内置驱动：

```ts
// db/index.ts
import { SQL } from "bun";
export const client = new SQL(url);   // Bun 内置
```

但 **`drizzle-kit`（`bun run db:push` / `db:generate`）跑在 Node 环境，不认识 Bun 的驱动**，需要 `pg` 才能连库：

```
To connect to Postgres database - please install either of 'pg', 'postgres', ...
```

所以：
- `pg` 放在 **devDependencies** —— 只有数据库工具链用，应用运行时不需要
- `@types/pg` 已删除 —— 代码零引用，加了也没用

> 排查死依赖时要注意：**CLI 工具的依赖不在源码里**，grep `import` 是找不全的。
> 判断标准应该是「删掉后 `bun run db:push` 和测试还能不能过」，而不是「源码有没有 import」。