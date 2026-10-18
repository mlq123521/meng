/**
 * CSV 单元格安全处理
 * 1. RFC 4180 转义：含逗号/引号/换行时用双引号包裹，内部引号翻倍
 * 2. 公式注入防护：以 = + - @ 开头的值会被 Excel 当公式执行，加单引号前缀
 */

/** 会触发 Excel 公式的前导字符 */
const FORMULA_LEADERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);

  // 公式注入防护：改写后强制前置一个单引号，Excel 会当纯文本
  if (s.length > 0 && FORMULA_LEADERS.has(s[0])) {
    s = "'" + s;
  }

  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 把二维数组拼成 CSV 文本（CRLF 换行，Windows Excel 兼容性最好） */
export function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/** 下载用的 CSV 响应头（含中文文件名 URL 编码） */
export function csvHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    // 告诉浏览器这是下载而不是渲染
    "Cache-Control": "no-store",
  };
}