/** CLI —— 需求登记（customers） */
import {
  getCustomerList,
  getCustomersForExport,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomers,
  PAGE_SIZE,
  type CustomerInput,
} from "../../models/customer";
import { STATUSES } from "../../db/schema";
import { validateCustomer } from "../../utils/validate";
import { oneLine } from "../../utils/text";
import { toCsv } from "../../utils/csv";
import { parseArgs, str, bool, num, type ParsedArgs } from "../args";
import { table, json, keyValue, ok, fail, heading } from "../format";
import { reportDbError } from "../errors";

const entity = "需求登记";

/** 从选项拼出 CustomerInput，缺失的字段留空由调用方合并 */
export function inputFromFlags(a: ParsedArgs): Partial<CustomerInput> {
  const out: Partial<CustomerInput> = {};
  const set = (k: keyof CustomerInput, flag: string) => {
    if (typeof a.flags[flag] === "string") out[k] = a.flags[flag] as never;
  };
  set("customerName", "customer");
  set("contactName", "contact");
  set("phone", "phone");
  set("demand", "demand");
  set("remark", "remark");
  set("status", "status");
  return out;
}

export async function run(argv: string[]): Promise<number> {
  const { _: pos, flags } = parseArgs(argv);
  const cmd = pos[0] ?? "list";
  const asJson = bool(flags, "json");

  switch (cmd) {
    case "list": return cmdList(flags, asJson);
    case "get": return cmdGet(pos, asJson);
    case "add": return cmdAdd(flags, asJson);
    case "update": return cmdUpdate(pos, flags, asJson);
    case "remove":
    case "rm":
    case "delete": return cmdRemove(pos, flags, asJson);
    case "export": return cmdExport(flags);
    default:
      fail(`未知命令「${cmd}」。可用：list / get / add / update / remove / export`);
      return 1;
  }
}

/* ────────────────────── list ────────────────────── */
async function cmdList(flags: ParsedArgs["flags"], asJson: boolean): Promise<number> {
  const page = num(flags, "page", 1);
  const limit = num(flags, "limit", PAGE_SIZE);

  const data = await getCustomerList({
    keyword: str(flags, "keyword") || str(flags, "k"),
    status: str(flags, "status") || str(flags, "s"),
    page,
    pageSize: limit,
  });

  if (asJson) {
    json({ total: data.total, page: data.page, totalPages: data.totalPages, list: data.list });
    return 0;
  }

  heading(`${entity}列表（第 ${data.page}/${data.totalPages} 页，共 ${data.total} 条）`);
  table(
    data.list.map((c) => ({
      ID: c.id,
      客户名: c.customerName,
      联系人: c.contactName,
      手机: c.phone,
      状态: c.status,
      需求描述: oneLine(c.demand, 30),
      备注: oneLine(c.remark, 20),
      登记时间: c.createdAt.toISOString().slice(0, 16).replace("T", " "),
    })),
  );
  return 0;
}

/* ────────────────────── get ────────────────────── */
async function cmdGet(pos: string[], asJson: boolean): Promise<number> {
  const id = Number(pos[1]);
  if (!Number.isInteger(id) || id <= 0) {
    fail("用法：demand get <id>");
    return 1;
  }

  const c = await getCustomerById(id);
  if (!c) {
    fail(`未找到需求 #${id}`);
    return 1;
  }

  if (asJson) {
    json(c);
    return 0;
  }

  keyValue([
    ["编号", c.id],
    ["客户名", c.customerName],
    ["联系人", c.contactName],
    ["手机", c.phone],
    ["状态", c.status],
    ["需求描述", c.demand],
    ["备注", c.remark],
    ["登记时间", c.createdAt.toISOString().slice(0, 19).replace("T", " ")],
  ]);
  return 0;
}

/* ────────────────────── add ────────────────────── */
async function cmdAdd(flags: ParsedArgs["flags"], asJson: boolean): Promise<number> {
  const input: CustomerInput = {
    customerName: str(flags, "customer"),
    contactName: str(flags, "contact"),
    phone: str(flags, "phone"),
    demand: str(flags, "demand"),
    remark: str(flags, "remark"),
    status: str(flags, "status") || STATUSES[0],
  };

  const { ok: valid, message } = validateCustomer(input);
  if (!valid) {
    fail(message);
    return 1;
  }

  try {
    const created = await createCustomer({ ...input, remark: input.remark || null });

    if (asJson) {
      json(created);
      return 0;
    }
    ok(`已登记需求 #${created.id}（${created.customerName}）`);
    return 0;
  } catch (err) {
    if (reportDbError(err)) return 1;
    throw err;
  }
}

/* ────────────────────── update ────────────────────── */
async function cmdUpdate(pos: string[], flags: ParsedArgs["flags"], asJson: boolean): Promise<number> {
  const id = Number(pos[1]);
  if (!Number.isInteger(id) || id <= 0) {
    fail("用法：demand update <id> [--customer X] [--contact Y] [--phone Z] [--demand D] [--status S] [--remark R]");
    return 1;
  }

  const existing = await getCustomerById(id);
  if (!existing) {
    fail(`未找到需求 #${id}`);
    return 1;
  }

  // 只更新显式传入的字段，其余沿用原值
  const patch = inputFromFlags({ _: [], flags });
  const merged: CustomerInput = {
    customerName: patch.customerName ?? existing.customerName,
    contactName: patch.contactName ?? existing.contactName,
    phone: patch.phone ?? existing.phone,
    demand: patch.demand ?? existing.demand,
    remark: patch.remark ?? existing.remark ?? "",
    status: patch.status ?? existing.status,
  };

  const { ok: valid, message } = validateCustomer(merged);
  if (!valid) {
    fail(message);
    return 1;
  }

  try {
    const updated = await updateCustomer(id, { ...merged, remark: merged.remark || null });

    if (asJson) {
      json(updated);
      return 0;
    }
    ok(`已更新需求 #${id}`);
    return 0;
  } catch (err) {
    if (reportDbError(err)) return 1;
    throw err;
  }
}

/* ────────────────────── remove（支持批量） ────────────────────── */
async function cmdRemove(pos: string[], flags: ParsedArgs["flags"], asJson: boolean): Promise<number> {
  // 同时接受 `1 2 3` 和 `1,2,3`
  // （PowerShell 会把逗号当数组分隔符，2,3,4 实际传进来是 "2 3 4"）
  const ids = pos
    .slice(1)
    .flatMap((s) => s.split(/[,\s]+/))
    .map((s) => s.trim())
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

  if (ids.length === 0) {
    fail("用法：demand remove <id> [id2 ...] 或 demand remove 1,2,3");
    return 1;
  }

  const force = bool(flags, "force") || bool(flags, "f");

  if (!force && !bool(flags, "yes") && !bool(flags, "y")) {
    const rows = await Promise.all(ids.map((id) => getCustomerById(id)));
    const found = rows.filter((r): r is NonNullable<typeof r> => Boolean(r));
    if (found.length === 0) {
      fail("指定的记录都不存在");
      return 1;
    }
    console.log("将要删除：");
    table(found.map((c) => ({ ID: c.id, 客户名: c.customerName, 需求: oneLine(c.demand, 24) })));
    console.log("\n加 --force 跳过确认，或逐条执行。");
    return 1;
  }

  const deleted = await deleteCustomers(ids);

  if (asJson) {
    json({ deleted: deleted.length, ids: deleted.map((d) => d.id) });
    return 0;
  }
  ok(`已删除 ${deleted.length} 条需求${deleted.length < ids.length ? `（${ids.length - deleted.length} 条不存在）` : ""}`);
  return 0;
}

/* ────────────────────── export ────────────────────── */
async function cmdExport(flags: ParsedArgs["flags"]): Promise<number> {
  const rows = await getCustomersForExport({
    keyword: str(flags, "keyword") || str(flags, "k"),
    status: str(flags, "status") || str(flags, "s"),
  });

  const table2: unknown[][] = [
    ["编号", "客户名", "联系人", "手机", "需求描述", "状态", "备注", "登记时间"],
    ...rows.map((c) => [
      c.id, c.customerName, c.contactName, c.phone,
      c.demand, c.status, c.remark,
      c.createdAt.toISOString().slice(0, 19).replace("T", " "),
    ]),
  ];

  const csv = "﻿" + toCsv(table2);
  const out = str(flags, "out") || str(flags, "o");

  if (out) {
    await Bun.write(out, csv);
    ok(`已导出 ${rows.length} 条到 ${out}`);
  } else {
    process.stdout.write(csv);
  }
  return 0;
}