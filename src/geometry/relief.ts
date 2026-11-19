import * as THREE from 'three';
import type { Station } from '../config/types';
import { profileAt, sectionPoint, sectionPolyline, SEC_N, tParamForY } from './shell';

/**
 * Raised surface relief — real geometry (not bump maps) so edges catch light and cast shadows.
 * Everything is placed in straight-configuration surface coordinates (x along the tool, y height
 * on the side) and projected onto the shell, so it follows the shell exactly.
 */

export type RibProfile = 'box' | 'saw' | 'ridge';

/** Point on the outer shell surface at (x, y) on the given side, plus outward normal. */
export function surfaceFrame(stations: Station[], x: number, y: number, side: 1 | -1) {
  const at = (xx: number, t: number) => {
    const q = sectionPoint(profileAt(stations, xx), t, side);
    return new THREE.Vector3(xx, q.y, q.z);
  };
  const t = tParamForY(profileAt(stations, x), y);
  const p = at(x, t);
  const dx = at(x + 0.25, t).sub(at(x - 0.25, t));
  const dt = at(x, Math.min(1, t + 0.004)).sub(at(x, Math.max(0, t - 0.004)));
  const n = new THREE.Vector3().crossVectors(dx, dt).normalize();
  if (n.dot(new THREE.Vector3(0, p.y, p.z)) < 0) n.negate();
  return { p, n };
}

const PROFILES: Record<RibProfile, (w: number, h: number) => [number, number][]> = {
  // [across, height] — sink 0.35 mm into the shell so there is never a gap
  box: (w, h) => [[-w / 2, -0.35], [-w / 2, h], [w / 2, h], [w / 2, -0.35]],
  saw: (w, h) => [[-w / 2, -0.35], [-w / 2, h], [w / 2, 0], [w / 2, -0.35]],
  ridge: (w, h) => [[-w / 2, -0.35], [-w * 0.28, h], [w * 0.28, h], [w / 2, -0.35]],
};

/** Resample a 2D polyline every `step` mm, carrying an optional per-vertex value (width). */
function resample(pts: [number, number][], step: number, vals?: number[]): { p: [number, number][]; v: number[] } {
  const out: [number, number][] = [pts[0]];
  const ov: number[] = [vals ? vals[0] : 1];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const L = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) {
      out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
      ov.push(vals ? vals[i - 1] + ((vals[i] - vals[i - 1]) * k) / n : 1);
    }
  }
  return { p: out, v: ov };
}

/**
 * A rib swept along a surface path. Flat-shaded so every edge stays crisp.
 * `w` = width across the path, `h` = height above the surface (mm).
 */
export function ribGeometry(
  stations: Station[], path: [number, number][], side: 1 | -1, w: number, h: number, profile: RibProfile = 'box',
  widths?: number[],
): THREE.BufferGeometry {
  const rs = resample(path, 0.8, widths);
  const pts = rs.p;
  const prof = PROFILES[profile](w, h);
  // Each profile vertex is placed on the shell at its own across-offset (in side-view mm) and
  // lifted along the local normal there, so wide planks hug strongly curved regions instead of
  // floating off them. The across direction is mirrored with the side so an asymmetric profile
  // (saw) faces the same way in tool coordinates on both halves; winding flipped to match.
  const rings: THREE.Vector3[][] = pts.map(([x, y], i) => {
    const [ax, ay] = pts[Math.max(0, i - 1)], [bx, by] = pts[Math.min(pts.length - 1, i + 1)];
    const L = Math.hypot(bx - ax, by - ay) || 1;
    const cx = (by - ay) / L, cy = -(bx - ax) / L; // across, in (x, y)
    const ws = widths ? rs.v[i] / w : 1;
    return prof.map(([u, v]) => {
      const f = surfaceFrame(stations, x + cx * u * ws, y + cy * u * ws, side);
      return f.p.addScaledVector(f.n, v);
    });
  });
  const pos: number[] = [];
  const tri = side > 0
    ? (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    : (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
  const m = prof.length;
  for (let i = 0; i < rings.length - 1; i++)
    for (let k = 0; k < m; k++) {
      const a = rings[i][k], b = rings[i][(k + 1) % m], c = rings[i + 1][(k + 1) % m], d = rings[i + 1][k];
      tri(a, b, c); tri(a, c, d);
    }
  for (const [r, flip] of [[rings[0], true], [rings[rings.length - 1], false]] as const)
    for (let k = 1; k < m - 1; k++) (flip ? tri(r[0], r[k + 1], r[k]) : tri(r[0], r[k], r[k + 1]));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Raised plate (logo / label) over a parallelogram given by 4 corners (x, y), in order
 * top-rear, top-front, bottom-front, bottom-rear. UV u runs rear→front (mirrored on side −1
 * so artwork reads correctly from outside), v bottom→top.
 */
export function plateGeometry(
  stations: Station[], corners: [number, number][], side: 1 | -1, h: number, bevel = 0.5,
): { top: THREE.BufferGeometry; walls: THREE.BufferGeometry } {
  const [A, B, C, D] = corners;
  const NS = 28, NR = 10;
  const at = (s: number, r: number): [number, number] => {
    const tx = A[0] + (B[0] - A[0]) * s, ty = A[1] + (B[1] - A[1]) * s;
    const bx = D[0] + (C[0] - D[0]) * s, by = D[1] + (C[1] - D[1]) * s;
    return [tx + (bx - tx) * r, ty + (by - ty) * r];
  };
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= NS; i++)
    for (let j = 0; j <= NR; j++) {
      const s = i / NS, r = j / NR;
      const [x, y] = at(s, r);
      const f = surfaceFrame(stations, x, y, side);
      const p = f.p.addScaledVector(f.n, h);
      pos.push(p.x, p.y, p.z);
      uv.push(side < 0 ? 1 - s : s, 1 - r);
    }
  const id = (i: number, j: number) => i * (NR + 1) + j;
  for (let i = 0; i < NS; i++)
    for (let j = 0; j < NR; j++) {
      const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
      if (side > 0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
    }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  top.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  top.setIndex(idx);
  top.computeVertexNormals();
  // bevelled side walls around the perimeter
  const ring: [number, number][] = [];
  for (let i = 0; i <= NS; i++) ring.push(at(i / NS, 0));
  for (let j = 1; j <= NR; j++) ring.push(at(1, j / NR));
  for (let i = NS - 1; i >= 0; i--) ring.push(at(i / NS, 1));
  for (let j = NR - 1; j >= 1; j--) ring.push(at(0, j / NR));
  ring.push(ring[0]);
  const cx = (A[0] + B[0] + C[0] + D[0]) / 4, cy = (A[1] + B[1] + C[1] + D[1]) / 4;
  const wp: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => wp.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const edge = ring.map(([x, y]) => {
    // foot of the wall pushed out by `bevel` (chamfered edge)
    const dx = x - cx, dy = y - cy, L = Math.hypot(dx, dy) || 1;
    const fo = surfaceFrame(stations, x + (dx / L) * bevel, y + (dy / L) * bevel, side);
    const ft = surfaceFrame(stations, x, y, side);
    return { lo: fo.p.addScaledVector(fo.n, -0.3), hi: ft.p.addScaledVector(ft.n, h) };
  });
  for (let k = 0; k < edge.length - 1; k++) {
    const a = edge[k], b = edge[k + 1];
    if (side > 0) { tri(a.lo, b.lo, b.hi); tri(a.lo, b.hi, a.hi); } else { tri(a.lo, b.hi, b.lo); tri(a.lo, a.hi, b.hi); }
  }
  const walls = new THREE.BufferGeometry();
  walls.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  walls.computeVertexNormals();
  return { top, walls };
}

/* ======================================================================= */
/*  Relief inventory — traced from the listing photos and the product video  */
/* ======================================================================= */

export interface ReliefItem {
  part: 'handle' | 'head';
  path: [number, number][];
  w: number;
  h: number;
  profile: RibProfile;
  /** optional per-vertex width (mm), overrides w along the path */
  widths?: number[];
}

const DEFAULT_SEAM = { x0: 109.6, beta: (36 * Math.PI) / 180 };
type Seam = { x0: number; beta: number };
/** x of the seam line at height y (+Y side nearer the butt), as in shell.ts. */
const seamAt = (seam: Seam, y: number) => seam.x0 - y * Math.tan(seam.beta);

/**
 * Logo/label plate corners (top-rear, top-front, bottom-front, bottom-rear).
 * Listing photos: a long glossy plate whose front edge is raked (top corner further back than
 * the bottom one) and whose rear edge runs parallel to the swivel seam, just inside the frame
 * band that wraps down along the seam.
 */
export function plateCorners(seam: Seam = DEFAULT_SEAM): [number, number][] {
  return [[seamAt(seam, 13.4) + 11, 13.4], [154, 10.2], [161, -6.6], [seamAt(seam, 3.2) + 11, 3.2]];
}
/** @deprecated use plateCorners(seam) */
export const PLATE: [number, number][] = plateCorners();

/** Height y of the outer surface where |z| = zc on the upper (+Y) half — used to stop ribs at a slot edge. */
function yAtZTop(stations: Station[], x: number, zc: number) {
  const pl = sectionPolyline(profileAt(stations, x));
  for (let i = SEC_N; i > 0; i--) {
    const z0 = pl[i * 2], z1 = pl[i * 2 - 2];
    if (z0 <= zc && z1 >= zc) {
      const f = (zc - z0) / ((z1 - z0) || 1);
      return pl[i * 2 + 1] + (pl[i * 2 - 1] - pl[i * 2 + 1]) * f;
    }
  }
  return profileAt(stations, x).top;
}

/** Back-insert width (mm of side-view height above the bottom outline): wide at the butt, narrow at the seam. */
export const insertWidth = (x: number) => 15 - Math.min(1, Math.max(0, (x - 15) / 95)) * 7.5;

export function reliefItems(
  stations: Station[],
  trigger: { start: number; end: number; width: number } = { start: 54, end: 86, width: 10 },
  seam: Seam = DEFAULT_SEAM,
  fr: { x: number; y: number; length: number; width: number } = { x: 88, y: 9, length: 12.5, width: 7 },
): ReliefItem[] {
  const top = (x: number) => profileAt(stations, x).top;
  const bot = (x: number) => profileAt(stations, x).bottom;
  const out: ReliefItem[] = [];
  const along = (y0: number, y1: number, off: number, n = 12): [number, number][] => {
    const pts: [number, number][] = [];
    for (let k = 0; k <= n; k++) { const y = y0 + ((y1 - y0) * k) / n; pts.push([seamAt(seam, y) + off, y]); }
    return pts;
  };

  /* --- barrel ------------------------------------------------------------------------------- */
  // The side of the barrel is a recessed pocket running from the nose crease back to the seam
  // (listing hero shots 61ADW / 61qjy / 61Tv). Its upper edge is a long step that rises gently
  // toward the rear and then turns down along the seam; its lower edge is a ledge above the
  // stepped planks. Both are modelled as raised steps whose wall faces into the pocket.
  // upper step: rearward then down along the seam ('saw' high edge = pocket wall)
  out.push({ part: 'head', w: 4.2, h: 1.25, profile: 'saw', path: [
    [184.2, 8.6], [176, 10.2], [164, 12.2], [150, 14], [136, 15.5], [124, 16.8],
    [seamAt(seam, 18) + 12.2, 18],
  ] });
  out.push({ part: 'head', w: 3.6, h: 1.25, profile: 'saw', path: [
    [seamAt(seam, 18.4) + 10.4, 18.4], [seamAt(seam, 16.6) + 7.6, 16.4], ...along(14.2, -9.2, 6.8),
  ] });
  // lower ledge (wall faces up into the pocket)
  out.push({ part: 'head', w: 3, h: 1.05, profile: 'saw', path: [
    [184.2, -8.6], [172, -9.4], [158, -10], [140, -10.4], [seamAt(seam, -10.4) + 6.4, -10.4],
  ] });
  // stepped planks on the lower flank (≈10.7 mm pitch; the step lines lean so their lower end is
  // further forward). Each plank is high at its step line and ramps down toward the butt; the
  // last one is cut off by the seam.
  {
    const lean = 4, pitch = 10.4, yt = -12.4;
    for (let k = 0; k < 5; k++) {
      const xt = 167.5 - pitch * k; // step line at its upper end
      const y0 = k === 0 ? -16 : yt;
      const yb = -bot(xt + lean) + 2.8;
      const line = (y: number) => xt + ((y - yt) / (yb - yt)) * lean;
      const c: [number, number][] = [], ws: number[] = [];
      for (let i = 0; i <= 10; i++) {
        const y = y0 + ((yb - y0) * i) / 10;
        const xf = line(y) - 0.2, xr = Math.max(line(y) - pitch + 0.2, seamAt(seam, y) + 1.4);
        c.push([(xf + xr) / 2, y]); ws.push(Math.max(0.6, xf - xr));
      }
      out.push({ part: 'head', w: pitch, h: 1.15, profile: 'saw', path: c, widths: ws });
    }
  }
  // transverse ribs across the upper facet (47-piece listing render, product video)
  // (low: they show in the 47-piece render but not in the main listing photos)
  for (let x = 127; x <= 165; x += 6.3)
    out.push({ part: 'head', w: 1.6, h: 0.5, profile: 'ridge', path: [[x, top(x) - 0.6], [x - 1.2, 21.8], [x - 2.4, 19.4]] });

  /* --- grip --------------------------------------------------------------------------------- */
  // front slats: stepped planks across the trigger side. Step lines lean so their upper (+Y,
  // front-face) end is nearer the butt (straight listing photo 61Tv; pistol photos 61ADW/71zusp).
  {
    const pitch = 5.4, lean = 5.6;
    const frTop = fr.y + fr.length / 2 + 1.2; // slats clear the F/R pill
    for (let xt = 33.2; xt <= 93.5; xt += pitch) {
      const inSlot = xt > trigger.start - 2.5 && xt < trigger.end + 2.5;
      const yEnd = inSlot ? yAtZTop(stations, xt, trigger.width / 2 + 1.2) - 0.7 : top(xt) - 0.05;
      // stop short of the seam on the trigger side
      if (xt > seamAt(seam, yEnd) - 1.6) continue;
      // plank spans [xLine − pitch, xLine]; if that overlaps the F/R pill, start above it
      const nearFr = (x: number) => x > fr.x - fr.width / 2 - 1.2 && x - pitch < fr.x + fr.width / 2 + 1.2;
      let yb = 4.2;
      const line = (y: number) => xt + ((yEnd - y) / (yEnd - 4.2)) * lean;
      if (nearFr(line(4.2)) || nearFr(line(frTop))) yb = frTop;
      if (yEnd - yb < 3) continue;
      const mid: [number, number] = [line((yb + yEnd) / 2), (yb + yEnd) / 2];
      const path: [number, number][] = [[xt, yEnd], mid, [Math.min(line(yb), seamAt(seam, yb) - 1.8), yb]];
      out.push({ part: 'handle', w: pitch - 0.4, h: 1.05, profile: 'saw', path: path.map(([x, y]) => [x - pitch / 2, y] as [number, number]) });
    }
  }
  // raised frame band bounding the slatted zone; at the butt it sweeps down toward the toe
  const band: [number, number][] = [];
  for (let x = 6; x <= 94; x += 2) band.push([x, Math.min(top(x) - 6, 2.6 + Math.max(0, 22 - x) * 0.42)]);
  out.push({ part: 'handle', w: 1.8, h: 0.95, profile: 'box', path: band });
  // back insert: raised border lip (wide at the butt, narrowing toward the seam) …
  const lip: [number, number][] = [];
  for (let x = 4; x <= 112; x += 2) lip.push([x, -(bot(x) - insertWidth(x))]);
  out.push({ part: 'handle', w: 2.4, h: 1.2, profile: 'ridge', path: lip });
  // … and 11 long diagonal ribs on its lower half; the back end of each rib is nearer the seam
  for (let k = 0; k < 11; k++) {
    const x = 14 + 4.3 * k;
    out.push({ part: 'handle', w: 1.35, h: 1.05, profile: 'ridge', path: [[x + 4.4, -bot(x + 4.4) + 0.25], [x + 2, -bot(x + 2) + 5], [x, -bot(x) + Math.min(10, insertWidth(x) - 3)]] });
  }
  return out;
}

/* ---------- plate artwork ---------- */
export function plateTexture(side: 1 | -1): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 512;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#141416'); grd.addColorStop(1, '#050506');
  g.fillStyle = grd; g.fillRect(0, 0, 2048, 512);
  g.fillStyle = '#eceff2'; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (side < 0) {
    // stylised wings emblem + wordmark (logo side)
    g.strokeStyle = '#eceff2'; g.lineCap = 'round';
    const cx = 1024, cy = 190;
    for (const s of [-1, 1])
      for (let k = 0; k < 5; k++) {
        g.lineWidth = 9 - k;
        g.beginPath();
        g.moveTo(cx + s * 20, cy + 8 - k * 5);
        g.bezierCurveTo(cx + s * (70 + k * 18), cy - 60 - k * 8, cx + s * (130 + k * 22), cy - 70 + k * 10, cx + s * (170 + k * 15), cy - 40 + k * 22);
        g.stroke();
      }
    g.lineWidth = 8;
    g.beginPath(); g.ellipse(cx, cy + 16, 22, 40, 0, 0, Math.PI * 2); g.stroke();
    g.font = '700 70px "Segoe UI", Arial, sans-serif';
    g.fillText('JENABOM', cx, 380);
  } else {
    g.font = '600 82px "Segoe UI", Arial, sans-serif';
    g.fillText('CORDLESS SCREWDRIVER', 1024, 130);
    g.fillStyle = '#b9bdc4';
    g.font = '400 46px "Segoe UI", Arial, sans-serif';
    g.fillText('Model: TY-0101    Voltage: 3.6V    No-load speed: 220rpm', 1024, 270);
    g.fillText('Max torque: 3N.m    Charging input: 5V ⎓ 1A (Micro-USB)', 1024, 350);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
