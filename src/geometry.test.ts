import { describe, expect, it } from 'vitest';
import {
  applyRatio,
  canGrow,
  type Crop,
  cropFits,
  cropRectOut,
  dragHandle,
  fitScale,
  flipCrop,
  largestAnywhere,
  maxScale,
  panCrop,
  rotateQuarterCrop,
  roundHalfEven,
  shrinkToFit,
  toImage,
  toOutput,
  zoomCrop,
} from './geometry';

// スクショで使われていた画像の大きさ
const IMG = { w: 422, h: 717 };
const FULL: Crop = { u: 0, v: 0, w: 422, h: 717 };
const size = (c: Crop) => `${roundHalfEven(c.w)} x ${roundHalfEven(c.h)}`;

describe('座標変換', () => {
  it('画像座標と出力座標を行き来できる', () => {
    const p = { x: 12.5, y: -40 };
    const q = toImage(toOutput(p, 12.4), 12.4);
    expect(q.x).toBeCloseTo(p.x, 9);
    expect(q.y).toBeCloseTo(p.y, 9);
  });

  it('正の角度は時計回り（y 軸下向き）', () => {
    const p = toOutput({ x: 1, y: 0 }, 90);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(1, 9);
  });
});

describe('比率の選択（本家の実測値）', () => {
  it('開いた直後に 9:16 → 403 x 717', () => {
    const c = applyRatio(FULL, 9 / 16, IMG, 0);
    expect(size(c)).toBe('403 x 717');
    expect(c.u).toBe(0);
    expect(c.v).toBe(0);
  });

  it('続けて 16:9 → 422 x 237（今の枠の内側ではなく、画像の範囲で最大）', () => {
    const c = applyRatio(applyRatio(FULL, 9 / 16, IMG, 0), 16 / 9, IMG, 0);
    expect(size(c)).toBe('422 x 237');
  });

  it('開いた直後に 4:3 → 422 x 316（316.5 は偶数側に丸める）', () => {
    expect(size(applyRatio(FULL, 4 / 3, IMG, 0))).toBe('422 x 316');
  });

  it('右端に寄せた 296 幅の枠から 9:16 → 中心を保ったまま幅で制限される', () => {
    const start: Crop = { u: 211 - 148, v: 0, w: 296, h: 666 };
    const c = applyRatio(start, 9 / 16, IMG, 0);
    expect(c.w).toBeCloseTo(296, 6);
    expect(c.h).toBeCloseTo((296 * 16) / 9, 6);
    expect(c.u + c.w / 2).toBeCloseTo(211, 6);
  });

  it('傾けた状態でも画像に収まる', () => {
    const c = applyRatio(FULL, 16 / 9, IMG, 20);
    expect(cropFits(c, IMG, 20)).toBe(true);
    expect(maxScale(c, IMG, 20)).toBeCloseTo(1, 6);
  });
});

describe('傾き補正の自動拡大', () => {
  it('12.4° で枠が縮み、ズーム率が 83% → 112% になる', () => {
    const c = shrinkToFit(FULL, IMG, 12.4);
    expect(cropFits(c, IMG, 12.4)).toBe(true);
    expect(c.w / c.h).toBeCloseTo(422 / 717, 9);
    // 本家の画面：枠の高さ約 478 CSS px、表示スケール 125%
    const stage = { w: 1200, h: 478 };
    const zoomBefore = Math.round(fitScale(FULL, stage) * 1.25 * 100);
    const zoomAfter = Math.round(fitScale(c, stage) * 1.25 * 100);
    expect(zoomBefore).toBe(83);
    expect(zoomAfter).toBe(112);
  });

  it('−45° でも画像に収まる', () => {
    const c = shrinkToFit(FULL, IMG, -45);
    expect(cropFits(c, IMG, -45)).toBe(true);
    expect(maxScale(c, IMG, -45)).toBeCloseTo(1, 6);
  });

  it('収まっている枠はそのまま', () => {
    const c: Crop = { u: 0, v: 0, w: 100, h: 100 };
    expect(shrinkToFit(c, IMG, 10)).toEqual(c);
  });
});

describe('ズーム', () => {
  it('拡大すると枠（元画像の px）が小さくなる：2 倍で 211 x 358.5', () => {
    const c = zoomCrop(FULL, 2, IMG, 0);
    expect(c.w).toBeCloseTo(211, 9);
    expect(c.h).toBeCloseTo(358.5, 9);
  });

  it('縮小は画像いっぱいまで。そこで縮小できなくなる', () => {
    expect(canGrow(FULL, IMG, 0)).toBe(false);
    const zoomed = zoomCrop(FULL, 2, IMG, 0);
    expect(canGrow(zoomed, IMG, 0)).toBe(true);
    const back = zoomCrop(zoomed, 1 / 4, IMG, 0);
    expect(back.w).toBeCloseTo(422, 6);
    expect(back.h).toBeCloseTo(717, 6);
  });

  it('端に寄った枠を縮小すると、中心が内側に寄る', () => {
    const c: Crop = { u: 100, v: 0, w: 211, h: 358.5 };
    const out = zoomCrop(c, 1 / 2, IMG, 0);
    expect(out.w).toBeCloseTo(422, 6);
    expect(out.u).toBeCloseTo(0, 6);
    expect(cropFits(out, IMG, 0)).toBe(true);
  });
});

describe('画像のスライド（枠の内側のドラッグ）', () => {
  it('画像を右に動かすと、枠は画像の左側へ移る', () => {
    const c: Crop = { u: 0, v: 0, w: 200, h: 200 };
    const out = panCrop(c, { x: 50, y: 0 }, IMG, 0);
    expect(out.u).toBeCloseTo(-50, 9);
  });

  it('画像の外側は枠に入らない', () => {
    const c: Crop = { u: 0, v: 0, w: 200, h: 200 };
    const out = panCrop(c, { x: 1000, y: -1000 }, IMG, 0);
    expect(out.u).toBeCloseTo(-111, 9);
    expect(out.v).toBeCloseTo(258.5, 9);
  });

  it('傾けた状態でも画像に収まる', () => {
    const c = shrinkToFit({ u: 0, v: 0, w: 200, h: 300 }, IMG, 30);
    const out = panCrop(c, { x: 500, y: 300 }, IMG, 30);
    expect(cropFits(out, IMG, 30)).toBe(true);
  });
});

describe('90° 回転', () => {
  it('16:9 の枠 422 x 237 が 237 x 422 になる', () => {
    const c = applyRatio(FULL, 16 / 9, IMG, 0);
    const r = rotateQuarterCrop(c, 1);
    expect(size(r)).toBe('237 x 422');
  });

  it('時計回り → 反時計回りで元に戻る', () => {
    const c: Crop = { u: 30, v: -20, w: 100, h: 50 };
    expect(rotateQuarterCrop(rotateQuarterCrop(c, 1), -1)).toEqual(c);
  });

  it('時計回りで、上にあった枠が右に移る', () => {
    const r = rotateQuarterCrop({ u: 0, v: -100, w: 10, h: 10 }, 1);
    expect(r.u).toBe(100);
    expect(r.v).toBeCloseTo(0, 9);
  });
});

describe('反転', () => {
  it('左右反転を 2 回で元に戻る', () => {
    const c: Crop = { u: 30, v: -20, w: 100, h: 50 };
    const once = flipCrop(c, 12.4, 'h');
    expect(once.angle).toBe(-12.4);
    const twice = flipCrop(once.crop, once.angle, 'h');
    expect(twice.angle).toBeCloseTo(12.4, 9);
    expect(twice.crop.u).toBeCloseTo(c.u, 9);
    expect(twice.crop.v).toBeCloseTo(c.v, 9);
  });

  it('左右反転で、出力座標の枠の中心が左右に入れ替わる', () => {
    const c: Crop = { u: 30, v: -20, w: 100, h: 50 };
    const out = flipCrop(c, 0, 'h');
    expect(out.crop.u).toBe(-30);
    expect(out.crop.v).toBe(-20);
  });

  it('反転しても画像に収まったまま', () => {
    const c = shrinkToFit({ u: 40, v: -60, w: 200, h: 300 }, IMG, 17);
    const out = flipCrop(c, 17, 'v');
    expect(cropFits(out.crop, IMG, out.angle)).toBe(true);
  });
});

describe('ハンドルのドラッグ', () => {
  const opts = { img: IMG, angle: 0, ratio: null, minSize: 10 };

  it('右辺を内側に動かすと幅が縮み、左辺は動かない', () => {
    const c = dragHandle(FULL, 'e', { x: -100, y: 0 }, opts);
    const r = cropRectOut(c, 0);
    expect(r.w).toBeCloseTo(322, 9);
    expect(r.x).toBeCloseTo(-211, 9);
  });

  it('画像の外には広げられない', () => {
    const c = dragHandle(FULL, 'se', { x: 500, y: 500 }, opts);
    expect(c.w).toBeCloseTo(422, 3);
    expect(c.h).toBeCloseTo(717, 3);
  });

  it('角を斜め外に動かしても、もう一方の向きには滑って追従する', () => {
    const start: Crop = { u: 0, v: 0, w: 200, h: 200 };
    const c = dragHandle(start, 'se', { x: 500, y: 50 }, opts);
    const r = cropRectOut(c, 0);
    expect(r.x + r.w).toBeCloseTo(211, 3);
    expect(r.y + r.h).toBeCloseTo(150, 3);
  });

  it('最小サイズより小さくならない', () => {
    const c = dragHandle(FULL, 'w', { x: 1000, y: 0 }, opts);
    expect(c.w).toBeCloseTo(10, 3);
  });

  it('固定比率では比率を保つ', () => {
    const start = applyRatio(FULL, 16 / 9, IMG, 0);
    const c = dragHandle(start, 'nw', { x: 100, y: 10 }, { ...opts, ratio: 16 / 9 });
    expect(c.w / c.h).toBeCloseTo(16 / 9, 9);
    expect(c.w).toBeCloseTo(322, 6);
    const r = cropRectOut(c, 0);
    const s = cropRectOut(start, 0);
    // 反対側の角（右下）は動かない
    expect(r.x + r.w).toBeCloseTo(s.x + s.w, 6);
    expect(r.y + r.h).toBeCloseTo(s.y + s.h, 6);
  });

  it('固定比率の辺のドラッグは、もう一方の向きの中央を保つ', () => {
    const start = applyRatio(FULL, 1, IMG, 0);
    const c = dragHandle(start, 'e', { x: -100, y: 0 }, { ...opts, ratio: 1 });
    expect(c.w).toBeCloseTo(322, 6);
    expect(c.h).toBeCloseTo(322, 6);
    expect(cropRectOut(c, 0).y + c.h / 2).toBeCloseTo(0, 6);
  });

  it('傾けた画像の外には出ない', () => {
    const start = shrinkToFit(FULL, IMG, 12.4);
    const c = dragHandle(start, 'ne', { x: 300, y: -300 }, { ...opts, angle: 12.4 });
    expect(cropFits(c, IMG, 12.4)).toBe(true);
  });

  it('bounds（画面の見えている範囲）の外には出ない', () => {
    const bounds = { x: -300, y: -150, w: 600, h: 400 };
    const start: Crop = { u: 0, v: 0, w: 200, h: 200 };
    const c = dragHandle(start, 'n', { x: 0, y: -100 }, { ...opts, bounds });
    expect(cropRectOut(c, 0).y).toBeCloseTo(-150, 3);
    expect(cropRectOut(c, 0).y + c.h).toBeCloseTo(100, 6);
  });
});

describe('その他', () => {
  it('largestAnywhere は画像の中央に置く', () => {
    const c = largestAnywhere(1, IMG, 0);
    expect(c).toEqual({ u: 0, v: 0, w: 422, h: 422 });
  });

  it('roundHalfEven', () => {
    expect(roundHalfEven(316.5)).toBe(316);
    expect(roundHalfEven(237.5)).toBe(238);
    expect(roundHalfEven(237.375)).toBe(237);
    expect(roundHalfEven(403.31)).toBe(403);
  });
});
