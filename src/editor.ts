import { h } from './dom';
import {
  type Crop,
  cropCenterOut,
  cropRectOut,
  dragHandle,
  fitScale,
  type Handle,
  panCrop,
  type Rect,
  roundHalfEven,
  type Size,
  toRad,
} from './geometry';
import { ICONS, icon, ratioIcon } from './icons';
import type { SourceImage } from './loader';
import { RATIOS, ratioDef, ratioValue } from './ratios';
import { drawRuler, PX_PER_DEG } from './ruler';
import {
  effectiveCrop,
  type EditState,
  flip,
  History,
  imageSize,
  initialState,
  rotateQuarter,
  sameState,
  selectRatio,
  setAngle,
  withCrop,
} from './state';

/** 画面の配置（CSS px）。docs/SPEC.md §1 */
const TOOLBAR_H = 52;
const STAGE_TOP = 118;
const STAGE_BOTTOM = 159;
const STAGE_SIDE = 64;

/** ハンドルの太さ（本家の実測 4 物理 px ÷ 125%）と長さ */
const HANDLE_THICKNESS = 3.2;
const HANDLE_LENGTH = 28;
/** ハンドルをつかめる範囲：枠線から外側・内側への距離 */
const HIT_OUTSIDE = 14;
const HIT_INSIDE = 10;
/** ドラッグ中の枠の最小サイズ（画面上の CSS px） */
const MIN_CROP_SCREEN = 48;
/** ズームの上限（画像の 1px を画面の物理ピクセル 16px で表示） */
const MAX_ZOOM = 16;
/** 手を離したあと、枠を中央に戻すアニメーションの長さ */
const FIT_DURATION = 250;
/** 90° 回転のアニメーションの長さ */
const ROTATE_DURATION = 250;
/** 回転・比率の変更などのあと、サイズと比率のラベルを出しておく時間 */
const PILL_DURATION = 1500;

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

type DragTarget = Handle | 'pan';

const CURSORS: Record<DragTarget, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  pan: 'move',
};

/** 画面への表示：画面上の点 = (ox, oy) + f × 出力座標 */
interface View {
  f: number;
  ox: number;
  oy: number;
}

export interface EditorCallbacks {
  onCancel(): void;
}

export class Editor {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private src: Size;
  private history: History;
  /** 表示中の状態（操作の途中は history.current と異なる） */
  private state: EditState;
  private view: View = { f: 1, ox: 0, oy: 0 };
  private mode: 'angle' | 'ratio' = 'angle';
  /** ドラッグ中（グリッドとサイズを表示する） */
  private dragging = false;
  private raf = 0;
  private animation = 0;
  private lastRatio: string | null = null;
  /** 90° 回転のアニメーション中、枠の中心を軸に追加で回す角度（度） */
  private spin = 0;
  /** この時刻（performance.now）まで、サイズと比率のラベルを出す */
  private pillsUntil = 0;
  private pillsTimer = 0;

  private ui!: {
    zoomIn: HTMLButtonElement;
    zoomOut: HTMLButtonElement;
    actualSize: HTMLButtonElement;
    zoomValue: HTMLElement;
    reset: HTMLButtonElement;
    undo: HTMLButtonElement;
    redo: HTMLButtonElement;
    save: HTMLButtonElement;
    cancel: HTMLButtonElement;
    sizePill: HTMLElement;
    ratioPill: HTMLElement;
    anglePanel: HTMLElement;
    angleValue: HTMLElement;
    ruler: HTMLElement;
    rulerCanvas: HTMLCanvasElement;
    rotateCcw: HTMLButtonElement;
    rotateCw: HTMLButtonElement;
    ratioButton: HTMLButtonElement;
    flipH: HTMLButtonElement;
    flipV: HTMLButtonElement;
    picker: HTMLElement;
    ratioItems: Map<string, HTMLButtonElement>;
    done: HTMLButtonElement;
  };

  constructor(
    private image: SourceImage,
    private callbacks: EditorCallbacks,
  ) {
    this.src = { w: image.width, h: image.height };
    this.history = new History(initialState(this.src));
    this.state = this.history.current;

    this.canvas = h('canvas', { class: 'stage' });
    this.ctx = this.canvas.getContext('2d')!;
    this.el = h('div', { class: 'editor' }, [this.canvas, ...this.buildUi()]);
    this.bindCanvas();

    window.addEventListener('resize', this.onResize);
    this.colorScheme.addEventListener('change', this.requestRender);
  }

  private colorScheme = window.matchMedia('(prefers-color-scheme: dark)');

  mount(parent: HTMLElement): void {
    parent.append(this.el);
    this.view = this.fitView(this.state);
    this.update();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.animation);
    clearTimeout(this.pillsTimer);
    window.removeEventListener('resize', this.onResize);
    this.colorScheme.removeEventListener('change', this.requestRender);
    this.el.remove();
  }

  // ===== 画面の組み立て =====

  private buildUi(): HTMLElement[] {
    const iconButton = (svg: string, size: number, label: string, cls = '') => {
      const b = h('button', { class: `btn-icon ${cls}`.trim(), type: 'button', 'aria-label': label }, [
        icon(svg, size),
      ]);
      return b;
    };

    const zoomIn = iconButton(ICONS.zoomIn, 16, 'ズームイン');
    const zoomOut = iconButton(ICONS.zoomOut, 16, 'ズームアウト');
    const actualSize = iconButton(ICONS.actualSize, 20, '実際のサイズ');
    const zoomValue = h('span', { class: 'zoom-value' });
    const reset = h('button', { class: 'btn-text', type: 'button', text: 'リセット' });
    const undo = iconButton(ICONS.undo, 16, '元に戻す', 'undo');
    const redo = iconButton(ICONS.redo, 16, 'やり直し', 'redo');

    const save = h('button', { class: 'btn-accent save-button', type: 'button', 'aria-haspopup': 'menu' }, [
      h('span', { text: '保存オプション' }),
      icon(ICONS.chevronDown, 12),
    ]);
    const cancel = h('button', { class: 'btn-standard cancel-button', type: 'button', text: 'キャンセル' });
    cancel.addEventListener('click', () => this.callbacks.onCancel());

    const toolbar = h('div', { class: 'toolbar' }, [
      h('div', { class: 'tool-group' }, [
        zoomIn,
        zoomOut,
        actualSize,
        zoomValue,
        h('span', { class: 'divider' }),
        reset,
        undo,
        redo,
      ]),
      h('div', { class: 'actions' }, [save, cancel]),
    ]);

    const sizePill = h('div', { class: 'pill', hidden: true });
    const ratioPill = h('div', { class: 'pill', hidden: true });

    // 角度スライダーと下部のボタン列
    const angleValue = h('div', { class: 'angle-value' });
    const rulerCanvas = h('canvas');
    const ruler = h(
      'div',
      {
        class: 'ruler',
        role: 'slider',
        tabindex: 0,
        'aria-label': '角度',
        'aria-valuemin': -45,
        'aria-valuemax': 45,
      },
      [rulerCanvas],
    );
    const rotateCcw = iconButton(ICONS.rotateCcw, 20, '画像を反時計回りに 90 度回転');
    const rotateCw = iconButton(ICONS.rotateCw, 20, '画像を時計回りに 90 度回転');
    const ratioButton = h('button', { class: 'ratio-button', type: 'button' });
    const flipH = iconButton(ICONS.flipH, 20, '画像を水平方向に反転');
    const flipV = iconButton(ICONS.flipV, 20, '画像を垂直方向に反転');
    const anglePanel = h('div', { class: 'bottom-panel' }, [
      angleValue,
      ruler,
      h('div', { class: 'bottom-row' }, [
        h('div', { class: 'group' }, [rotateCcw, rotateCw]),
        ratioButton,
        h('div', { class: 'group' }, [flipH, flipV]),
      ]),
    ]);

    // 比率ピッカー
    const ratioItems = new Map<string, HTMLButtonElement>();
    const list = h('div', { class: 'ratio-list', role: 'listbox', 'aria-label': '縦横比' });
    for (const r of RATIOS) {
      const item = h('button', { class: 'ratio-item', type: 'button', role: 'option', 'aria-label': r.tooltip }, [
        h('span', { class: 'ratio-icon' }, [icon(ratioIcon(r.id), 24)]),
        h('span', { class: 'ratio-label', text: r.label }),
      ]);
      ratioItems.set(r.id, item);
      list.append(item);
    }
    const done = h('button', { class: 'ratio-done', type: 'button', text: '完了' });
    const picker = h('div', { class: 'ratio-picker', hidden: true }, [list, done]);
    ratioButton.addEventListener('click', () => this.setMode('ratio'));
    done.addEventListener('click', () => this.setMode('angle'));
    for (const [id, item] of ratioItems) {
      item.addEventListener('click', () => this.chooseRatio(id as EditState['ratio']));
    }
    rotateCcw.addEventListener('click', () => this.rotate(-1));
    rotateCw.addEventListener('click', () => this.rotate(1));
    flipH.addEventListener('click', () => this.flipImage('h'));
    flipV.addEventListener('click', () => this.flipImage('v'));
    picker.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.setMode('angle');
    });
    this.bindRuler(ruler);

    this.ui = {
      zoomIn,
      zoomOut,
      actualSize,
      zoomValue,
      reset,
      undo,
      redo,
      save,
      cancel,
      sizePill,
      ratioPill,
      anglePanel,
      angleValue,
      ruler,
      rulerCanvas,
      rotateCcw,
      rotateCw,
      ratioButton,
      flipH,
      flipV,
      picker,
      ratioItems,
      done,
    };

    return [sizePill, ratioPill, anglePanel, picker, toolbar];
  }

  // ===== 操作 =====

  /** 操作の途中の状態を表示する（履歴にはまだ積まない） */
  private preview(state: EditState): void {
    this.stopAnimation();
    this.state = state;
    this.view = this.fitView(state);
    this.update();
  }

  /** 表示中の状態を確定して履歴に積む */
  private commit(): void {
    this.history.push(this.state);
    this.state = this.history.current;
    this.update();
  }

  /**
   * 角度スライダー：つまみは中央に固定で、目盛りのテープをドラッグする。
   * テープを左に動かすと値が大きくなる（0 がつまみの左へ流れる）。
   */
  private bindRuler(ruler: HTMLElement): void {
    ruler.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      // マウスで触ったときはフォーカス枠を出さない（方向キーはそのまま使えるようにする）
      ruler.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
      ruler.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startAngle = this.state.angle;
      const move = (ev: PointerEvent) => {
        this.preview(setAngle(this.state, startAngle - (ev.clientX - startX) / PX_PER_DEG));
      };
      const end = () => {
        ruler.removeEventListener('pointermove', move);
        ruler.removeEventListener('pointerup', end);
        ruler.removeEventListener('pointercancel', end);
        this.commit();
      };
      ruler.addEventListener('pointermove', move);
      ruler.addEventListener('pointerup', end);
      ruler.addEventListener('pointercancel', end);
    });

    // 方向キー：1 回で 1°、Shift と一緒に押すと 0.1°。押し続けた分はまとめて 1 回の操作にする
    const keyStep = (e: KeyboardEvent): number => {
      const step = e.shiftKey ? 0.1 : 1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') return step;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') return -step;
      return 0;
    };
    ruler.addEventListener('keydown', (e) => {
      const step = keyStep(e);
      if (!step) return;
      e.preventDefault();
      this.preview(setAngle(this.state, this.state.angle + step));
    });
    ruler.addEventListener('keyup', (e) => {
      if (keyStep(e)) this.commit();
    });
    ruler.addEventListener('blur', () => this.commit());
  }

  /** 画面上の点が、枠のどこに当たるか */
  private hitTest(px: number, py: number): DragTarget | null {
    const r = this.cropScreenRect();
    const x0 = r.x;
    const y0 = r.y;
    const x1 = r.x + r.w;
    const y1 = r.y + r.h;
    if (px < x0 - HIT_OUTSIDE || px > x1 + HIT_OUTSIDE || py < y0 - HIT_OUTSIDE || py > y1 + HIT_OUTSIDE) {
      return null;
    }
    // 枠線の近く（外側 HIT_OUTSIDE、内側 HIT_INSIDE）か
    const nearL = px <= x0 + HIT_INSIDE;
    const nearR = px >= x1 - HIT_INSIDE;
    const nearT = py <= y0 + HIT_INSIDE;
    const nearB = py >= y1 - HIT_INSIDE;
    // 四隅：L 字のハンドルの長さの範囲まで
    const len = Math.min(HANDLE_LENGTH, r.w / 3, r.h / 3);
    const inL = px <= x0 + len;
    const inR = px >= x1 - len;
    const inT = py <= y0 + len;
    const inB = py >= y1 - len;
    if ((nearT && inL) || (nearL && inT)) return 'nw';
    if ((nearT && inR) || (nearR && inT)) return 'ne';
    if ((nearB && inL) || (nearL && inB)) return 'sw';
    if ((nearB && inR) || (nearR && inB)) return 'se';
    if (nearT) return 'n';
    if (nearB) return 's';
    if (nearL) return 'w';
    if (nearR) return 'e';
    return 'pan';
  }

  private pointerPos(e: PointerEvent): { x: number; y: number } {
    const rect = this.el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private bindCanvas(): void {
    const canvas = this.canvas;

    canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) return;
      const p = this.pointerPos(e);
      const target = this.hitTest(p.x, p.y);
      canvas.style.cursor = target ? CURSORS[target] : '';
    });

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p0 = this.pointerPos(e);
      const target = this.hitTest(p0.x, p0.y);
      if (!target) return;
      e.preventDefault();
      this.stopAnimation();
      canvas.setPointerCapture(e.pointerId);

      const start = effectiveCrop(this.state, this.src);
      const startState = withCrop(this.state, start);
      const view = { ...this.view };
      const img = imageSize(this.state, this.src);
      const angle = this.state.angle;
      const options = this.dragOptions(start, view);
      this.dragging = true;

      const move = (ev: PointerEvent) => {
        const p = this.pointerPos(ev);
        const delta = { x: (p.x - p0.x) / view.f, y: (p.y - p0.y) / view.f };
        if (target === 'pan') {
          // 枠は動かさず、後ろの画像をスライドさせる
          this.preview(withCrop(startState, panCrop(start, delta, img, angle)));
        } else {
          // 画像は動かさず、枠を変形する（手を離すまで表示倍率は変えない）
          this.state = withCrop(startState, dragHandle(start, target, delta, options));
          this.view = view;
          this.update();
        }
      };
      const end = () => {
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', end);
        canvas.removeEventListener('pointercancel', end);
        this.dragging = false;
        this.commit();
        this.animateTo(this.fitView(this.state));
      };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);
      this.update();
    });
  }

  /** ハンドルのドラッグの制限：画像の内側、画面の見えている範囲、最小サイズ */
  private dragOptions(start: Crop, view: View) {
    const W = this.el.clientWidth;
    const H = this.el.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const stage = this.stageRect();
    const margin = 4;
    // 手を離して画面に合わせたとき、ズームの上限を超えない大きさ
    const minForZoom = Math.min(stage.w, stage.h) / (MAX_ZOOM / dpr);
    const minSize = Math.min(Math.max(MIN_CROP_SCREEN / view.f, minForZoom, 1), start.w, start.h);
    const img = imageSize(this.state, this.src);
    return {
      img,
      angle: this.state.angle,
      ratio: ratioValue(this.state.ratio, img),
      minSize,
      bounds: {
        x: (margin - view.ox) / view.f,
        y: (TOOLBAR_H + margin - view.oy) / view.f,
        w: (W - margin * 2) / view.f,
        h: (H - TOOLBAR_H - margin * 2) / view.f,
      },
    };
  }

  /** 表示倍率と枠の位置を、なめらかに target へ移す */
  private animateTo(target: View): void {
    this.stopAnimation();
    const from = { ...this.view };
    const crop = effectiveCrop(this.state, this.src);
    const pc = cropCenterOut(crop, this.state.angle);
    const fromC = { x: from.ox + from.f * pc.x, y: from.oy + from.f * pc.y };
    const toC = { x: target.ox + target.f * pc.x, y: target.oy + target.f * pc.y };
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / FIT_DURATION);
      const k = 1 - Math.pow(1 - t, 3);
      const f = from.f * Math.pow(target.f / from.f, k);
      const cx = fromC.x + (toC.x - fromC.x) * k;
      const cy = fromC.y + (toC.y - fromC.y) * k;
      this.view = t < 1 ? { f, ox: cx - f * pc.x, oy: cy - f * pc.y } : target;
      this.update();
      this.animation = t < 1 ? requestAnimationFrame(step) : 0;
    };
    this.animation = requestAnimationFrame(step);
  }

  private stopAnimation(): void {
    if (this.animation) {
      cancelAnimationFrame(this.animation);
      this.animation = 0;
    }
    if (this.spin) {
      this.spin = 0;
      this.view = this.fitView(this.state);
    }
  }

  /** 確定した状態に移り、表示を合わせる */
  private apply(next: EditState, animate: boolean): void {
    this.stopAnimation();
    this.history.push(next);
    this.state = this.history.current;
    if (animate) {
      this.update();
      this.animateTo(this.fitView(this.state));
    } else {
      this.view = this.fitView(this.state);
      this.update();
    }
  }

  /** サイズと比率のラベルをしばらく出す */
  private flashPills(): void {
    this.pillsUntil = performance.now() + PILL_DURATION;
    clearTimeout(this.pillsTimer);
    this.pillsTimer = window.setTimeout(() => this.requestRender(), PILL_DURATION + 20);
  }

  private chooseRatio(id: EditState['ratio']): void {
    this.apply(selectRatio(this.history.current, this.src, id), true);
  }

  /** 90° 回転：画像と枠を一緒に回しながら、新しい大きさに合わせる */
  private rotate(dir: 1 | -1): void {
    this.stopAnimation();
    const fromF = this.view.f;
    this.history.push(rotateQuarter(this.history.current, dir));
    this.state = this.history.current;
    const target = this.fitView(this.state);
    const pc = cropCenterOut(effectiveCrop(this.state, this.src), this.state.angle);
    const center = { x: target.ox + target.f * pc.x, y: target.oy + target.f * pc.y };
    this.flashPills();
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ROTATE_DURATION);
      const k = easeOut(t);
      const f = fromF * Math.pow(target.f / fromF, k);
      this.spin = t < 1 ? -dir * 90 * (1 - k) : 0;
      this.view = t < 1 ? { f, ox: center.x - f * pc.x, oy: center.y - f * pc.y } : target;
      this.update();
      this.animation = t < 1 ? requestAnimationFrame(step) : 0;
    };
    this.animation = requestAnimationFrame(step);
  }

  private flipImage(axis: 'h' | 'v'): void {
    this.apply(flip(this.history.current, axis), false);
  }

  private setMode(mode: 'angle' | 'ratio'): void {
    this.mode = mode;
    this.update();
  }

  // ===== 配置 =====

  /** 枠を収める領域（CSS px） */
  private stageRect(): Rect {
    const w = this.el.clientWidth;
    const hgt = this.el.clientHeight;
    return {
      x: STAGE_SIDE,
      y: STAGE_TOP,
      w: Math.max(1, w - STAGE_SIDE * 2),
      h: Math.max(1, hgt - STAGE_TOP - STAGE_BOTTOM),
    };
  }

  /** 枠を領域の中央に、縦横比を保って最大で表示するときの View */
  private fitView(state: EditState): View {
    const stage = this.stageRect();
    const crop = effectiveCrop(state, this.src);
    const f = fitScale(crop, stage);
    const r = cropRectOut(crop, state.angle);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    return { f, ox: stage.x + stage.w / 2 - f * cx, oy: stage.y + stage.h / 2 - f * cy };
  }

  /** 画面上の枠（CSS px） */
  private cropScreenRect(): Rect {
    const crop = effectiveCrop(this.state, this.src);
    const r = cropRectOut(crop, this.state.angle);
    const { f, ox, oy } = this.view;
    return { x: ox + f * r.x, y: oy + f * r.y, w: f * r.w, h: f * r.h };
  }

  private onResize = (): void => {
    this.stopAnimation();
    this.view = this.fitView(this.state);
    this.update();
  };

  // ===== 表示の更新 =====

  private requestRender = (): void => {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  };

  /** ボタンの状態・数値の表示を更新して、再描画する */
  private update(): void {
    const ui = this.ui;
    const dpr = window.devicePixelRatio || 1;
    const s = this.state;

    ui.zoomValue.textContent = `${Math.round(this.view.f * dpr * 100)}%`;
    ui.actualSize.disabled = true;
    ui.reset.disabled = sameState(this.history.current, initialState(this.src));
    ui.undo.disabled = !this.history.canUndo;
    ui.redo.disabled = !this.history.canRedo;

    ui.angleValue.textContent = `${formatAngle(s.angle)} °`;
    ui.ruler.setAttribute('aria-valuenow', String(s.angle));

    if (this.lastRatio !== s.ratio) {
      this.lastRatio = s.ratio;
      const def = ratioDef(s.ratio);
      ui.ratioButton.replaceChildren(icon(ratioIcon(s.ratio), 20), h('span', { text: def.label }));
      ui.ratioButton.setAttribute('aria-label', `縦横比: ${def.label}`);
      for (const [id, item] of ui.ratioItems) {
        item.classList.toggle('selected', id === s.ratio);
        item.setAttribute('aria-selected', String(id === s.ratio));
      }
    }

    ui.anglePanel.hidden = this.mode !== 'angle';
    ui.picker.hidden = this.mode !== 'ratio';

    this.requestRender();
  }

  private draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const W = this.el.clientWidth;
    const H = this.el.clientHeight;
    const canvas = this.canvas;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const css = getComputedStyle(this.el);
    const bg = css.getPropertyValue('--bg').trim();
    const overlayAlpha = parseFloat(css.getPropertyValue('--overlay-alpha')) || 0.75;
    const ctx = this.ctx;
    const s = this.state;
    const v = this.view;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 画像はツールバーの下端で切り取る
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, TOOLBAR_H, W, H - TOOLBAR_H);
    ctx.clip();

    // 90° 回転のアニメーション中は、枠の中心を軸に全体を回す
    const raw = this.cropScreenRect();
    if (this.spin) {
      const cx = raw.x + raw.w / 2;
      const cy = raw.y + raw.h / 2;
      ctx.translate(cx, cy);
      ctx.rotate(toRad(this.spin));
      ctx.translate(-cx, -cy);
    }

    ctx.save();
    ctx.translate(v.ox, v.oy);
    ctx.scale(v.f, v.f);
    ctx.rotate(toRad(s.angle));
    ctx.rotate((s.quarter * Math.PI) / 2);
    ctx.scale(s.flipH ? -1 : 1, s.flipV ? -1 : 1);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.image.bitmap, -this.src.w / 2, -this.src.h / 2);
    ctx.restore();

    // 枠をデバイスピクセルに合わせる
    const snap = (x: number) => (this.spin ? x : Math.round(x * dpr) / dpr);
    const x0 = snap(raw.x);
    const y0 = snap(raw.y);
    const x1 = snap(raw.x + raw.w);
    const y1 = snap(raw.y + raw.h);

    // 枠の外を暗くする
    ctx.globalAlpha = overlayAlpha;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.rect(-W, -H, W * 3, H * 3);
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.fill('evenodd');
    ctx.globalAlpha = 1;

    const px = Math.max(1, Math.round(dpr)) / dpr;

    // 三分割のグリッド（ドラッグ中）
    if (this.dragging) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = px;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      for (let i = 1; i <= 2; i++) {
        const gx = snap(x0 + ((x1 - x0) * i) / 3) + px / 2;
        const gy = snap(y0 + ((y1 - y0) * i) / 3) + px / 2;
        ctx.moveTo(gx, y0);
        ctx.lineTo(gx, y1);
        ctx.moveTo(x0, gy);
        ctx.lineTo(x1, gy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 枠線（枠のすぐ外側に 1 デバイスピクセル）
    ctx.fillStyle = css.getPropertyValue('--frame').trim();
    ctx.fillRect(x0 - px, y0 - px, x1 - x0 + 2 * px, px);
    ctx.fillRect(x0 - px, y1, x1 - x0 + 2 * px, px);
    ctx.fillRect(x0 - px, y0, px, y1 - y0);
    ctx.fillRect(x1, y0, px, y1 - y0);

    // ハンドル（枠の外側に向かって太く）
    const t = Math.round(HANDLE_THICKNESS * dpr) / dpr;
    const len = Math.min(HANDLE_LENGTH, (x1 - x0) / 3 + t, (y1 - y0) / 3 + t);
    const cx = snap((x0 + x1) / 2);
    const cy = snap((y0 + y1) / 2);
    const half = snap(len / 2);
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 4 * dpr;
    ctx.beginPath();
    // 四隅の L 字
    ctx.rect(x0 - t, y0 - t, len, t);
    ctx.rect(x0 - t, y0, t, len - t);
    ctx.rect(x1 + t - len, y0 - t, len, t);
    ctx.rect(x1, y0, t, len - t);
    ctx.rect(x0 - t, y1, len, t);
    ctx.rect(x0 - t, y1 + t - len, t, len - t);
    ctx.rect(x1 + t - len, y1, len, t);
    ctx.rect(x1, y1 + t - len, t, len - t);
    // 各辺の中央
    ctx.rect(cx - half, y0 - t, half * 2, t);
    ctx.rect(cx - half, y1, half * 2, t);
    ctx.rect(x0 - t, cy - half, t, half * 2);
    ctx.rect(x1, cy - half, t, half * 2);
    ctx.fill();
    ctx.restore();

    ctx.restore();

    this.placePills(x0, y0, x1, y1);
    this.drawRuler();
  }

  private placePills(x0: number, y0: number, x1: number, y1: number): void {
    const ui = this.ui;
    const crop = effectiveCrop(this.state, this.src);
    const flashing = performance.now() < this.pillsUntil;
    const showSize = !this.spin && (this.dragging || this.mode === 'ratio' || flashing);
    const def = ratioDef(this.state.ratio);
    const showRatio = !this.spin && (this.mode === 'ratio' || flashing) && def.id !== 'free';
    const cx = (x0 + x1) / 2;

    ui.sizePill.hidden = !showSize;
    if (showSize) {
      ui.sizePill.textContent = `${roundHalfEven(crop.w)} x ${roundHalfEven(crop.h)}`;
      ui.sizePill.style.left = `${cx}px`;
      ui.sizePill.style.top = `${y1 - 6 - ui.sizePill.offsetHeight}px`;
    }
    ui.ratioPill.hidden = !showRatio;
    if (showRatio) {
      ui.ratioPill.textContent = this.ratioPillText();
      ui.ratioPill.style.left = `${cx}px`;
      ui.ratioPill.style.top = `${y0 + 6}px`;
    }
  }

  /** 枠の上に出す比率の文字。オリジナルは元画像の比率を数値で出す */
  private ratioPillText(): string {
    const def = ratioDef(this.state.ratio);
    if (def.w !== undefined) return def.id === 'square' ? '1 : 1' : def.label;
    const img = imageSize(this.state, this.src);
    const g = gcd(img.w, img.h);
    return `${img.w / g} : ${img.h / g}`;
  }

  private drawRuler(): void {
    if (this.mode !== 'angle') return;
    const css = getComputedStyle(this.el);
    drawRuler(
      this.ui.rulerCanvas,
      this.state.angle,
      css.getPropertyValue('--ruler').trim(),
      css.getPropertyValue('--thumb').trim(),
    );
  }
}

/** 角度の表示：整数ならそのまま、それ以外は小数第 1 位まで */
export function formatAngle(angle: number): string {
  const a = Math.round(angle * 10) / 10;
  return Number.isInteger(a) ? String(a) : a.toFixed(1);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
