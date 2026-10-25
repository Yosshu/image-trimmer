/** ブラウザの機能では書き出せない形式（BMP・TIFF）のエンコーダー */

export interface RgbaImage {
  width: number;
  height: number;
  /** 左上から右へ、上から下へ並んだ RGBA（ImageData.data と同じ並び） */
  data: Uint8ClampedArray | Uint8Array;
}

/**
 * 24 ビットの BMP。透明な部分は白と合成する。
 */
export function encodeBmp(img: RgbaImage): Uint8Array {
  const { width, height, data } = img;
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const fileSize = 54 + pixelBytes;
  const out = new Uint8Array(fileSize);
  const view = new DataView(out.buffer);

  // BITMAPFILEHEADER
  out[0] = 0x42; // 'B'
  out[1] = 0x4d; // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);
  // BITMAPINFOHEADER
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // 正の値：下の行から並べる
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(30, 0, true); // BI_RGB
  view.setUint32(34, pixelBytes, true);
  view.setInt32(38, 3780, true); // 96 dpi
  view.setInt32(42, 3780, true);

  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4;
    let dst = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const i = src + x * 4;
      const a = data[i + 3] / 255;
      const blend = (c: number) => Math.round(c * a + 255 * (1 - a));
      out[dst++] = blend(data[i + 2]);
      out[dst++] = blend(data[i + 1]);
      out[dst++] = blend(data[i]);
    }
  }
  return out;
}

/**
 * 非圧縮の TIFF（RGBA、リトルエンディアン、1 ストリップ）。
 */
export function encodeTiff(img: RgbaImage): Uint8Array {
  const { width, height, data } = img;
  const pixelBytes = width * height * 4;

  // 並び：ヘッダー(8) → 画素 → BitsPerSample(8) → 解像度(8 + 8) → IFD
  const pixelOffset = 8;
  const bitsOffset = pixelOffset + pixelBytes + (pixelBytes % 2); // ワード境界にそろえる
  const xResOffset = bitsOffset + 8;
  const yResOffset = xResOffset + 8;
  const ifdOffset = yResOffset + 8;

  const tags: [tag: number, type: number, count: number, value: number][] = [
    [256, 4, 1, width], // ImageWidth (LONG)
    [257, 4, 1, height], // ImageLength (LONG)
    [258, 3, 4, bitsOffset], // BitsPerSample (SHORT × 4)
    [259, 3, 1, 1], // Compression：なし
    [262, 3, 1, 2], // PhotometricInterpretation：RGB
    [273, 4, 1, pixelOffset], // StripOffsets
    [277, 3, 1, 4], // SamplesPerPixel
    [278, 4, 1, height], // RowsPerStrip
    [279, 4, 1, pixelBytes], // StripByteCounts
    [282, 5, 1, xResOffset], // XResolution (RATIONAL)
    [283, 5, 1, yResOffset], // YResolution (RATIONAL)
    [284, 3, 1, 1], // PlanarConfiguration：画素ごと
    [296, 3, 1, 2], // ResolutionUnit：インチ
    [338, 3, 1, 2], // ExtraSamples：乗算されていないアルファ
  ];

  const ifdSize = 2 + tags.length * 12 + 4;
  const out = new Uint8Array(ifdOffset + ifdSize);
  const view = new DataView(out.buffer);

  out[0] = 0x49; // 'I'
  out[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);

  out.set(data, pixelOffset);

  for (let i = 0; i < 4; i++) view.setUint16(bitsOffset + i * 2, 8, true);
  view.setUint32(xResOffset, 96, true);
  view.setUint32(xResOffset + 4, 1, true);
  view.setUint32(yResOffset, 96, true);
  view.setUint32(yResOffset + 4, 1, true);

  view.setUint16(ifdOffset, tags.length, true);
  tags.forEach(([tag, type, count, value], i) => {
    const p = ifdOffset + 2 + i * 12;
    view.setUint16(p, tag, true);
    view.setUint16(p + 2, type, true);
    view.setUint32(p + 4, count, true);
    if (type === 3 && count === 1) view.setUint16(p + 8, value, true);
    else view.setUint32(p + 8, value, true);
  });
  view.setUint32(ifdOffset + 2 + tags.length * 12, 0, true); // 次の IFD はなし
  return out;
}
