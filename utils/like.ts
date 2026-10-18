/** 转义 LIKE 通配符，防止用户输入 % 或 _ 变成通配符 */

const LIKE_ESCAPE = "\\";

export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => LIKE_ESCAPE + ch);
}

/** 构造安全的模糊匹配值：转义后再包 % */
export function likePattern(input: string): string {
  return `%${escapeLike(input.trim())}%`;
}