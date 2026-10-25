import { MAX_ANGLE } from './state';

/** 1° あたりの間隔（CSS px）。本家の実測 15.2 物理 px ÷ 125% */
export const PX_PER_DEG = 12.16;

/** 両端をフェードさせる幅（CSS px） */
const FADE = 90;

/**
 * 角度スライダーの目盛りを描く。つまみは中央に固定で、目盛りのテープが角度に応じて流れる。
 */
export function drawRuler(canvas: HTMLCanvasElement, angle: number, color: string, thumbColor: string): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 13px ${getComputedStyle(canvas).fontFamily}`;

  for (let d = -MAX_ANGLE; d <= MAX_ANGLE; d++) {
    const x = cx + (d - angle) * PX_PER_DEG;
    if (x < -4 || x > w + 4) continue;
    const alpha = Math.max(0, Math.min(1, Math.min(x, w - x) / FADE));
    if (alpha <= 0) continue;
    ctx.globalAlpha = alpha;
    if (d === 0 && Math.abs(x - cx) > 10) {
      ctx.fillText('0', x, cy + 0.5);
    } else if (d % 5 === 0) {
      roundRect(ctx, x - 1, cy - 5.5, 2, 11, 1);
    } else {
      ctx.globalAlpha = alpha * 0.85;
      ctx.beginPath();
      ctx.arc(x, cy, 1.25, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // つまみ
  ctx.globalAlpha = 1;
  ctx.fillStyle = thumbColor;
  roundRect(ctx, cx - 4, cy - 11, 8, 22, 4);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}
