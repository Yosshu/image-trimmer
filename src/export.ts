import { encodeBmp, encodeTiff } from './encoders';
import { cropCenterOut, cropPixelRect, roundHalfEven, toRad } from './geometry';
import type { SourceImage } from './loader';
import { effectiveCrop, type EditState, imageSize } from './state';

export type SaveFormat = 'png' | 'jpeg' | 'tiff' | 'bmp';

export interface FormatDef {
  id: SaveFormat;
  /** 保存ダイアログの「ファイルの種類」に出す名前（本家と同じ表記） */
  label: string;
  mime: string;
  ext: string[];
}

/** 本家の保存ダイアログと同じ順。JPEG XR と HEIC はブラウザでは書き出せないので除く */
export const FORMATS: readonly FormatDef[] = [
  { id: 'png', label: 'PNG', mime: 'image/png', ext: ['.png'] },
  { id: 'jpeg', label: 'JPEG', mime: 'image/jpeg', ext: ['.jpg', '.jpeg', '.jpe', '.jfif'] },
  { id: 'tiff', label: 'TIFF', mime: 'image/tiff', ext: ['.tif', '.tiff'] },
  { id: 'bmp', label: 'BMP', mime: 'image/bmp', ext: ['.bmp'] },
];

const JPEG_QUALITY = 0.95;

export function formatDef(id: SaveFormat): FormatDef {
  return FORMATS.find((f) => f.id === id)!;
}

/** 「PNG (*.png)」のような表記 */
export function formatLabel(f: FormatDef): string {
  return `${f.label} (${f.ext.map((e) => `*${e}`).join(';')})`;
}

export function formatFromName(name: string): SaveFormat | null {
  const ext = /\.[^.]+$/.exec(name)?.[0].toLowerCase();
  return FORMATS.find((f) => ext && f.ext.includes(ext))?.id ?? null;
}

export function formatFromMime(mime: string): SaveFormat | null {
  return FORMATS.find((f) => f.mime === mime)?.id ?? null;
}

/** 名前の拡張子を形式に合わせる（すでに合っていればそのまま） */
export function withExtension(name: string, format: SaveFormat): string {
  if (formatFromName(name) === format) return name;
  const base = name.replace(/\.[^.]+$/, '') || '画像';
  return base + formatDef(format).ext[0];
}

/** 保存ダイアログの初期値：元の名前と形式。書き出せない形式なら PNG にする */
export function defaultSaveTarget(image: SourceImage): { name: string; format: SaveFormat } {
  const format = formatFromName(image.name) ?? formatFromMime(image.type) ?? 'png';
  return { name: withExtension(image.name, format), format };
}

/** 編集結果を元画像の解像度で描く */
export function renderCrop(state: EditState, image: SourceImage, opaque: boolean): HTMLCanvasElement {
  const src = { w: image.width, h: image.height };
  const crop = effectiveCrop(state, src);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  if (state.angle === 0) {
    // 傾き補正なし：位置と大きさを整数にそろえ、画素をそのまま写す
    const img = imageSize(state, src);
    const r = cropPixelRect(crop, img);
    canvas.width = r.w;
    canvas.height = r.h;
    if (opaque) fillWhite(ctx, r.w, r.h);
    ctx.imageSmoothingEnabled = false;
    ctx.translate(img.w / 2 - r.x, img.h / 2 - r.y);
  } else {
    const w = Math.max(1, roundHalfEven(crop.w));
    const h = Math.max(1, roundHalfEven(crop.h));
    canvas.width = w;
    canvas.height = h;
    if (opaque) fillWhite(ctx, w, h);
    const pc = cropCenterOut(crop, state.angle);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(w / 2, h / 2);
    ctx.scale(w / crop.w, h / crop.h);
    ctx.translate(-pc.x, -pc.y);
    ctx.rotate(toRad(state.angle));
  }
  ctx.rotate((state.quarter * Math.PI) / 2);
  ctx.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1);
  ctx.drawImage(image.bitmap, -src.w / 2, -src.h / 2);
  return canvas;
}

function fillWhite(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
}

export async function exportBlob(state: EditState, image: SourceImage, format: SaveFormat): Promise<Blob> {
  const def = formatDef(format);
  const canvas = renderCrop(state, image, format === 'jpeg' || format === 'bmp');
  if (format === 'png' || format === 'jpeg') {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('画像を書き出せませんでした'))),
        def.mime,
        format === 'jpeg' ? JPEG_QUALITY : undefined,
      );
    });
  }
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
  const bytes = format === 'bmp' ? encodeBmp(data) : encodeTiff(data);
  return new Blob([bytes as BlobPart], { type: def.mime });
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
  excludeAcceptAllOption?: boolean;
}

type ShowSaveFilePicker = (options: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;

/** OS の「名前を付けて保存」ダイアログ（Chrome・Edge など）が使えるか */
export function getSaveFilePicker(): ShowSaveFilePicker | null {
  const fn = (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;
  return typeof fn === 'function' ? fn.bind(window) : null;
}

/**
 * OS の保存ダイアログで保存する。キャンセルされたら false。
 * ユーザー操作の直後に呼ぶ必要があるので、呼び出し側で await の前に呼ぶこと。
 */
export async function saveWithPicker(
  picker: ShowSaveFilePicker,
  state: EditState,
  image: SourceImage,
): Promise<boolean> {
  const target = defaultSaveTarget(image);
  let handle: FileSystemFileHandle;
  try {
    handle = await picker({
      suggestedName: target.name,
      types: FORMATS.map((f) => ({ description: f.label, accept: { [f.mime]: f.ext } })),
      excludeAcceptAllOption: true,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false;
    throw e;
  }
  const blob = await exportBlob(state, image, formatFromName(handle.name) ?? target.format);
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return true;
}

/** ダウンロードとして保存する（保存ダイアログが使えないブラウザ用） */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function copyToClipboard(state: EditState, image: SourceImage): Promise<void> {
  // Safari は、ユーザー操作の中で ClipboardItem に Promise を渡す必要がある
  const item = new ClipboardItem({ 'image/png': exportBlob(state, image, 'png') });
  await navigator.clipboard.write([item]);
}
