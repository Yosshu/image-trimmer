import { describe, expect, it } from 'vitest';
import { encodeBmp, encodeTiff, type RgbaImage } from './encoders';

// 3×2 の画像：上の行が 赤・緑・青、下の行が 白・黒・半透明の黒
const IMG: RgbaImage = {
  width: 3,
  height: 2,
  data: new Uint8Array([
    255, 0, 0, 255, /**/ 0, 255, 0, 255, /**/ 0, 0, 255, 255,
    255, 255, 255, 255, /**/ 0, 0, 0, 255, /**/ 0, 0, 0, 128,
  ]),
};

describe('BMP', () => {
  const bmp = encodeBmp(IMG);
  const view = new DataView(bmp.buffer);

  it('ヘッダー', () => {
    expect(String.fromCharCode(bmp[0], bmp[1])).toBe('BM');
    // 1 行 3 画素 × 3 バイト = 9 → 4 バイト境界で 12
    expect(view.getUint32(2, true)).toBe(54 + 12 * 2);
    expect(view.getInt32(18, true)).toBe(3);
    expect(view.getInt32(22, true)).toBe(2);
    expect(view.getUint16(28, true)).toBe(24);
  });

  it('下の行から BGR で並ぶ。透明な部分は白と合成する', () => {
    // 最初の行 = 画像の下の行：白、黒、半透明の黒
    expect(Array.from(bmp.slice(54, 63))).toEqual([255, 255, 255, 0, 0, 0, 127, 127, 127]);
    // 2 行目 = 画像の上の行：赤、緑、青（BGR）
    expect(Array.from(bmp.slice(66, 75))).toEqual([0, 0, 255, 0, 255, 0, 255, 0, 0]);
  });
});

describe('TIFF', () => {
  const tiff = encodeTiff(IMG);
  const view = new DataView(tiff.buffer);

  const readTags = () => {
    const ifd = view.getUint32(4, true);
    const n = view.getUint16(ifd, true);
    const tags = new Map<number, { type: number; count: number; value: number }>();
    for (let i = 0; i < n; i++) {
      const p = ifd + 2 + i * 12;
      const type = view.getUint16(p + 2, true);
      const count = view.getUint32(p + 4, true);
      const value = type === 3 && count === 1 ? view.getUint16(p + 8, true) : view.getUint32(p + 8, true);
      tags.set(view.getUint16(p, true), { type, count, value });
    }
    return tags;
  };

  it('ヘッダー', () => {
    expect(String.fromCharCode(tiff[0], tiff[1])).toBe('II');
    expect(view.getUint16(2, true)).toBe(42);
  });

  it('タグは番号順で、大きさと画素の位置が正しい', () => {
    const tags = readTags();
    const ids = Array.from(tags.keys());
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(tags.get(256)!.value).toBe(3);
    expect(tags.get(257)!.value).toBe(2);
    expect(tags.get(277)!.value).toBe(4);
    const offset = tags.get(273)!.value;
    const bytes = tags.get(279)!.value;
    expect(Array.from(tiff.slice(offset, offset + bytes))).toEqual(Array.from(IMG.data));
  });

  it('BitsPerSample は 8, 8, 8, 8', () => {
    const p = readTags().get(258)!.value;
    expect([0, 1, 2, 3].map((i) => view.getUint16(p + i * 2, true))).toEqual([8, 8, 8, 8]);
  });
});
