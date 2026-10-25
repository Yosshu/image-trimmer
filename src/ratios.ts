import type { Size } from './geometry';

export type RatioId =
  | 'free'
  | 'original'
  | 'square'
  | '9:16'
  | '16:9'
  | '4:5'
  | '5:4'
  | '3:4'
  | '4:3'
  | '2:3'
  | '3:2'
  | '5:7'
  | '7:5'
  | '1:2'
  | '2:1';

export interface RatioDef {
  id: RatioId;
  /** 比率ピッカーとボタンに表示する名前 */
  label: string;
  tooltip: string;
  /** 固定比率の幅・高さ（自由・オリジナルは持たない） */
  w?: number;
  h?: number;
}

const fixed = (w: number, h: number): RatioDef => ({
  id: `${w}:${h}` as RatioId,
  label: `${w} : ${h}`,
  tooltip: `${w} x ${h} の縦横比`,
  w,
  h,
});

/** 比率ピッカーに並ぶ順 */
export const RATIOS: readonly RatioDef[] = [
  { id: 'free', label: '自由', tooltip: '自由な縦横比' },
  { id: 'original', label: 'オリジナル', tooltip: '元の縦横比' },
  { id: 'square', label: '正方形', tooltip: '正方形の縦横比', w: 1, h: 1 },
  fixed(9, 16),
  fixed(16, 9),
  fixed(4, 5),
  fixed(5, 4),
  fixed(3, 4),
  fixed(4, 3),
  fixed(2, 3),
  fixed(3, 2),
  fixed(5, 7),
  fixed(7, 5),
  fixed(1, 2),
  fixed(2, 1),
];

export function ratioDef(id: RatioId): RatioDef {
  return RATIOS.find((r) => r.id === id)!;
}

/** 比率の値（幅 / 高さ）。自由なら null。オリジナルは向きを変えた後の画像の比率 */
export function ratioValue(id: RatioId, orientedImg: Size): number | null {
  if (id === 'free') return null;
  if (id === 'original') return orientedImg.w / orientedImg.h;
  const def = ratioDef(id);
  return def.w! / def.h!;
}

/** 90° 回転したときの比率（16:9 → 9:16 など）。自由・オリジナル・正方形はそのまま */
export function swappedRatio(id: RatioId): RatioId {
  const def = ratioDef(id);
  if (def.w === undefined || def.w === def.h) return id;
  return `${def.h}:${def.w}` as RatioId;
}
