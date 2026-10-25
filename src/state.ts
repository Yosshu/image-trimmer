import {
  applyRatio,
  canGrow,
  type Crop,
  flipCrop,
  orientedSize,
  panCrop,
  type Quarter,
  rotateQuarterCrop,
  shrinkToFit,
  type Size,
  type Vec,
  zoomCrop,
} from './geometry';
import { type RatioId, ratioValue, swappedRatio } from './ratios';

export const MAX_ANGLE = 45;

/** 編集の状態。元に戻す・やり直しはこの値のスナップショットで管理する */
export interface EditState {
  quarter: Quarter;
  flipH: boolean;
  flipV: boolean;
  /** 傾き補正の角度（度、−45〜45、正が時計回り） */
  angle: number;
  /**
   * 基準の枠。傾き補正で画像からはみ出す場合は、表示・書き出しのときに中心を保って縮める（effectiveCrop）。
   * 角度を戻すと元の大きさに戻るよう、ここには縮める前の枠を持つ。
   */
  crop: Crop;
  ratio: RatioId;
}

export function initialState(src: Size): EditState {
  return {
    quarter: 0,
    flipH: false,
    flipV: false,
    angle: 0,
    crop: { u: 0, v: 0, w: src.w, h: src.h },
    ratio: 'free',
  };
}

export function imageSize(state: EditState, src: Size): Size {
  return orientedSize(src, state.quarter);
}

/** 実際に表示・書き出しする枠 */
export function effectiveCrop(state: EditState, src: Size): Crop {
  return shrinkToFit(state.crop, imageSize(state, src), state.angle);
}

/** 枠を変える操作の結果を、新しい基準の枠として持つ */
export function withCrop(state: EditState, crop: Crop): EditState {
  return { ...state, crop };
}

export function setAngle(state: EditState, angle: number): EditState {
  const a = Math.round(Math.min(MAX_ANGLE, Math.max(-MAX_ANGLE, angle)) * 10) / 10;
  return { ...state, angle: a === 0 ? 0 : a };
}

// 回転・反転は基準の枠に対して行う（画像の範囲は回転・反転に対して対称なので、縮めた結果も一致する）
export function rotateQuarter(state: EditState, dir: 1 | -1): EditState {
  return {
    ...state,
    quarter: (((state.quarter + dir) % 4) + 4) % 4 as Quarter,
    crop: rotateQuarterCrop(state.crop, dir),
    ratio: swappedRatio(state.ratio),
  };
}

export function flip(state: EditState, axis: 'h' | 'v'): EditState {
  const r = flipCrop(state.crop, state.angle, axis);
  return {
    ...state,
    quarter: ((4 - state.quarter) % 4) as Quarter,
    flipH: axis === 'h' ? !state.flipH : state.flipH,
    flipV: axis === 'v' ? !state.flipV : state.flipV,
    angle: r.angle,
    crop: r.crop,
  };
}

export function selectRatio(state: EditState, src: Size, id: RatioId): EditState {
  const img = imageSize(state, src);
  const value = ratioValue(id, img);
  const crop = effectiveCrop(state, src);
  return {
    ...state,
    ratio: id,
    crop: value === null ? crop : applyRatio(crop, value, img, state.angle),
  };
}

export function pan(state: EditState, src: Size, delta: Vec): EditState {
  return withCrop(state, panCrop(effectiveCrop(state, src), delta, imageSize(state, src), state.angle));
}

/** factor > 1 で拡大（枠が小さくなる） */
export function zoom(state: EditState, src: Size, factor: number): EditState {
  return withCrop(state, zoomCrop(effectiveCrop(state, src), factor, imageSize(state, src), state.angle));
}

export function canZoomOut(state: EditState, src: Size): boolean {
  return canGrow(effectiveCrop(state, src), imageSize(state, src), state.angle);
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

export function sameState(a: EditState, b: EditState): boolean {
  return (
    a.quarter === b.quarter &&
    a.flipH === b.flipH &&
    a.flipV === b.flipV &&
    near(a.angle, b.angle) &&
    a.ratio === b.ratio &&
    near(a.crop.u, b.crop.u) &&
    near(a.crop.v, b.crop.v) &&
    near(a.crop.w, b.crop.w) &&
    near(a.crop.h, b.crop.h)
  );
}

/** 元に戻す・やり直しの履歴 */
export class History {
  private past: EditState[] = [];
  private future: EditState[] = [];

  constructor(public current: EditState) {}

  /** 新しい状態を確定する。変化がなければ何もしない */
  push(next: EditState): boolean {
    if (sameState(next, this.current)) return false;
    this.past.push(this.current);
    this.future = [];
    this.current = next;
    return true;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): EditState {
    const prev = this.past.pop();
    if (prev) {
      this.future.push(this.current);
      this.current = prev;
    }
    return this.current;
  }

  redo(): EditState {
    const next = this.future.pop();
    if (next) {
      this.past.push(this.current);
      this.current = next;
    }
    return this.current;
  }
}
