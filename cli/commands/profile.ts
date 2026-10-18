/** CLI —— 客户档案（customer_profiles） */
import {
  getProfileList,
  getProfilesForExport,
  getProfileById,
  createProfile,
  updateProfile,
  deleteProfiles,
  PAGE_SIZE,
  type ProfileRow,
} from "../../models/profile";
import { SOURCES } from "../../db/schema";
import { validateProfile, type ProfileInput } from "../../utils/validate";
import { oneLine } from "../../utils/text";
import { toCsv } from "../../utils/csv";
import { parseArgs, str, bool, num, type ParsedArgs } from "../args";
import { table, json, keyValue, ok, fail, heading } from "../format";
import { reportDbError } from "../errors";

const entity = "客户档案";

/** 选项 → 表单字段 */
function inputFromFlags(a: ParsedArgs): Partial<ProfileInput> {
  const out: Partial<ProfileInput> = {};
  const set = (k: keyof ProfileInput, flag: string) => {
    if (typeof a.flags[flag] === "string") out[k] = a.flags[flag] as never;
  };
  set("companyName", "company");
  set("contactName", "contact");
  set("position", "position");
  set("phone", "phone");
  set("email", "email");
  set("industry", "industry");
  set("source", "source");
  set("address", "address");
  set("remark", "remark");
  return out;
}

/** 空串 → null，保持「无值」语义 */
function toRow(v: ProfileInput | ProfileRow) {
  return {
    ...v,
    position: v.position || null,
    email: v.email || null,
    industry: v.industry || null,
    address: v.address || null,
    remark: v.remark || null,
  };
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
  const data = await getProfileList({
    keyword: str(flags, "keyword") || str(flags, "k"),
    source: str(flags, "source"),
    industry: str(flags, "industry"),
    page: num(flags, "page", 1),
    pageSize: num(flags, "limit", PAGE_SIZE),
  });

  if (asJson) {
    json({ total: data.total, page: data.page, totalPages: data.totalPages, list: data.list });
    return 0;
  }

  heading(`${entity}列表（第 ${data.page}/${data.totalPages} 页，共 ${data.total} 条）`);
  table(
    data.list.map((p) => ({
      ID: p.id,
      公司: p.companyName,
      联系人: p.contactName,
      手机: p.phone,
      行业: p.industry,
      来源: p.source,
      备注: oneLine(p.remark, 18),
      建档: p.createdAt.toISOString().slice(0, 10),
    })),
  );
  return 0;
}

/* ────────────────────── get ────────────────────── */
async function cmdGet(pos: string[], asJson: boolean): Promise<number> {
  const id = Number(pos[1]);
  if (!Number.isInteger(id) || id <= 0) {
    fail("用法：profile get <id>");
    return 1;
  }

  const p = await getProfileById(id);
  if (!p) {
    fail(`未找到档案 #${id}`);
    return 1;
  }

  if (asJson) {
    json(p);
    return 0;
  }

  keyValue([
    ["编号", p.id],
    ["公司名称", p.companyName],
    ["联系人", p.contactName],
    ["职位", p.position],
    ["手机", p.phone],
    ["邮箱", p.email],
    ["行业", p.industry],
    ["来源", p.source],
    ["地址", p.address],
    ["备注", p.remark],
    ["建档时间", p.createdAt.toISOString().slice(0, 19).replace("T", " ")],
  ]);
  return 0;
}

/* ────────────────────── add ────────────────────── */
async function cmdAdd(flags: ParsedArgs["flags"], asJson: boolean): Promise<number> {
  const input: ProfileInput = {
    companyName: str(flags, "company"),
    contactName: str(flags, "contact"),
    position: str(flags, "position"),
    phone: str(flags, "phone"),
    email: str(flags, "email"),
    industry: str(flags, "industry"),
    source: str(flags, "source") || SOURCES[0],
    address: str(flags, "address"),
    remark: str(flags, "remark"),
  };

  const { ok: valid, message } = validateProfile(input);
  if (!valid) {
    fail(message);
    return 1;
  }

  try {
    const created = await createProfile(toRow(input));

    if (asJson) {
      json(created);
      return 0;
    }
    ok(`已建档 #${created.id}（${created.companyName}）`);
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
    fail("用法：profile update <id> [--company X] [--contact Y] [--phone Z] [--email E] [--remark R] ...");
    return 1;
  }

  const existing = await getProfileById(id);
  if (!existing) {
    fail(`未找到档案 #${id}`);
    return 1;
  }

  const patch = inputFromFlags({ _: [], flags });
  const merged: ProfileInput = {
    companyName: patch.companyName ?? existing.companyName,
    contactName: patch.contactName ?? existing.contactName,
    position: patch.position ?? existing.position ?? "",
    phone: patch.phone ?? existing.phone,
    email: patch.email ?? existing.email ?? "",
    industry: patch.industry ?? existing.industry ?? "",
    source: patch.source ?? existing.source,
    address: patch.address ?? existing.address ?? "",
    remark: patch.remark ?? existing.remark ?? "",
  };

  const { ok: valid, message } = validateProfile(merged);
  if (!valid) {
    fail(message);
    return 1;
  }

  try {
    const updated = await updateProfile(id, toRow(merged));

    if (asJson) {
      json(updated);
      return 0;
    }
    ok(`已更新档案 #${id}`);
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
    fail("用法：profile remove <id> [id2 ...] 或 profile remove 1,2,3");
    return 1;
  }

  if (!bool(flags, "force") && !bool(flags, "yes") && !bool(flags, "f")) {
    const rows = await Promise.all(ids.map((id) => getProfileById(id)));
    const found = rows.filter((r): r is NonNullable<typeof r> => Boolean(r));
    if (found.length === 0) {
      fail("指定的记录都不存在");
      return 1;
    }
    console.log("将要删除：");
    table(found.map((p) => ({ ID: p.id, 公司: p.companyName, 联系人: p.contactName })));
    console.log("\n加 --force 跳过确认。");
    return 1;
  }

  const deleted = await deleteProfiles(ids);

  if (asJson) {
    json({ deleted: deleted.length, ids: deleted.map((d) => d.id) });
    return 0;
  }
  ok(`已删除 ${deleted.length} 份档案${deleted.length < ids.length ? `（${ids.length - deleted.length} 条不存在）` : ""}`);
  return 0;
}

/* ────────────────────── export ────────────────────── */
async function cmdExport(flags: ParsedArgs["flags"]): Promise<number> {
  const rows = await getProfilesForExport({
    keyword: str(flags, "keyword") || str(flags, "k"),
    source: str(flags, "source"),
    industry: str(flags, "industry"),
  });

  const t: unknown[][] = [
    ["编号", "公司名称", "联系人", "职位", "手机", "邮箱", "行业", "来源", "地址", "备注", "建档时间"],
    ...rows.map((p) => [
      p.id, p.companyName, p.contactName, p.position, p.phone,
      p.email, p.industry, p.source, p.address, p.remark,
      p.createdAt.toISOString().slice(0, 19).replace("T", " "),
    ]),
  ];

  const csv = "﻿" + toCsv(t);
  const out = str(flags, "out") || str(flags, "o");

  if (out) {
    await Bun.write(out, csv);
    ok(`已导出 ${rows.length} 条到 ${out}`);
  } else {
    process.stdout.write(csv);
  }
  return 0;
}