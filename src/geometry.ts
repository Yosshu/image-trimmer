/**
 * トリミングの幾何計算（画面に依存しない純粋な関数）。
 *
 * 座標系は y 軸が下向き。角度は度数で、正の値が時計回り。
 *
 * - 画像座標：90° 回転・反転を適用した後の画像（「向きを変えた画像」）の中心を原点とする座標（単位は元画像の px）
 * - 出力座標：画像座標を、傾き補正の角度だけ回した座標。トリミング枠は出力座標の軸に沿った矩形になる
 *
 * 枠（Crop）は、中心を画像座標で、大きさを出力座標の軸に沿った幅・高さで持つ。
 */

export interface Vec {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

/** 左上を基準にした矩形 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Crop {
  /** 枠の中心（画像座標） */
  u: number;
  v: number;
  /** 枠の幅・高さ（出力座標の軸に沿った大きさ、元画像の px） */
  w: number;
  h: number;
}

export type Quarter = 0 | 1 | 2 | 3;

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const EPS = 1e-6;

export const toRad = (deg: number): number => (deg * Math.PI) / 180;

export const clamp = (x: number, min: number, max: number): number => Math.min(max, Math.max(min, x));

/** 90° 回転を考慮した画像の大きさ */
export function orientedSize(src: Size, quarter: Quarter): Size {
  return quarter % 2 === 0 ? { w: src.w, h: src.h } : { w: src.h, h: src.w };
}

/** 画像座標 → 出力座標 */
export function toOutput(p: Vec, angle: number): Vec {
  const c = Math.cos(toRad(angle));
  const s = Math.sin(toRad(angle));
  return { x: c * p.x - s * p.y, y: s * p.x + c * p.y };
}

/** 出力座標 → 画像座標 */
export function toImage(p: Vec, angle: number): Vec {
  const c = Math.cos(toRad(angle));
  const s = Math.sin(toRad(angle));
  return { x: c * p.x + s * p.y, y: -s * p.x + c * p.y };
}

/** 幅 w・高さ h の枠を画像座標に戻したときの、外接矩形の半分の幅・高さ */
function halfExtents(w: number, h: number, angle: number): Vec {
  const c = Math.abs(Math.cos(toRad(angle)));
  const s = Math.abs(Math.sin(toRad(angle)));
  return { x: (w * c + h * s) / 2, y: (w * s + h * c) / 2 };
}

/** 枠が画像の内側に収まっているか */
export function cropFits(crop: Crop, img: Size, angle: number, tol = EPS * Math.max(img.w, img.h, 1)): boolean {
  const e = halfExtents(crop.w, crop.h, angle);
  return Math.abs(crop.u) + e.x <= img.w / 2 + tol && Math.abs(crop.v) + e.y <= img.h / 2 + tol;
}

/** 中心を保ったまま、枠を何倍まで大きくできるか */
export function maxScale(crop: Crop, img: Size, angle: number): number {
  const e = halfExtents(crop.w, crop.h, angle);
  const sx = (img.w / 2 - Math.abs(crop.u)) / e.x;
  const sy = (img.h / 2 - Math.abs(crop.v)) / e.y;
  return Math.max(0, Math.min(sx, sy));
}

/** 画像からはみ出す分だけ、中心を保ったまま枠を縮める（はみ出さなければそのまま） */
export function shrinkToFit(crop: Crop, img: Size, angle: number): Crop {
  const k = Math.min(1, maxScale(crop, img, angle));
  return { u: crop.u, v: crop.v, w: crop.w * k, h: crop.h * k };
}

/** 大きさを保ったまま、枠が画像に収まるよう中心を動かす */
export function clampCenter(crop: Crop, img: Size, angle: number): Crop {
  const e = halfExtents(crop.w, crop.h, angle);
  const mx = Math.max(0, img.w / 2 - e.x);
  const my = Math.max(0, img.h / 2 - e.y);
  return { u: clamp(crop.u, -mx, mx), v: clamp(crop.v, -my, my), w: crop.w, h: crop.h };
}

/** 中心 (u, v) を保ったまま、比率 ratio（幅 / 高さ）で画像に収まる最大の枠 */
export function largestAtCenter(u: number, v: number, ratio: number, img: Size, angle: number): Crop {
  const c = Math.abs(Math.cos(toRad(angle)));
  const s = Math.abs(Math.sin(toRad(angle)));
  const halfH = Math.max(
    0,
    Math.min((img.w / 2 - Math.abs(u)) / (ratio * c + s), (img.h / 2 - Math.abs(v)) / (ratio * s + c)),
  );
  return { u, v, w: 2 * halfH * ratio, h: 2 * halfH };
}

/** 比率 ratio で画像に収まる最大の枠（画像の中央） */
export function largestAnywhere(ratio: number, img: Size, angle: number): Crop {
  return largestAtCenter(0, 0, ratio, img, angle);
}

/** 比率を選んだときの新しい枠：今の枠の中心を保ったまま、画像に収まる最大サイズ */
export function applyRatio(crop: Crop, ratio: number, img: Size, angle: number): Crop {
  return largestAtCenter(crop.u, crop.v, ratio, img, angle);
}

/** 枠の中心を出力座標で返す */
export function cropCenterOut(crop: Crop, angle: number): Vec {
  return toOutput({ x: crop.u, y: crop.v }, angle);
}

/** 出力座標での枠の矩形 */
export function cropRectOut(crop: Crop, angle: number): Rect {
  const p = cropCenterOut(crop, angle);
  return { x: p.x - crop.w / 2, y: p.y - crop.h / 2, w: crop.w, h: crop.h };
}

/** 出力座標の矩形から枠を作る */
export function cropFromRectOut(r: Rect, angle: number): Crop {
  const p = toImage({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, angle);
  return { u: p.x, v: p.y, w: r.w, h: r.h };
}

/**
 * 枠の内側をドラッグしたとき：画像を出力座標で delta だけ動かす（枠は画面上で動かない）。
 * 画像の外側が枠に入らないよう制限する。
 */
export function panCrop(crop: Crop, delta: Vec, img: Size, angle: number): Crop {
  const p = cropCenterOut(crop, angle);
  const q = toImage({ x: p.x - delta.x, y: p.y - delta.y }, angle);
  return clampCenter({ u: q.x, v: q.y, w: crop.w, h: crop.h }, img, angle);
}

/** 縮小（ズームアウト）できるか：枠を今より大きくできる余地があるか */
export function canGrow(crop: Crop, img: Size, angle: number): boolean {
  const max = largestAnywhere(crop.w / crop.h, img, angle);
  return crop.w < max.w * (1 - 1e-6);
}

/**
 * ズーム：枠の画面上の大きさは変えず、画像を factor 倍に拡大する。
 * つまり枠（元画像の px）を 1 / factor 倍にする。縮小は画像に収まる最大サイズまで。
 */
export function zoomCrop(crop: Crop, factor: number, img: Size, angle: number): Crop {
  const max = largestAnywhere(crop.w / crop.h, img, angle);
  let w = crop.w / factor;
  let h = crop.h / factor;
  if (w > max.w) {
    w = max.w;
    h = max.h;
  }
  return clampCenter({ u: crop.u, v: crop.v, w, h }, img, angle);
}

/** 90° 回転したときの枠（画像と一緒に回る）。dir = 1 で時計回り */
export function rotateQuarterCrop(crop: Crop, dir: 1 | -1): Crop {
  return dir === 1
    ? { u: -crop.v, v: crop.u, w: crop.h, h: crop.w }
    : { u: crop.v, v: -crop.u, w: crop.h, h: crop.w };
}

/**
 * 反転したときの枠と角度。画面の見た目全体を、枠の中心を軸に鏡写しにする。
 * 呼び出し側は、90° 回転の回数を (4 - quarter) % 4 にし、対応する反転フラグを切り替える。
 */
export function flipCrop(crop: Crop, angle: number, axis: 'h' | 'v'): { crop: Crop; angle: number } {
  const p = cropCenterOut(crop, angle);
  const q = axis === 'h' ? { x: -p.x, y: p.y } : { x: p.x, y: -p.y };
  const newAngle = angle === 0 ? 0 : -angle;
  const c = toImage(q, newAngle);
  return { crop: { u: c.x, v: c.y, w: crop.w, h: crop.h }, angle: newAngle };
}

/** 枠を収める領域に、縦横比を保ったまま最大で表示するときの倍率（画面 px / 元画像 px） */
export function fitScale(crop: Size, stage: Size): number {
  return Math.min(stage.w / crop.w, stage.h / crop.h);
}

export interface DragOptions {
  img: Size;
  angle: number;
  /** 固定比率（幅 / 高さ）。自由なら null */
  ratio: number | null;
  /** 枠の最小の幅・高さ（出力座標の px） */
  minSize: number;
  /** 枠がはみ出してはいけない範囲（出力座標）。画面の見えている範囲など */
  bounds?: Rect;
}

interface Edges {
  l: number;
  t: number;
  r: number;
  b: number;
}

const edgesOf = (r: Rect): Edges => ({ l: r.x, t: r.y, r: r.x + r.w, b: r.y + r.h });
const rectOf = (e: Edges): Rect => ({ x: e.l, y: e.t, w: e.r - e.l, h: e.b - e.t });

/** feasible(t) が真になる最大の t（0 ≤ t ≤ 1）。feasible(0) は真である前提 */
function maxFeasible(feasible: (t: number) => boolean): number {
  if (feasible(1)) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (feasible(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * ハンドルのドラッグ。start はドラッグ開始時の枠、delta はポインターの移動量（出力座標）。
 * 画像の外・bounds の外・最小サイズ未満にならない範囲で、できるだけポインターに追従させる。
 */
export function dragHandle(start: Crop, handle: Handle, delta: Vec, opts: DragOptions): Crop {
  const { img, angle, ratio, minSize, bounds } = opts;
  const s = edgesOf(cropRectOut(start, angle));
  // 計算誤差で開始時の枠がわずかにはみ出している場合だけ、許容誤差をゆるめる
  let tol = 1e-9 * Math.max(img.w, img.h, 1);

  const ok = (e: Edges): boolean => {
    const w = e.r - e.l;
    const h = e.b - e.t;
    if (w < minSize - tol || h < minSize - tol) return false;
    if (
      bounds &&
      (e.l < bounds.x - tol ||
        e.t < bounds.y - tol ||
        e.r > bounds.x + bounds.w + tol ||
        e.b > bounds.y + bounds.h + tol)
    ) {
      return false;
    }
    return cropFits(cropFromRectOut(rectOf(e), angle), img, angle, tol);
  };
  if (!ok(s)) tol = EPS * Math.max(img.w, img.h, 1);

  const hasE = handle.includes('e');
  const hasW = handle.includes('w');
  const hasN = handle.includes('n');
  const hasS = handle.includes('s');

  let result: Edges;

  if (ratio === null) {
    const move = (dx: number, dy: number): Edges => ({
      l: hasW ? s.l + dx : s.l,
      r: hasE ? s.r + dx : s.r,
      t: hasN ? s.t + dy : s.t,
      b: hasS ? s.b + dy : s.b,
    });
    // まずポインターの方向にまっすぐ動かし、止まったら残りを横・縦それぞれに滑らせる
    const t0 = maxFeasible((t) => ok(move(delta.x * t, delta.y * t)));
    let dx = delta.x * t0;
    let dy = delta.y * t0;
    const restX = delta.x - dx;
    const tx = maxFeasible((t) => ok(move(dx + restX * t, dy)));
    dx += restX * tx;
    const restY = delta.y - dy;
    const ty = maxFeasible((t) => ok(move(dx, dy + restY * t)));
    dy += restY * ty;
    result = move(dx, dy);
  } else {
    const w0 = s.r - s.l;
    const h0 = s.b - s.t;
    const cx = (s.l + s.r) / 2;
    const cy = (s.t + s.b) / 2;
    let targetW: number;
    if (handle.length === 2) {
      // 角：幅・高さのうち、変化の大きいほうに合わせる
      const wFromX = w0 + (hasE ? delta.x : -delta.x);
      const wFromY = (h0 + (hasS ? delta.y : -delta.y)) * ratio;
      targetW = Math.abs(wFromX - w0) >= Math.abs(wFromY - w0) ? wFromX : wFromY;
    } else if (hasE || hasW) {
      targetW = w0 + (hasE ? delta.x : -delta.x);
    } else {
      targetW = (h0 + (hasS ? delta.y : -delta.y)) * ratio;
    }
    const sized = (w: number): Edges => {
      const h = w / ratio;
      // 動かす辺の反対側を固定する。辺のドラッグでは、もう一方の向きは中央を保つ
      const l = hasE ? s.l : hasW ? s.r - w : cx - w / 2;
      const t = hasS ? s.t : hasN ? s.b - h : cy - h / 2;
      return { l, t, r: l + w, b: t + h };
    };
    const t = maxFeasible((k) => ok(sized(w0 + (targetW - w0) * k)));
    result = sized(w0 + (targetW - w0) * t);
  }

  return cropFromRectOut(rectOf(result), angle);
}

/**
 * 傾き補正がないときの、書き出す範囲（向きを変えた画像の左上を原点とする整数の px）。
 * 位置と大きさを整数にそろえて、画素をそのまま書き出せるようにする。
 */
export function cropPixelRect(crop: Crop, img: Size): Rect {
  const w = clamp(roundHalfEven(crop.w), 1, img.w);
  const h = clamp(roundHalfEven(crop.h), 1, img.h);
  const x = clamp(Math.round(crop.u - crop.w / 2 + img.w / 2), 0, img.w - w);
  const y = clamp(Math.round(crop.v - crop.h / 2 + img.h / 2), 0, img.h - h);
  return { x, y, w, h };
}

/**
 * 表示用の丸め（.NET の Math.Round と同じく、ちょうど .5 は偶数に丸める）。
 * 例：316.5 → 316、237.5 → 238
 */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (Math.abs(diff - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}
