/** 文本截断与摘要 */

/** 常见的省略号写法 */
const ELLIPSIS = "…";

/**
 * 截断文本到指定长度，超出部分用省略号代替
 *
 * @param text 原文
 * @param max  保留的最大字符数（省略号不计入）
 */
export function truncate(text: string | null | undefined, max = 40): string {
  const s = (text ?? "").trim();
  if (s.length <= max) return s;
  return s.slice(0, max) + ELLIPSIS;
}

/**
 * 生成摘要：优先在句子/段落边界处截断，读起来更自然
 *
 * 例："需要一套系统。预算 50 万。" + 长文本 → "需要一套系统。预算 50 万。…"
 */
export function summarize(text: string | null | undefined, max = 40): string {
  const s = (text ?? "").trim();
  if (s.length <= max) return s;

  const cut = s.slice(0, max);

  // 在最后一个断点处结束：句末标点为主，顿号/空白次之
  const boundaries = [
    "。", "！", "？", "；", "，",
    ".", "!", "?", ";", ",",
    "、", " ", "\t", "\n",
  ];
  let boundary = -1;
  for (const ch of boundaries) {
    const i = cut.lastIndexOf(ch);
    if (i > boundary) boundary = i;
  }

  // 断点太靠前就放弃，硬截即可（否则会截得很短，失去摘要的意义）
  const head = boundary >= Math.floor(max * 0.4) ? cut.slice(0, boundary + 1) : cut;

  return head + ELLIPSIS;
}

/** 单行化：把换行和多余空白压成空格，便于在表格里显示 */
export function oneLine(text: string | null | undefined, max = 40): string {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  return summarize(s, max);
}

/** 统计行数（用于在列表页提示「共 N 行」） */
export function countLines(text: string | null | undefined): number {
  const s = (text ?? "").trim();
  if (!s) return 0;
  return s.split(/\r\n|\r|\n/).filter((line) => line.trim() !== "").length;
}