import { h } from './dom';
import { ICONS, icon } from './icons';

/** 画像を開く画面（Web 版独自）。ドラッグ＆ドロップと貼り付けは main.ts でウィンドウ全体に対して受け付ける */
export class StartScreen {
  readonly el: HTMLElement;
  private error: HTMLElement;
  private input: HTMLInputElement;

  constructor(onFile: (file: File) => void) {
    this.input = h('input', { type: 'file', accept: 'image/*', hidden: true });
    this.input.addEventListener('change', () => {
      const file = this.input.files?.[0];
      this.input.value = '';
      if (file) onFile(file);
    });
    const open = h('button', { class: 'btn-accent', type: 'button', text: 'ファイルを選択' });
    open.addEventListener('click', () => this.input.click());
    this.error = h('p', { class: 'start-error', role: 'alert' });
    this.el = h('div', { class: 'start' }, [
      h('div', { class: 'start-card' }, [
        icon(ICONS.imageAdd, 48),
        h('h1', { class: 'start-title', text: '画像を開く' }),
        h('p', {
          class: 'start-hint',
          text: '画像をここにドラッグ＆ドロップするか、Ctrl+V で貼り付けます',
        }),
        open,
        this.error,
        h('p', { class: 'start-note', text: '画像はブラウザの中だけで処理され、どこにも送信されません' }),
        this.input,
      ]),
    ]);
  }

  setDragOver(on: boolean): void {
    this.el.classList.toggle('drag-over', on);
  }

  showError(message: string): void {
    this.error.textContent = message;
  }
}
