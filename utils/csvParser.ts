/**
 * CSV 解析（RFC 4180）
 *
 * 必须自己写而不能用 split(',')，因为：
 *  1. 字段里可以包含逗号（值要用双引号包裹）
 *  2. 字段里可以包含双引号（内部用 "" 转义）
 *  3. 字段里可以包含换行
 *  4. 末尾字段可能没有分隔符
 */

/** 把一行 CSV 文本拆成字段数组 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // 双引号后面紧跟另一个双引号 → 这是转义，内容是一个引号
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false; // 引号闭合
        }
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * 解析整份 CSV
 * @returns 二维数组；空行会被剔除
 */
export function parseCsv(text: string): string[][] {
  // 统一换行符；去掉 UTF-8 BOM（Excel 导出的文件一定有）
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];

    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch; // 引号内的换行原样保留
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      const cells = row.map((s) => s.trim());
      // 跳过完全空白的行
      if (cells.some((c) => c !== "")) rows.push(cells);
      row = [];
    } else {
      field += ch;
    }
  }

  // 收尾：最后一行没有换行符的情况
  if (field !== "" || row.length > 0) {
    row.push(field);
    const cells = row.map((s) => s.trim());
    if (cells.some((c) => c !== "")) rows.push(cells);
  }

  return rows;
}

/** 字段名归一化：去掉空格、全角括号，统一大小写 */
export function normalizeHeader(name: string): string {
  return name
    .replace(/[\s\u3000]/g, "")
    .replace(/[（）]/g, (c) => (c === "（" ? "(" : ")"))
    .toLowerCase();
}