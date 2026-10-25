import { h } from './dom';
import { cropRectOut, fitScale, type Rect, roundHalfEven, type Size, toRad } from './geometry';
import { ICONS, icon, ratioIcon } from './icons';
import type { SourceImage } from './loader';
import { RATIOS, ratioDef } from './ratios';
import { drawRuler, PX_PER_DEG } from './ruler';
import { effectiveCrop, type EditState, History, imageSize, initialState, sameState, setAngle } from './state';

/** 画面の配置（CSS px）。docs/SPEC.md §1 */
const TOOLBAR_H = 52;
const STAGE_TOP = 118;
const STAGE_BOTTOM = 159;
const STAGE_SIDE = 64;

/** ハンドルの太さ（本家の実測 4 物理 px ÷ 125%）と長さ */
const HANDLE_THICKNESS = 3.2;
const HANDLE_LENGTH = 28;

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

    const def = ratioDef(s.ratio);
    ui.ratioButton.replaceChildren(icon(ratioIcon(s.ratio), 20), h('span', { text: def.label }));
    ui.ratioButton.setAttribute('aria-label', `縦横比: ${def.label}`);
    for (const [id, item] of ui.ratioItems) {
      item.classList.toggle('selected', id === s.ratio);
      item.setAttribute('aria-selected', String(id === s.ratio));
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
    const raw = this.cropScreenRect();
    const snap = (x: number) => Math.round(x * dpr) / dpr;
    const x0 = snap(raw.x);
    const y0 = snap(raw.y);
    const x1 = snap(raw.x + raw.w);
    const y1 = snap(raw.y + raw.h);

    // 枠の外を暗くする
    ctx.globalAlpha = overlayAlpha;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.rect(0, TOOLBAR_H, W, H - TOOLBAR_H);
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
    const showSize = this.dragging || this.mode === 'ratio';
    const def = ratioDef(this.state.ratio);
    const showRatio = this.mode === 'ratio' && def.id !== 'free';
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
