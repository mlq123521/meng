/** 命令行参数解析 */

/** 位置参数 + 选项 */
export interface ParsedArgs {
  _: string[];
  flags: Record<string, string | boolean>;
}

/**
 * 解析 argv
 *   --key value      → key: "value"
 *   --key=value      → key: "value"
 *   --flag           → key: true
 *   --no-flag        → key: false
 *   -k value         → k: "value"
 *   位置参数          → _ 数组
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a.startsWith("--")) {
      const body = a.slice(2);

      // --no-xxx → false
      if (body.startsWith("no-")) {
        flags[body.slice(3)] = false;
        continue;
      }

      const eq = body.indexOf("=");
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }

      const next = argv[i + 1];
      // 后面没有值，或下一个是选项 → 视为布尔开关
      if (next === undefined || next.startsWith("-")) {
        flags[body] = true;
      } else {
        flags[body] = next;
        i++;
      }
      continue;
    }

    // 短选项 -k value
    if (a.startsWith("-") && a.length === 2) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) {
        flags[a.slice(1)] = true;
      } else {
        flags[a.slice(1)] = next;
        i++;
      }
      continue;
    }

    _.push(a);
  }

  return { _, flags };
}

/** 取字符串选项 */
export function str(flags: ParsedArgs["flags"], key: string, fallback = ""): string {
  const v = flags[key];
  return typeof v === "string" ? v : fallback;
}

/** 取布尔选项 */
export function bool(flags: ParsedArgs["flags"], key: string): boolean {
  return flags[key] === true || flags[key] === "true";
}

/** 取数字选项，非法时用默认值 */
export function num(flags: ParsedArgs["flags"], key: string, fallback: number): number {
  const v = flags[key];
  const n = typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}