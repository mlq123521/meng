/** CLI —— 需求登记（demands） */
import {
  getDemandList,
  getDemandsForExport,
  getDemandById,
  createDemand,
  updateDemand,
  deleteDemands,
  listProfilesForSelect,
  PAGE_SIZE,
} from "../../models/demand";
import { STATUSES } from "../../db/schema";
import { validateDemand } from "../../utils/validate";
import { isForeignKeyViolation } from "../../utils/pgError";
import { oneLine } from "../../utils/text";
import { toCsv } from "../../utils/csv";
import { parseArgs, str, bool, num, type ParsedArgs } from "../args";
import { table, json, keyValue, ok, fail, heading } from "../format";

const entity = "需求登记";

/** 选项 → 表单字段 */
function inputFromFlags(a: ParsedArgs) {
  const out: { profileId?: string; demand?: string; remark?: string; status?: string } = {};
  const set = (k: keyof typeof out, flag: string) => {
    if (typeof a.flags[flag] === "string") out[k] = a.flags[flag] as never;
  };
  set("profileId", "profile");
  set("demand", "demand");
  set("remark", "remark");
  set("status", "status");
  return out;
}

/** 把 id 解析为正整数 */
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
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
    case "profiles": return cmdProfiles(asJson); // 列出可选客户，方便查 id
    default:
      fail(`未知命令「${cmd}」。可用：list / get / add / update / remove / export / profiles`);
      return 1;
  }
}

/* ────────────────────── list ────────────────────── */
async function cmdList(flags: ParsedArgs["flags"], asJson: boolean): Promise<number> {
  const data = await getDemandList({
    keyword: str(flags, "keyword") || str(flags, "k"),
    status: str(flags, "status") || str(flags, "s"),
    page: num(flags, "page", 1),
    pageSize: num(flags, "limit", PAGE_SIZE),
  });

  if (asJson) {
    json({ total: data.total, page: data.page, totalPages: data.totalPages, list: data.list });
    return 0;
  }

  heading(`${entity}列表（第 ${data.page}/${data.totalPages} 页，共 ${data.total} 条）`);
  table(
    data.list.map((d) => ({
      ID: d.id,
      客户: d.companyName,
      联系人: d.contactName,
      手机: d.phone,
      状态: d.status,
      需求描述: oneLine(d.demand, 28),
      备注: oneLine(d.remark, 18),
      登记时间: d.createdAt.toISOString().slice(0, 16).replace("T", " "),
    })),
  );
  return 0;
}

/* ────────────────────── get ────────────────────── */
async function cmdGet(pos: string[], asJson: boolean): Promise<number> {
  const id = parseId(pos[1] ?? "");
  if (id === null) {
    fail("用法：demand get <id>");
    return 1;
  }

  const d = await getDemandById(id);
  if (!d) {
    fail(`未找到需求 #${id}`);
    return 1;
  }

  if (asJson) {
    json(d);
    return 0;
  }

  keyValue([
    ["需求编号", d.id],
    ["客户", d.companyName],
    ["联系人", d.contactName],
    ["手机", d.phone],
    ["档案编号", d.profileId],
    ["状态", d.status],
    ["需求描述", d.demand],
    ["备注", d.remark],
    ["登记时间", d.createdAt.toISOString().slice(0, 19).replace("T", " ")],
  ]);
  return 0;
}

/* ────────────────────── profiles（辅助命令） ────────────────────── */
async function cmdProfiles(asJson: boolean): Promise<number> {
  const list = await listProfilesForSelect();
  if (asJson) {
    json(list);
    return 0;
  }
  heading("可作为需求归属的客户档案");
  table(list.map((p) => ({ 档案ID: p.id, 公司: p.companyName, 联系人: p.contactName, 手机: p.phone })));
  console.log("\n用 --profile <档案ID> 指定需求归属的客户。");
  return 0;
}

/* ────────────────────── add ────────────────────── */
async function cmdAdd(flags: ParsedArgs["flags"], asJson: boolean): Promise<number> {
  const input = {
    profileId: str(flags, "profile"),
    demand: str(flags, "demand"),
    remark: str(flags, "remark"),
    status: str(flags, "status") || STATUSES[0],
  };

  const { ok: valid, message } = validateDemand(input);
  if (!valid) {
    fail(message);
    return 1;
  }

  try {
    const created = await createDemand({
      profileId: Number(input.profileId),
      demand: input.demand,
      remark: input.remark,
      status: input.status,
    });
    if (asJson) {
      json(created);
      return 0;
    }
    ok(`已登记需求 #${created.id}（${created.companyName}）`);
    return 0;
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      fail(`客户档案 #${input.profileId} 不存在。用 demand profiles 查看可用档案。`);
      return 1;
    }
    throw err;
  }
}

/* ────────────────────── update ────────────────────── */
async function cmdUpdate(pos: string[], flags: ParsedArgs["flags"], asJson: boolean): Promise<number> {
  const id = parseId(pos[1] ?? "");
  if (id === null) {
    fail("用法：demand update <id> [--profile P] [--demand D] [--status S] [--remark R]");
    return 1;
  }

  const existing = await getDemandById(id);
  if (!existing) {
    fail(`未找到需求 #${id}`);
    return 1;
  }

  const patch = inputFromFlags({ _: [], flags });
  const merged = {
    profileId: patch.profileId ?? String(existing.profileId),
    demand: patch.demand ?? existing.demand,
    remark: patch.remark ?? existing.remark ?? "",
    status: patch.status ?? existing.status,
  };

  const { ok: valid, message } = validateDemand(merged);
  if (!valid) {
    fail(message);
    return 1;
  }

  try {
    const updated = await updateDemand(id, {
      profileId: Number(merged.profileId),
      demand: merged.demand,
      remark: merged.remark,
      status: merged.status,
    });
    if (asJson) {
      json(updated);
      return 0;
    }
    ok(`已更新需求 #${id}`);
    return 0;
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      fail(`客户档案 #${merged.profileId} 不存在`);
      return 1;
    }
    throw err;
  }
}

/* ────────────────────── remove（支持批量） ────────────────────── */
async function cmdRemove(pos: string[], flags: ParsedArgs["flags"], asJson: boolean): Promise<number> {
  // 同时接受 `1 2 3` 和 `1,2,3`（PowerShell 会把逗号当数组分隔符）
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

  if (!bool(flags, "force") && !bool(flags, "yes") && !bool(flags, "f")) {
    const rows = await Promise.all(ids.map((id) => getDemandById(id)));
    const found = rows.filter((r): r is NonNullable<typeof r> => Boolean(r));
    if (found.length === 0) {
      fail("指定的记录都不存在");
      return 1;
    }
    console.log("将要删除：");
    table(found.map((d) => ({ ID: d.id, 客户: d.companyName, 需求: oneLine(d.demand, 24) })));
    console.log("\n加 --force 跳过确认，或逐条执行。");
    return 1;
  }

  const deleted = await deleteDemands(ids);

  if (asJson) {
    json({ deleted: deleted.length, ids: deleted.map((d) => d.id) });
    return 0;
  }
  ok(`已删除 ${deleted.length} 条需求${deleted.length < ids.length ? `（${ids.length - deleted.length} 条不存在）` : ""}`);
  return 0;
}

/* ────────────────────── export ────────────────────── */
async function cmdExport(flags: ParsedArgs["flags"]): Promise<number> {
  const rows = await getDemandsForExport({
    keyword: str(flags, "keyword") || str(flags, "k"),
    status: str(flags, "status") || str(flags, "s"),
  });

  const tableData: unknown[][] = [
    ["编号", "客户名", "联系人", "手机", "需求描述", "状态", "备注", "登记时间"],
    ...rows.map((d) => [
      d.id, d.companyName, d.contactName, d.phone,
      d.demand, d.status, d.remark,
      d.createdAt.toISOString().slice(0, 19).replace("T", " "),
    ]),
  ];

  const csv = "﻿" + toCsv(tableData);
  const out = str(flags, "out") || str(flags, "o");

  if (out) {
    await Bun.write(out, csv);
    ok(`已导出 ${rows.length} 条到 ${out}`);
  } else {
    process.stdout.write(csv);
  }
  return 0;
}