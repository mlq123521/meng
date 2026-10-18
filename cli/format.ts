/** 终端输出格式化 */

/**
 * 计算字符串的显示宽度
 * 中文、日文、全角字符占 2 列，不加的话表格会错位
 */
export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    // 全角区间（CJK 统一表意文字、中日韩符号、全角形式）
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||   // 韩文字母
      (code >= 0x2e80 && code <= 0xa4cf) ||   // CJK 部首 ~ 彝文
      (code >= 0xac00 && code <= 0xd7a3) ||   // 韩文音节
      (code >= 0xf900 && code <= 0xfaff) ||   // CJK 兼容表意文字
      (code >= 0xfe30 && code <= 0xfe6f) ||   // CJK 兼容形式
      (code >= 0xff00 && code <= 0xff60) ||   // 全角 ASCII
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd);   // CJK 扩展 B+
    w += isWide ? 2 : 1;
  }
  return w;
}

/** 按显示宽度截断 */
export function clip(text: string, maxWidth: number): string {
  if (displayWidth(text) <= maxWidth) return text;
  let out = "";
  let w = 0;
  for (const ch of text) {
    const cw = displayWidth(ch);
    if (w + cw > maxWidth - 1) break; // 留 1 列给省略号
    out += ch;
    w += cw;
  }
  return out + "…";
}

/** 按显示宽度右侧补空格 */
export function padEnd(text: string, width: number): string {
  const diff = width - displayWidth(text);
  return diff > 0 ? text + " ".repeat(diff) : text;
}

export type Row = Record<string, string | number | null | undefined>;

/** 打印表格 */
export function table(rows: Row[], columns?: string[]): void {
  if (rows.length === 0) {
    console.log("（无数据）");
    return;
  }

  const cols = columns ?? Object.keys(rows[0]);
  const MAX = 40; // 单列最大显示宽度

  // 计算每列宽度
  const widths: Record<string, number> = {};
  for (const c of cols) {
    let w = displayWidth(c);
    for (const r of rows) {
      const cell = clip(String(r[c] ?? ""), MAX);
      w = Math.max(w, displayWidth(cell));
    }
    widths[c] = Math.min(w, MAX);
  }

  // 表头
  const header = cols.map((c) => padEnd(clip(c, widths[c]), widths[c])).join("  ");
  console.log(header);
  console.log("─".repeat(Math.min(displayWidth(header) + 20, 200)));

  // 数据行
  for (const r of rows) {
    console.log(
      cols
        .map((c) => padEnd(clip(String(r[c] ?? ""), widths[c]), widths[c]))
        .join("  ")
        .trimEnd(),
    );
  }
}

/** 打印 JSON */
export function json(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/** 打印键值对（详情页用） */
export function keyValue(pairs: [string, unknown][]): void {
  const w = Math.max(...pairs.map(([k]) => displayWidth(k)));
  for (const [k, v] of pairs) {
    const val = v === null || v === undefined || v === "" ? "—" : String(v);
    console.log(`${padEnd(k, w)}  ${val}`);
  }
}

/** 成功提示 */
export function ok(msg: string): void {
  console.log(`✔ ${msg}`);
}

/** 错误提示（写 stderr） */
export function fail(msg: string): void {
  console.error(`✘ ${msg}`);
}

/** 分节标题 */
export function heading(msg: string): void {
  console.log(`\n${msg}`);
  console.log("─".repeat(Math.max(8, displayWidth(msg))));
}