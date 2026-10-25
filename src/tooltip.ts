import { h } from './dom';

/** マウスを止めてからツールチップを出すまでの時間 */
const SHOW_DELAY = 600;

/**
 * ツールチップ。docs/SPEC.md §1.8
 * - A：ボタン・スライダー・枠。白い枠線、角は丸めない。マウスの位置の下に出す
 * - B：保存オプションのメニュー項目。角丸。メニューの左側に出す
 */
export class Tooltips {
  private el: HTMLElement;
  private timer = 0;
  private pos = { x: 0, y: 0 };

  constructor(root: HTMLElement) {
    this.el = h('div', { class: 'tooltip', role: 'tooltip', hidden: true });
    root.append(this.el);
  }

  /** 要素にツールチップを付ける。text が空なら出さない */
  attach(target: HTMLElement, text: string | (() => string), style: 'a' | 'b' = 'a'): void {
    const read = () => (typeof text === 'function' ? text() : text);
    target.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'touch') return;
      this.pos = { x: e.clientX, y: e.clientY };
      this.schedule(() => {
        if (style === 'b') this.showBeside(read(), target);
        else this.showAt(read(), this.pos.x, this.pos.y);
      });
    });
    target.addEventListener('pointermove', (e) => {
      if (this.el.hidden) this.pos = { x: e.clientX, y: e.clientY };
    });
    target.addEventListener('pointerleave', () => this.hide());
    target.addEventListener('pointerdown', () => this.hide());
    target.addEventListener('blur', () => this.hide());
  }

  /** マウスを止めたら出す（キャンバス上の枠など、要素ではない範囲用） */
  hoverAt(text: string, x: number, y: number): void {
    if (!this.el.hidden && this.el.textContent === text) return;
    this.pos = { x, y };
    this.schedule(() => this.showAt(text, this.pos.x, this.pos.y));
  }

  hide(): void {
    clearTimeout(this.timer);
    this.timer = 0;
    this.el.hidden = true;
  }

  destroy(): void {
    this.hide();
    this.el.remove();
  }

  private schedule(show: () => void): void {
    clearTimeout(this.timer);
    this.el.hidden = true;
    this.timer = window.setTimeout(show, SHOW_DELAY);
  }

  private showAt(text: string, x: number, y: number): void {
    if (!text) return;
    this.el.className = 'tooltip tooltip-a';
    this.el.textContent = text;
    this.el.hidden = false;
    const r = this.el.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - r.width - 4);
    let top = y + 22;
    if (top + r.height > window.innerHeight - 4) top = y - r.height - 8;
    this.el.style.left = `${Math.max(4, left)}px`;
    this.el.style.top = `${Math.max(4, top)}px`;
  }

  private showBeside(text: string, target: HTMLElement): void {
    if (!text) return;
    this.el.className = 'tooltip tooltip-b';
    this.el.textContent = text;
    this.el.hidden = false;
    const t = target.getBoundingClientRect();
    const menu = target.parentElement?.getBoundingClientRect() ?? t;
    const r = this.el.getBoundingClientRect();
    this.el.style.left = `${Math.max(4, menu.left - 8 - r.width)}px`;
    this.el.style.top = `${Math.max(4, t.top + t.height / 2 - r.height / 2)}px`;
  }
}
