import { describe, expect, it } from 'vitest';
import { roundHalfEven } from './geometry';
import {
  canZoomOut,
  effectiveCrop,
  flip,
  History,
  initialState,
  rotateQuarter,
  sameState,
  selectRatio,
  setAngle,
  zoom,
} from './state';

const SRC = { w: 422, h: 717 };

describe('状態の操作', () => {
  it('傾きを戻すと、枠の大きさも元に戻る', () => {
    const s0 = initialState(SRC);
    const tilted = setAngle(s0, 12.4);
    expect(effectiveCrop(tilted, SRC).w).toBeLessThan(422);
    const back = setAngle(tilted, 0);
    expect(effectiveCrop(back, SRC).w).toBeCloseTo(422, 9);
  });

  it('角度は ±45° に制限し、0.1° 単位に丸める', () => {
    const s0 = initialState(SRC);
    expect(setAngle(s0, 60).angle).toBe(45);
    expect(setAngle(s0, -50).angle).toBe(-45);
    expect(setAngle(s0, 12.3456).angle).toBe(12.3);
  });

  it('16:9 のまま時計回りに回すと 9:16 になる', () => {
    let s = selectRatio(initialState(SRC), SRC, '16:9');
    s = rotateQuarter(s, 1);
    expect(s.ratio).toBe('9:16');
    expect(s.quarter).toBe(1);
    const c = effectiveCrop(s, SRC);
    expect(`${roundHalfEven(c.w)} x ${roundHalfEven(c.h)}`).toBe('237 x 422');
  });

  it('オリジナルは、向きを変えた画像の比率になる', () => {
    const s = rotateQuarter(initialState(SRC), 1);
    const r = selectRatio(s, SRC, 'original');
    const c = effectiveCrop(r, SRC);
    expect(c.w / c.h).toBeCloseTo(717 / 422, 9);
  });

  it('左右反転を 2 回で元の状態に戻る', () => {
    const s0 = setAngle(rotateQuarter(initialState(SRC), 1), 10);
    const s2 = flip(flip(s0, 'h'), 'h');
    expect(sameState(s0, s2)).toBe(true);
  });

  it('画像いっぱいの枠は縮小できない。拡大すると縮小できるようになる', () => {
    const s0 = initialState(SRC);
    expect(canZoomOut(s0, SRC)).toBe(false);
    expect(canZoomOut(zoom(s0, SRC, 1.25), SRC)).toBe(true);
  });
});

describe('履歴', () => {
  it('元に戻す・やり直し', () => {
    const s0 = initialState(SRC);
    const h = new History(s0);
    expect(h.canUndo).toBe(false);
    h.push(setAngle(s0, 5));
    h.push(setAngle(h.current, 10));
    expect(h.undo().angle).toBe(5);
    expect(h.canRedo).toBe(true);
    expect(h.redo().angle).toBe(10);
  });

  it('変化のない状態は積まない', () => {
    const s0 = initialState(SRC);
    const h = new History(s0);
    expect(h.push({ ...s0 })).toBe(false);
    expect(h.canUndo).toBe(false);
  });

  it('新しい操作をすると、やり直しは消える', () => {
    const s0 = initialState(SRC);
    const h = new History(s0);
    h.push(setAngle(s0, 5));
    h.undo();
    h.push(setAngle(h.current, -3));
    expect(h.canRedo).toBe(false);
  });
});
