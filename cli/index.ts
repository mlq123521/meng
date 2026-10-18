#!/usr/bin/env bun
/**
 * 客户管理 CLI
 *
 *   bun run cli <模块> <命令> [参数]
 *
 * 直连数据库，不依赖 Web 服务。
 */
import { client } from "../db";
import { displayWidth } from "./format";
import * as demand from "./commands/demand";
import * as profile from "./commands/profile";
import { fail, heading } from "./format";

const MODULES: Record<string, { run: (argv: string[]) => Promise<number>; desc: string }> = {
  demand: { run: demand.run, desc: "需求登记（挂在客户档案下）" },
  profile: { run: profile.run, desc: "客户档案" },
};

const HELP = `
客户管理 CLI —— 直接操作 PostgreSQL

用法
  bun run cli <模块> <命令> [参数]
  bun run cli --help

模块
  demand              需求登记（必须挂在客户档案下）
  profile             客户档案（公司/联系人/职位/手机/邮箱/行业/来源/地址/备注）

命令
  list                列表，支持筛选与分页
  get <id>            查看单条详情
  add                 新增
  update <id>         修改（只改显式传入的字段）
  remove <id...>      删除，支持批量；加 --force 跳过确认
  export              导出 CSV，默认打到 stdout，用 -o 文件名 写文件
  profiles            （仅 demand）列出可选的客户档案 id

通用选项
  --json              以 JSON 输出，便于脚本处理
  --help              查看帮助

示例
  # 列表与筛选
  bun run cli demand list
  bun run cli demand list --status 待跟进 --keyword 云启
  bun run cli demand list --page 2 --limit 20 --json

  # 查看 / 新增 / 修改
  bun run cli demand get 1
  bun run cli demand add --customer 杭州云启科技 --contact 王经理 \\
      --phone 13812345671 --demand 需要一套CRM系统 --remark 老客户引荐
  bun run cli demand update 1 --status 已成交
  bun run cli demand update 1 --remark "已报价15万，等待签约"

  # 批量删除（先预览，确认后加 --force）
  bun run cli demand remove 3 4 5
  bun run cli demand remove 3,4,5 --force

  # 客户档案
  bun run cli profile list --source 展会
  bun run cli profile add --company 某科技 --contact 李总 --phone 13900139000 --industry 互联网
  bun run cli profile export -o profiles.csv

  # 批量脚本处理
  bun run cli profile list --json | jq '.list[] | select(.source=="展会")'
`;

/** 参数说明表 */
const FIELD_HELP: Record<string, [string, string][]> = {
  demand: [
    ["--profile", "客户档案 ID（必填，用 demand profiles 查看）"],
    ["--demand", "需求描述"],
    ["--status", "状态：待跟进/沟通中/已报价/已成交/已流失"],
    ["--remark", "备注"],
  ],
  profile: [
    ["--company", "公司名称"],
    ["--contact", "联系人"],
    ["--position", "职位"],
    ["--phone", "手机（11 位）"],
    ["--email", "邮箱"],
    ["--industry", "行业"],
    ["--source", "来源：官网咨询/电话咨询/转介绍/展会/广告投放/其他"],
    ["--address", "地址"],
    ["--remark", "备注"],
  ],
};

function printModuleHelp(mod: string): void {
  heading(`${MODULES[mod].desc}（${mod}）`);
  console.log(HELP.split("示例")[0].trim());
  console.log(`\n${mod} 专用字段：`);
  for (const [flag, desc] of FIELD_HELP[mod]) {
    console.log(`  ${flag.padEnd(12)} ${desc}`);
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    console.log(HELP.trim());
    return 0;
  }

  const mod = argv[0];
  const entry = MODULES[mod];
  if (!entry) {
    fail(`未知模块「${mod}」。可用模块：${Object.keys(MODULES).join(" / ")}`);
    console.log(HELP.trim());
    return 1;
  }

  // 模块级帮助：bun run cli demand --help
  if (argv[1] === "--help" || argv[1] === "-h" || argv[1] === "help" || argv[1] === undefined) {
    printModuleHelp(mod);
    return 0;
  }

  return entry.run(argv.slice(1));
}

main()
  .then((code) => {
    client.close();
    process.exit(code);
  })
  .catch((err) => {
    console.error(`\n✘ 执行失败：${err?.message ?? err}`);
    if (process.env.DEBUG) console.error(err);
    client.close();
    process.exit(1);
  });