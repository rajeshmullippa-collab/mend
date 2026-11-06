/**
 * Small text cards drawn to a canvas. Kept short on purpose: Mend teaches by
 * doing, so text never runs longer than one line or two.
 */
import {
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';

export interface LabelStyle {
  width: number; // meters
  height: number; // meters
  bg?: string;
  fg?: string;
  accent?: string;
  font?: string;
  radius?: number;
}

export class Label {
  readonly mesh: Mesh;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: CanvasTexture;
  private style: Required<LabelStyle>;
  private last = '';

  constructor(style: LabelStyle) {
    this.style = {
      bg: 'rgba(20,18,16,0.78)',
      fg: '#f4ede1',
      accent: '#e2b24f',
      font: '"Georgia", "Times New Roman", serif',
      radius: 0.35,
      ...style,
    };
    const pxPerM = 2400;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(style.width * pxPerM);
    this.canvas.height = Math.round(style.height * pxPerM);
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    const mat = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(style.width, style.height), mat);
    this.mesh.renderOrder = 10;
  }

  /** lines: first line large, rest smaller. A line starting with "*" uses the accent color. */
  set(lines: string[], opts: { highlight?: boolean } = {}) {
    const key = lines.join('\n') + (opts.highlight ? '!' : '');
    if (key === this.last) return;
    this.last = key;
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const r = Math.min(w, h) * this.style.radius;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.closePath();
    ctx.fillStyle = opts.highlight ? 'rgba(70,52,18,0.9)' : this.style.bg;
    ctx.fill();
    ctx.lineWidth = Math.max(2, h * 0.025);
    ctx.strokeStyle = opts.highlight ? this.style.accent : 'rgba(226,178,79,0.55)';
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const n = lines.length;
    const big = h * (n === 1 ? 0.46 : n === 2 ? 0.36 : 0.27);
    const small = big * 0.62;
    const total = big + (n - 1) * small * 1.25;
    let y = h / 2 - total / 2 + big / 2;
    lines.forEach((raw, i) => {
      const accent = raw.startsWith('*');
      const text = accent ? raw.slice(1) : raw;
      const size = i === 0 ? big : small;
      ctx.font = `${i === 0 ? '600 ' : ''}${Math.round(size)}px ${this.style.font}`;
      ctx.fillStyle = accent ? this.style.accent : this.style.fg;
      let fitted = size;
      while (ctx.measureText(text).width > w * 0.9 && fitted > 8) {
        fitted -= 2;
        ctx.font = `${i === 0 ? '600 ' : ''}${Math.round(fitted)}px ${this.style.font}`;
      }
      ctx.fillText(text, w / 2, y);
      y += i === 0 ? big / 2 + small * 0.75 : small * 1.25;
    });
    this.texture.needsUpdate = true;
  }
}
