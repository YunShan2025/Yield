/**
 * 颜色小工具 —— 移动端彩色胶囊需要「同一个色相的深/浅两版」：
 * 底色用实体色压低透明度，文字则必须保证对比度（≥4.5:1）。
 * 项目色 / 标签色是用户自定义的任意 hex，不能假定它够暗或够亮，
 * 所以这里统一朝黑（浅色主题）或朝白（深色主题）混一个固定比例。
 */

/** 解析 #rgb / #rrggbb / #rrggbbaa；认不出来时返回 null。 */
function parseHex(hex: string): [number, number, number] | null {
  const raw = hex.trim().replace(/^#/, "");
  if (raw.length === 3) {
    const [r, g, b] = raw.split("");
    if ([r, g, b].some((c) => !/[0-9a-f]/i.test(c))) return null;
    return [
      parseInt(r + r, 16),
      parseInt(g + g, 16),
      parseInt(b + b, 16),
    ];
  }
  if (raw.length === 6 || raw.length === 8) {
    if (!/^[0-9a-f]+$/i.test(raw)) return null;
    return [
      parseInt(raw.slice(0, 2), 16),
      parseInt(raw.slice(2, 4), 16),
      parseInt(raw.slice(4, 6), 16),
    ];
  }
  return null;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toHex(r: number, g: number, b: number): string {
  const part = (n: number) => clampByte(n).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * 把 from 往 to 混 amount（0–1）。amount=0 全是 from，1 全是 to。
 * 解析失败时原样返回，调用方不必再判空。
 */
export function mixHex(from: string, to: string, amount: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  if (!a || !b) return from;
  const ratio = Math.max(0, Math.min(1, amount));
  return toHex(
    a[0] + (b[0] - a[0]) * ratio,
    a[1] + (b[1] - a[1]) * ratio,
    a[2] + (b[2] - a[2]) * ratio,
  );
}

