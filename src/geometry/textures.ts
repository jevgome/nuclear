import * as THREE from 'three';
import type { Station } from '../config/types';
import { profileAt, tForY, UV_LENGTH } from './shell';
import { insertWidth } from './relief';

/**
 * Procedural surface detail for the shell, painted in (x, y) millimetres of the straight
 * configuration and mapped through the same UV convention as shellHalfGeometry.
 * Feature locations are traced from the listing photos (PHOTO-S / PHOTO-P); see UNCERTAINTIES.md.
 *
 * side = −1 is the logo side (seen with the nose on the left in PHOTO-S); +1 carries the label plate.
 */
const W = 4096, H = 1024;

export interface ShellTextures {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

const cache = new Map<string, ShellTextures>();

export function shellTextures(stations: Station[], side: 1 | -1, key: string): ShellTextures {
  const k = `${key}|${side}`;
  const hit = cache.get(k);
  if (hit) return hit;

  const mk = () => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    return c;
  };
  const cCol = mk(), cRgh = mk(), cBmp = mk();
  const col = cCol.getContext('2d')!, rgh = cRgh.getContext('2d')!, bmp = cBmp.getContext('2d')!;

  // mm (x along tool, y height) → canvas px
  const P = (x: number, y: number): [number, number] => {
    const v = tForY(profileAt(stations, x), y);
    return [(x / UV_LENGTH) * W, (1 - v) * H];
  };
  const path = (ctx: CanvasRenderingContext2D, pts: [number, number][], close = false, steps = 24) => {
    ctx.beginPath();
    for (let i = 0; i < pts.length - (close ? 0 : 1); i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const [px, py] = P(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
        if (i === 0 && s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
    }
    if (close) ctx.closePath();
  };
  const all = [col, rgh, bmp];

  // ---- base ----
  col.fillStyle = '#1e1f21'; col.fillRect(0, 0, W, H);
  rgh.fillStyle = 'rgb(150,150,150)'; rgh.fillRect(0, 0, W, H); // ≈0.59 satin
  bmp.fillStyle = 'rgb(128,128,128)'; bmp.fillRect(0, 0, W, H);
  // fine speckle: textured (EDM-finish) plastic visible in the product photos
  const img = bmp.getImageData(0, 0, W, H);
  const cimg = col.getImageData(0, 0, W, H);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 34;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 128 + n;
    const cn = (rnd() - 0.5) * 6;
    cimg.data[i] += cn; cimg.data[i + 1] += cn; cimg.data[i + 2] += cn;
  }
  bmp.putImageData(img, 0, 0);
  col.putImageData(cimg, 0, 0);

  const groove = (pts: [number, number][], width = 9, depth = 60, ink = 0.45) => {
    bmp.strokeStyle = `rgb(${depth},${depth},${depth})`; bmp.lineWidth = width; bmp.lineCap = 'round';
    path(bmp, pts); bmp.stroke();
    col.strokeStyle = `rgba(0,0,0,${ink})`; col.lineWidth = width * 0.7; col.lineCap = 'round';
    path(col, pts); col.stroke();
  };
  // Local isotropic frame at (x, y): canvas units where 1 unit = 1 mm both ways,
  // mirrored on the −Z side so artwork reads correctly from outside the tool.
  const local = (ctx: CanvasRenderingContext2D, x: number, y: number, rot: number, fn: () => void) => {
    const [px, py] = P(x, y);
    const [, py2] = P(x, y + 1);
    const vy = Math.max(1, Math.abs(py - py2));
    const ux = W / UV_LENGTH;
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(ux * (side < 0 ? -1 : 1), vy);
    ctx.rotate(rot);
    fn();
    ctx.restore();
  };

  // ---- grip back insert: deep parting groove + diagonal ribs (PHOTO-P "Handle") ----
  const border: [number, number][] = [];
  for (let x = 4; x <= 112; x += 2) border.push([x, -(profileAt(stations, x).bottom - insertWidth(x) - 1.5)]);
  groove(border, 9, 30, 0.7);

  // ---- "⟳" rotate icon next to PUSH (PHOTO-P), engraved ----
  for (const [ctx, style] of [[bmp, 'rgb(80,80,80)'], [col, 'rgba(255,255,255,0.09)']] as const) {
    local(ctx, 100.4, 19.2, 0, () => {
      ctx.strokeStyle = style; ctx.lineWidth = 0.45; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, 0, 2.4, 0.6, Math.PI * 1.8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(2.4 * Math.cos(0.6) - 1.1, 2.4 * Math.sin(0.6) + 0.2);
      ctx.lineTo(2.4 * Math.cos(0.6), 2.4 * Math.sin(0.6)); ctx.lineTo(2.4 * Math.cos(0.6) + 0.2, 2.4 * Math.sin(0.6) - 1.1); ctx.stroke();
    });
  }

  // ---- screw holes (counterbored: the listing photos show plain glossy-black holes, the screw
  // heads sit deep inside), lanyard hole ----
  const hole = (x: number, y: number, rmm: number) => {
    const disc = (ctx: CanvasRenderingContext2D, fill: string | CanvasGradient, r: number) =>
      local(ctx, x, y, 0, () => { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); });
    // chamfered rim: a thin lighter ring just outside the bore
    disc(bmp, 'rgb(150,150,150)', rmm * 1.22);
    disc(col, '#2c2d30', rmm * 1.18);
    disc(col, '#020202', rmm);
    disc(bmp, 'rgb(8,8,8)', rmm);
    disc(rgh, 'rgb(70,70,70)', rmm); // glossy inside
    local(col, x, y, 0, () => {
      const g = col.createRadialGradient(-rmm * 0.35, -rmm * 0.35, 0, 0, 0, rmm);
      g.addColorStop(0, 'rgba(60,62,66,0.55)'); g.addColorStop(0.5, 'rgba(10,10,10,0)');
      col.fillStyle = g; col.beginPath(); col.arc(0, 0, rmm, 0, Math.PI * 2); col.fill();
    });
  };
  // positions from the straight listing photo, corrected for its ≈17° yaw (side-surface features
  // appear ≈0.3·|z| mm nearer the butt than the silhouette)
  hole(8, 21, 2.2); // lanyard hole through the butt hook
  hole(47.5, 16, 2.3);
  hole(95.5, 1, 2.3);
  hole(109.5, -23, 2.3);
  hole(30, -6, 2.3);
  hole(191.5, 12.5, 1.6);
  hole(191.5, -10.5, 1.6);

  for (const ctx of all) void ctx;
  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  };
  const res = { map: tex(cCol, true), roughnessMap: tex(cRgh, false), bumpMap: tex(cBmp, false) };
  cache.set(k, res);
  return res;
}

/** Small canvas texture with centred text (button legends). */
export function labelTexture(str: string, opts: { w?: number; h?: number; color?: string; bg?: string; size?: number } = {}) {
  const c = document.createElement('canvas');
  c.width = opts.w ?? 256; c.height = opts.h ?? 128;
  const g = c.getContext('2d')!;
  g.fillStyle = opts.bg ?? '#c8141c'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = opts.color ?? '#2a0003';
  g.font = `800 ${opts.size ?? 64}px Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(str, c.width / 2, c.height / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
