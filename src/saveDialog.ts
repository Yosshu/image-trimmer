import { h } from './dom';
import { FORMATS, formatDef, formatFromName, formatLabel, type SaveFormat, withExtension } from './export';

/**
 * 「名前を付けて保存」の簡易ダイアログ（OS の保存ダイアログが使えないブラウザ用。Web 版独自）。
 * 保存なら名前と形式、キャンセルなら null を返す。
 */
export function showSaveDialog(initial: { name: string; format: SaveFormat }): Promise<{
  name: string;
  format: SaveFormat;
} | null> {
  return new Promise((resolve) => {
    const nameInput = h('input', { class: 'field', type: 'text', value: initial.name, spellcheck: 'false' });
    const typeSelect = h(
      'select',
      { class: 'field' },
      FORMATS.map((f) => h('option', { value: f.id, text: formatLabel(f), selected: f.id === initial.format })),
    );
    const ok = h('button', { class: 'btn-accent', type: 'submit', text: '保存' });
    const cancel = h('button', { class: 'btn-standard', type: 'button', text: 'キャンセル' });
    const form = h('form', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'save-title' }, [
      h('div', { class: 'dialog-body' }, [
        h('h2', { class: 'dialog-title', id: 'save-title', text: '名前を付けて保存' }),
        h('label', { class: 'dialog-label' }, ['ファイル名', nameInput]),
        h('label', { class: 'dialog-label' }, ['ファイルの種類', typeSelect]),
      ]),
      h('div', { class: 'dialog-footer' }, [ok, cancel]),
    ]);
    const overlay = h('div', { class: 'dialog-overlay' }, [form]);

    const close = (result: { name: string; format: SaveFormat } | null) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      }
      // 編集画面のショートカット（Ctrl+Z など）がダイアログの入力中に効かないようにする
      e.stopPropagation();
    };

    typeSelect.addEventListener('change', () => {
      nameInput.value = withExtension(nameInput.value.trim() || '画像', typeSelect.value as SaveFormat);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = nameInput.value.trim() || '画像';
      const format = typeSelect.value as SaveFormat;
      // 入力された拡張子が一覧の形式なら、その形式を優先する
      const typed = formatFromName(raw);
      const finalFormat = typed ?? format;
      close({ name: typed ? raw : raw + formatDef(format).ext[0], format: finalFormat });
    });
    cancel.addEventListener('click', () => close(null));
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) close(null);
    });
    document.addEventListener('keydown', onKey, true);

    document.body.append(overlay);
    nameInput.focus();
    nameInput.setSelectionRange(0, nameInput.value.replace(/\.[^.]+$/, '').length);
  });
}
