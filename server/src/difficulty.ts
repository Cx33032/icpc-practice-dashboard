// Every platform's difficulty is mapped onto the Codeforces rating scale (800–3500) so that
// stats and recommendations can compare across sites. These are approximations, ±200 or so.

export function clampRating(r: number): number {
  return Math.max(800, Math.min(3500, Math.round(r / 100) * 100));
}

const LEETCODE: Record<string, number> = { easy: 1100, medium: 1600, hard: 2100 };
export function leetcodeRating(difficulty: string | null | undefined): number | null {
  if (!difficulty) return null;
  return LEETCODE[difficulty.toLowerCase()] ?? null;
}

/** Kattis difficulty runs 1.0–10.0 (sometimes shown as a range like "1.7 - 1.9"). */
export function kattisRating(value: number | null): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return clampRating(800 + (value - 1) * 300);
}

export function parseKattisDifficulty(text: string): number | null {
  const nums = (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function ratingBand(r: number | null): string {
  if (r == null) return 'Unrated';
  if (r < 1200) return '800–1100';
  if (r < 1600) return '1200–1500';
  if (r < 1900) return '1600–1800';
  if (r < 2200) return '1900–2100';
  if (r < 2600) return '2200–2500';
  return '2600+';
}
export const BANDS = ['800–1100', '1200–1500', '1600–1800', '1900–2100', '2200–2500', '2600+', 'Unrated'];
