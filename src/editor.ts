import { h } from './dom';
import { copyToClipboard, defaultSaveTarget, download, exportBlob, getSaveFilePicker, saveWithPicker } from './export';
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
import { showSaveDialog } from './saveDialog';
import { Tooltips } from './tooltip';
import {
  effectiveCrop,
  type EditState,
  flip,
  History,
  imageSize,
  initialState,
  canZoomOut,
  rotateQuarter,
  sameState,
  selectRatio,
  setAngle,
  withCrop,
  zoom,
} from './state';

/** 画面の配置（CSS px）。docs/SPEC.md §1 */
interface Layout {
  /** ツールバーの下端（画像はここで切り取る） */
  toolbarH: number;
  /** 枠を収める領域：上端、下からの距離、左右の余白 */
  stageTop: number;
  stageBottom: number;
  stageSide: number;
}

const LAYOUT: Layout = { toolbarH: 52, stageTop: 118, stageBottom: 159, stageSide: 64 };
/** 狭い画面（スマホなど）：ツールバーを 2 段にし、余白を詰める（Web 版独自） */
const COMPACT_LAYOUT: Layout = { toolbarH: 100, stageTop: 124, stageBottom: 150, stageSide: 20 };
const COMPACT_WIDTH = 720;

/** ハンドルの太さ（本家の実測 4 物理 px ÷ 125%）と長さ */
const HANDLE_THICKNESS = 3.2;
const HANDLE_LENGTH = 28;
/** ハンドルをつかめる範囲：枠線から外側・内側への距離 */
const HIT_OUTSIDE = 14;
const HIT_INSIDE = 10;
/** タッチ操作では指の大きさに合わせて広げる */
const HIT_TOUCH = 24;
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

/** ズームボタン 1 回の倍率 */
const ZOOM_STEP = 1.25;
const ZOOM_DURATION = 150;
/** ホイールでのズームを 1 回の操作としてまとめる間隔 */
const WHEEL_COMMIT_DELAY = 300;

const CROP_TOOLTIP = 'ハンドルをドラッグするか、矢印キーを使用して画像をトリミングします';

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
  /** 実行中のアニメーションの種類（止めたときの後始末が違う） */
  private animationKind: 'fit' | 'spin' | 'zoom' | null = null;
  private lastRatio: string | null = null;
  /** 90° 回転のアニメーション中、枠の中心を軸に追加で回す角度（度） */
  private spin = 0;
  /** この時刻（performance.now）まで、サイズと比率のラベルを出す */
  private pillsUntil = 0;
  private pillsTimer = 0;
  private wheelTimer = 0;
  private tips: Tooltips;

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
    this.tips = new Tooltips(this.el);
    for (const el of this.el.querySelectorAll<HTMLElement>('[data-tooltip]')) {
      this.tips.attach(el, el.dataset.tooltip!, el.dataset.tooltipStyle === 'b' ? 'b' : 'a');
    }
    this.bindCanvas();

    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
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
    clearTimeout(this.wheelTimer);
    this.tips.destroy();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    this.colorScheme.removeEventListener('change', this.requestRender);
    this.el.remove();
  }

  // ===== 画面の組み立て =====

  private buildUi(): HTMLElement[] {
    const iconButton = (svg: string, size: number, label: string, cls = '') => {
      const b = h(
        'button',
        { class: `btn-icon ${cls}`.trim(), type: 'button', 'aria-label': label, 'data-tooltip': label },
        [icon(svg, size)],
      );
      return b;
    };

    const zoomIn = iconButton(ICONS.zoomIn, 16, 'ズームイン');
    const zoomOut = iconButton(ICONS.zoomOut, 16, 'ズームアウト');
    const actualSize = iconButton(ICONS.actualSize, 20, '実際のサイズ');
    const zoomValue = h('span', { class: 'zoom-value' });
    const reset = h('button', { class: 'btn-text', type: 'button', text: 'リセット' });
    const undo = iconButton(ICONS.undo, 16, '元に戻す', 'undo');
    const redo = iconButton(ICONS.redo, 16, 'やり直し', 'redo');

    const save = h('button', {
      class: 'btn-accent save-button',
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
    }, [
      h('span', { text: '保存オプション' }),
      icon(ICONS.chevronDown, 12),
    ]);
    const cancel = h('button', { class: 'btn-standard cancel-button', type: 'button', text: 'キャンセル' });
    cancel.addEventListener('click', () => this.callbacks.onCancel());
    zoomIn.addEventListener('click', () => this.zoomBy(ZOOM_STEP));
    zoomOut.addEventListener('click', () => this.zoomBy(1 / ZOOM_STEP));
    reset.addEventListener('click', () => this.apply(() => initialState(this.src), false));
    undo.addEventListener('click', () => this.undo());
    redo.addEventListener('click', () => this.redo());

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
      h('div', { class: 'actions' }, [save, cancel, this.buildSaveMenu(save)]),
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
        'data-tooltip': 'ドラッグするか、方向キーを使用して画像を回転',
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
      const item = h(
        'button',
        { class: 'ratio-item', type: 'button', role: 'option', 'aria-label': r.tooltip, 'data-tooltip': r.tooltip },
        [
          h('span', { class: 'ratio-icon' }, [icon(ratioIcon(r.id), 24)]),
          h('span', { class: 'ratio-label', text: r.label }),
        ],
      );
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
    this.stopAnimation();
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
      this.settle();
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
    let keyActive = false;
    ruler.addEventListener('keydown', (e) => {
      const step = keyStep(e);
      if (!step) return;
      e.preventDefault();
      if (!keyActive) this.settle();
      keyActive = true;
      this.preview(setAngle(this.state, this.state.angle + step));
    });
    ruler.addEventListener('keyup', (e) => {
      if (!keyStep(e) || !keyActive) return;
      keyActive = false;
      this.commit();
    });
    ruler.addEventListener('blur', () => this.commit());
  }

  /** 画面上の点が、枠のどこに当たるか */
  private hitTest(px: number, py: number, touch = false): DragTarget | null {
    const r = this.cropScreenRect();
    const x0 = r.x;
    const y0 = r.y;
    const x1 = r.x + r.w;
    const y1 = r.y + r.h;
    const outside = touch ? HIT_TOUCH : HIT_OUTSIDE;
    // 枠が小さいときは、内側の判定を詰めて画像をスライドできる範囲を残す
    const inside = Math.min(touch ? HIT_TOUCH : HIT_INSIDE, r.w / 4, r.h / 4);
    if (px < x0 - outside || px > x1 + outside || py < y0 - outside || py > y1 + outside) {
      return null;
    }
    // 枠線の近く（外側 outside、内側 inside）か
    const nearL = px <= x0 + inside;
    const nearR = px >= x1 - inside;
    const nearT = py <= y0 + inside;
    const nearB = py >= y1 - inside;
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
      const target = this.hitTest(p.x, p.y, e.pointerType === 'touch');
      canvas.style.cursor = target ? CURSORS[target] : '';
      if (target && e.pointerType !== 'touch') this.tips.hoverAt(CROP_TOOLTIP, e.clientX, e.clientY);
      else this.tips.hide();
    });
    canvas.addEventListener('pointerleave', () => this.tips.hide());

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p0 = this.pointerPos(e);
      const target = this.hitTest(p0.x, p0.y, e.pointerType === 'touch');
      if (!target) return;
      e.preventDefault();
      this.tips.hide();
      this.settle();
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

    // ホイール：ズームイン／ズームアウトと同じ。続けて回した分は 1 回の操作にまとめる
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (this.dragging) return;
        this.stopAnimation();
        const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        let factor = Math.exp(-delta * 0.002);
        if (factor > 1) factor = Math.min(factor, this.maxZoomFactor());
        if (factor > 1 + 1e-6 || (factor < 1 && canZoomOut(this.state, this.src))) {
          this.preview(zoom(this.state, this.src, factor));
          this.flashPills();
        }
        clearTimeout(this.wheelTimer);
        this.wheelTimer = window.setTimeout(() => this.commit(), WHEEL_COMMIT_DELAY);
      },
      { passive: false },
    );

    // 矢印キー：枠を動かす（後ろの画像が逆向きにスライドする）。Shift と一緒なら右辺・下辺を動かして大きさを変える
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', CROP_TOOLTIP);
    canvas.addEventListener('focus', this.requestRender);
    canvas.addEventListener('blur', this.requestRender);
    let keyStart: Crop | null = null;
    const arrow = (e: KeyboardEvent): { x: number; y: number } | null => {
      const n = e.ctrlKey ? 10 : 1;
      if (e.key === 'ArrowLeft') return { x: -n, y: 0 };
      if (e.key === 'ArrowRight') return { x: n, y: 0 };
      if (e.key === 'ArrowUp') return { x: 0, y: -n };
      if (e.key === 'ArrowDown') return { x: 0, y: n };
      return null;
    };
    canvas.addEventListener('keydown', (e) => {
      const d = arrow(e);
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      if (!keyStart) this.settle();
      const crop = effectiveCrop(this.state, this.src);
      keyStart ??= crop;
      const f = this.view.f;
      const img = imageSize(this.state, this.src);
      if (e.shiftKey) {
        const handle: Handle = d.x !== 0 ? 'e' : 's';
        const next = dragHandle(crop, handle, { x: d.x / f, y: d.y / f }, this.dragOptions(crop, this.view));
        this.state = withCrop(this.state, next);
        this.update();
      } else {
        this.preview(withCrop(this.state, panCrop(crop, { x: -d.x / f, y: -d.y / f }, img, this.state.angle)));
      }
    });
    canvas.addEventListener('keyup', (e) => {
      if (!arrow(e) && e.key !== 'Shift') return;
      if (!keyStart) return;
      keyStart = null;
      this.commit();
      this.animateTo(this.fitView(this.state));
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
        y: (this.layout().toolbarH + margin - view.oy) / view.f,
        w: (W - margin * 2) / view.f,
        h: (H - this.layout().toolbarH - margin * 2) / view.f,
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
    this.startAnimation('fit', (now) => {
      const t = Math.min(1, (now - t0) / FIT_DURATION);
      const k = easeOut(t);
      const f = from.f * Math.pow(target.f / from.f, k);
      const cx = fromC.x + (toC.x - fromC.x) * k;
      const cy = fromC.y + (toC.y - fromC.y) * k;
      this.view = t < 1 ? { f, ox: cx - f * pc.x, oy: cy - f * pc.y } : target;
      this.update();
      return t < 1;
    });
  }

  /** アニメーションを止める。回転・ズームは最後の状態に、枠を中央に戻す途中ならその位置のままにする */
  private stopAnimation(): void {
    if (!this.animation) return;
    cancelAnimationFrame(this.animation);
    this.animation = 0;
    const kind = this.animationKind;
    this.animationKind = null;
    if (kind === 'spin' || kind === 'zoom') {
      this.spin = 0;
      this.state = this.history.current;
      this.view = this.fitView(this.state);
    }
  }

  private startAnimation(kind: 'fit' | 'spin' | 'zoom', step: (now: number) => boolean): void {
    this.animationKind = kind;
    const frame = (now: number) => {
      const more = step(now);
      this.animation = more ? requestAnimationFrame(frame) : 0;
      if (!more) this.animationKind = null;
    };
    this.animation = requestAnimationFrame(frame);
  }

  /** ホイールのズームなど、まだ履歴に積んでいない操作を確定する */
  private settle(): void {
    clearTimeout(this.wheelTimer);
    this.stopAnimation();
    if (!this.dragging && !sameState(this.state, this.history.current)) {
      this.history.push(this.state);
      this.state = this.history.current;
    }
  }

  /** 確定した状態に移り、表示を合わせる */
  private apply(next: (current: EditState) => EditState, animate: boolean): void {
    this.settle();
    this.history.push(next(this.history.current));
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
    this.apply((s) => selectRatio(s, this.src, id), true);
  }

  /** 90° 回転：画像と枠を一緒に回しながら、新しい大きさに合わせる */
  private rotate(dir: 1 | -1): void {
    this.settle();
    const fromF = this.view.f;
    this.history.push(rotateQuarter(this.history.current, dir));
    this.state = this.history.current;
    const target = this.fitView(this.state);
    const pc = cropCenterOut(effectiveCrop(this.state, this.src), this.state.angle);
    const center = { x: target.ox + target.f * pc.x, y: target.oy + target.f * pc.y };
    this.flashPills();
    const t0 = performance.now();
    this.startAnimation('spin', (now) => {
      const t = Math.min(1, (now - t0) / ROTATE_DURATION);
      const k = easeOut(t);
      const f = fromF * Math.pow(target.f / fromF, k);
      this.spin = t < 1 ? -dir * 90 * (1 - k) : 0;
      this.view = t < 1 ? { f, ox: center.x - f * pc.x, oy: center.y - f * pc.y } : target;
      this.update();
      return t < 1;
    });
  }

  /** 今よりどれだけ拡大できるか（ズームの上限まで） */
  private maxZoomFactor(): number {
    const dpr = window.devicePixelRatio || 1;
    const f = fitScale(effectiveCrop(this.state, this.src), this.stageRect());
    return MAX_ZOOM / dpr / f;
  }

  /** ズーム：枠の画面上の大きさは変えず、後ろの画像を拡大・縮小する */
  private zoomBy(factor: number): void {
    this.settle();
    const start = this.history.current;
    const target = factor > 1 ? Math.min(factor, this.maxZoomFactor()) : factor;
    if (target > 1 && target <= 1 + 1e-6) return;
    if (target < 1 && !canZoomOut(start, this.src)) return;
    // 最後の状態を先に確定し、途中の状態は表示だけに使う
    this.history.push(zoom(start, this.src, target));
    this.flashPills();
    const t0 = performance.now();
    this.startAnimation('zoom', (now) => {
      const t = Math.min(1, (now - t0) / ZOOM_DURATION);
      this.state = t < 1 ? zoom(start, this.src, Math.pow(target, easeOut(t))) : this.history.current;
      this.view = this.fitView(this.state);
      this.update();
      return t < 1;
    });
  }

  private undo(): void {
    this.settle();
    this.state = this.history.undo();
    this.view = this.fitView(this.state);
    this.update();
  }

  private redo(): void {
    this.settle();
    this.state = this.history.redo();
    this.view = this.fitView(this.state);
    this.update();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) {
      e.preventDefault();
      this.redo();
    } else if (ctrl && (key === '+' || key === '=' || key === ';')) {
      e.preventDefault();
      this.zoomBy(ZOOM_STEP);
    } else if (ctrl && key === '-') {
      e.preventDefault();
      this.zoomBy(1 / ZOOM_STEP);
    } else if (key === 'escape' && this.mode === 'ratio') {
      this.setMode('angle');
    }
  };

  private flipImage(axis: 'h' | 'v'): void {
    this.apply((s) => flip(s, axis), false);
  }

  private setMode(mode: 'angle' | 'ratio'): void {
    this.mode = mode;
    this.update();
  }

  // ===== 保存 =====

  /** 「保存オプション」のメニュー */
  private buildSaveMenu(button: HTMLButtonElement): HTMLElement {
    const saveCopy = h('button', {
      class: 'menu-item',
      type: 'button',
      role: 'menuitem',
      text: 'コピーとして保存',
      'data-tooltip': '画像のコピーを保存します',
      'data-tooltip-style': 'b',
    });
    const copy = h('button', {
      class: 'menu-item',
      type: 'button',
      role: 'menuitem',
      text: 'クリップボードにコピー',
      'data-tooltip': '画像をクリップボードにコピーします',
      'data-tooltip-style': 'b',
    });
    const menu = h('div', { class: 'menu', role: 'menu', hidden: true }, [saveCopy, copy]);
    const items = [saveCopy, copy];

    const close = () => {
      if (menu.hidden) return;
      this.tips.hide();
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onOutside, true);
    };
    const onOutside = (e: PointerEvent) => {
      if (!menu.contains(e.target as Node) && !button.contains(e.target as Node)) close();
    };
    const open = () => {
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', onOutside, true);
    };

    button.addEventListener('click', () => (menu.hidden ? open() : close()));
    button.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && menu.hidden) {
        e.preventDefault();
        open();
        items[0].focus();
      }
    });
    menu.addEventListener('keydown', (e) => {
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        button.focus();
      }
    });
    saveCopy.addEventListener('click', () => {
      close();
      void this.saveCopy();
    });
    copy.addEventListener('click', () => {
      close();
      void this.copy();
    });
    return menu;
  }

  /** コピーとして保存（名前を付けて保存） */
  private async saveCopy(): Promise<void> {
    const state = this.history.current;
    try {
      const picker = getSaveFilePicker();
      if (picker) {
        await saveWithPicker(picker, state, this.image);
        return;
      }
      const target = await showSaveDialog(defaultSaveTarget(this.image));
      if (!target) return;
      download(await exportBlob(state, this.image, target.format), target.name);
    } catch {
      this.toast('保存できませんでした');
    }
  }

  private async copy(): Promise<void> {
    try {
      await copyToClipboard(this.history.current, this.image);
      this.toast('クリップボードにコピーしました');
    } catch {
      this.toast('クリップボードにコピーできませんでした');
    }
  }

  /** 画面下部に短いお知らせを出す（Web 版独自） */
  private toast(message: string): void {
    this.el.querySelector('.toast')?.remove();
    const el = h('div', { class: 'toast', role: 'status', text: message });
    this.el.append(el);
    setTimeout(() => el.classList.add('hide'), 2000);
    setTimeout(() => el.remove(), 2400);
  }

  // ===== 配置 =====

  /** 枠を収める領域（CSS px） */
  private layout(): Layout {
    return this.el.clientWidth < COMPACT_WIDTH ? COMPACT_LAYOUT : LAYOUT;
  }

  private stageRect(): Rect {
    const w = this.el.clientWidth;
    const hgt = this.el.clientHeight;
    const l = this.layout();
    return {
      x: l.stageSide,
      y: l.stageTop,
      w: Math.max(1, w - l.stageSide * 2),
      h: Math.max(1, hgt - l.stageTop - l.stageBottom),
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
    this.el.classList.toggle('compact', this.layout() === COMPACT_LAYOUT);
    const dpr = window.devicePixelRatio || 1;
    const s = this.state;

    ui.zoomValue.textContent = `${Math.round(this.view.f * dpr * 100)}%`;
    ui.actualSize.disabled = true;
    ui.zoomIn.disabled = this.maxZoomFactor() <= 1 + 1e-6;
    ui.zoomOut.disabled = !canZoomOut(this.state, this.src);
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
    const toolbarH = this.layout().toolbarH;
    ctx.rect(0, toolbarH, W, H - toolbarH);
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

    // キーボードで枠にフォーカスしたときの枠
    if (this.canvas.matches(':focus-visible')) {
      const g = t + 3;
      ctx.strokeStyle = css.getPropertyValue('--focus').trim();
      ctx.lineWidth = 2;
      ctx.strokeRect(x0 - g, y0 - g, x1 - x0 + g * 2, y1 - y0 + g * 2);
    }

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
