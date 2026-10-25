export interface SourceImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** 保存時の初期ファイル名に使う元の名前 */
  name: string;
  /** 元の形式（MIME タイプ） */
  type: string;
}

/** ファイルを画像として読み込む。EXIF の向きは反映する */
export async function loadImageFile(file: Blob, name?: string): Promise<SourceImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const fallbackName = `画像.${extensionOf(file.type) ?? 'png'}`;
  return {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    name: name ?? (file instanceof File && file.name ? file.name : fallbackName),
    type: file.type,
  };
}

function extensionOf(type: string): string | null {
  const m = /^image\/(png|jpeg|gif|webp|bmp|tiff|avif)$/.exec(type);
  if (!m) return null;
  return m[1] === 'jpeg' ? 'jpg' : m[1] === 'tiff' ? 'tif' : m[1];
}

/** クリップボードやドラッグ＆ドロップのデータから画像ファイルを探す */
export function findImageFile(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const file of Array.from(data.files)) {
    if (file.type.startsWith('image/')) return file;
  }
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}
