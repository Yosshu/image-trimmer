// Fluent UI System Icons（Microsoft、MIT ライセンス）
import arrowRedo from '@fluentui/svg-icons/icons/arrow_redo_16_regular.svg?raw';
import arrowSort from '@fluentui/svg-icons/icons/arrow_sort_20_regular.svg?raw';
import arrowSwap from '@fluentui/svg-icons/icons/arrow_swap_20_regular.svg?raw';
import arrowUndo from '@fluentui/svg-icons/icons/arrow_undo_16_regular.svg?raw';
import chevronDown from '@fluentui/svg-icons/icons/chevron_down_16_regular.svg?raw';
import image from '@fluentui/svg-icons/icons/image_20_regular.svg?raw';
import imageAdd from '@fluentui/svg-icons/icons/image_add_20_regular.svg?raw';
import ratioOneToOne from '@fluentui/svg-icons/icons/ratio_one_to_one_20_regular.svg?raw';
import resizeImage from '@fluentui/svg-icons/icons/resize_image_20_regular.svg?raw';
import rotateClockwise from '@fluentui/svg-icons/icons/arrow_rotate_clockwise_20_regular.svg?raw';
import rotateCounterclockwise from '@fluentui/svg-icons/icons/arrow_rotate_counterclockwise_20_regular.svg?raw';
import zoomIn from '@fluentui/svg-icons/icons/zoom_in_16_regular.svg?raw';
import zoomOut from '@fluentui/svg-icons/icons/zoom_out_16_regular.svg?raw';
import { type RatioId, ratioDef } from './ratios';

export const ICONS = {
  zoomIn,
  zoomOut,
  actualSize: ratioOneToOne,
  undo: arrowUndo,
  redo: arrowRedo,
  chevronDown,
  rotateCcw: rotateCounterclockwise,
  rotateCw: rotateClockwise,
  flipH: arrowSwap,
  flipV: arrowSort,
  imageAdd,
};

/** SVG 文字列を、指定の大きさ・現在の文字色で描く要素にする */
export function icon(svg: string, size: number): HTMLElement {
  const span = document.createElement('span');
  span.className = 'icon';
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
  span.innerHTML = svg
    .replace(/width="\d+"/, `width="${size}"`)
    .replace(/height="\d+"/, `height="${size}"`)
    .replace('<svg ', '<svg fill="currentColor" aria-hidden="true" ');
  return span;
}

/** 比率の形をした角丸の四角（比率ピッカー・比率ボタン用。24×24 の枠に描く） */
function ratioShape(w: number, h: number): string {
  // 本家のアイコンは、正方形が少し小さく、長い辺がそろう
  const long = w === h ? 19 : 21;
  const rw = w >= h ? long : Math.max(8, (long * w) / h);
  const rh = h >= w ? long : Math.max(8, (long * h) / w);
  const x = (24 - rw) / 2;
  const y = (24 - rh) / 2;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="${rw - 1}" height="${rh - 1}" rx="3" ` +
    'fill="none" stroke="currentColor" stroke-width="1.1"/></svg>'
  );
}

export function ratioIcon(id: RatioId): string {
  if (id === 'free') return resizeImage;
  if (id === 'original') return image;
  const def = ratioDef(id);
  return ratioShape(def.w!, def.h!);
}
