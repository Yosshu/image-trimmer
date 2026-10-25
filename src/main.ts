import './styles.css';
import { Editor } from './editor';
import { findImageFile, loadImageFile } from './loader';
import { StartScreen } from './startScreen';

const app = document.getElementById('app')!;

let start: StartScreen | null = null;
let editor: Editor | null = null;

function showStart(): void {
  editor?.destroy();
  editor = null;
  start = new StartScreen(openFile);
  app.replaceChildren(start.el);
}

async function openFile(file: File): Promise<void> {
  try {
    const image = await loadImageFile(file);
    start = null;
    editor?.destroy();
    app.replaceChildren();
    editor = new Editor(image, { onCancel: showStart });
    editor.mount(app);
  } catch {
    if (start) start.showError('この画像は開けませんでした。別の画像を選んでください。');
  }
}

// ドラッグ＆ドロップ（開始画面・編集画面のどちらでも受け付ける）
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  dragDepth++;
  start?.setDragOver(true);
});
window.addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) start?.setDragOver(false);
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  start?.setDragOver(false);
  const file = findImageFile(e.dataTransfer);
  if (file) void openFile(file);
  else start?.showError('画像ファイルをドロップしてください。');
});

// 貼り付け
window.addEventListener('paste', (e) => {
  const file = findImageFile(e.clipboardData);
  if (!file) return;
  e.preventDefault();
  void openFile(file);
});

showStart();
