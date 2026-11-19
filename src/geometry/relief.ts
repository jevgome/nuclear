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

/** Resample a 2D polyline every `step` mm. */
function resample(pts: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const L = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

/**
 * A rib swept along a surface path. Flat-shaded so every edge stays crisp.
 * `w` = width across the path, `h` = height above the surface (mm).
 */
export function ribGeometry(
  stations: Station[], path: [number, number][], side: 1 | -1, w: number, h: number, profile: RibProfile = 'box',
): THREE.BufferGeometry {
  const pts = resample(path, 0.8);
  const frames = pts.map(([x, y]) => surfaceFrame(stations, x, y, side));
  const prof = PROFILES[profile](w, h);
  const rings: THREE.Vector3[][] = frames.map((f, i) => {
    const a = frames[Math.max(0, i - 1)].p, b = frames[Math.min(frames.length - 1, i + 1)].p;
    const T = b.clone().sub(a).normalize();
    const B = new THREE.Vector3().crossVectors(T, f.n).normalize();
    return prof.map(([u, v]) => f.p.clone().addScaledVector(B, u).addScaledVector(f.n, v));
  });
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
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
}

/** Logo/label plate corners (top-rear, top-front, bottom-front, bottom-rear) — PHOTO-S. */
export const PLATE: [number, number][] = [[113.3, 14.7], [155.7, 8.4], [162, -5.9], [120.8, 1.5]];

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

export function reliefItems(stations: Station[], trigger: { start: number; end: number; width: number } = { start: 54, end: 86, width: 10 }): ReliefItem[] {
  const top = (x: number) => profileAt(stations, x).top;
  const bot = (x: number) => profileAt(stations, x).bottom;
  const out: ReliefItem[] = [];
  // --- barrel ---
  // raised frame around the plate (the plate sits in a ledge, d_main / d_hero)
  const P = PLATE, g = 1.5;
  out.push({ part: 'head', w: 1.5, h: 0.8, profile: 'ridge', path: [
    [P[0][0] - g, P[0][1] + g], [P[1][0] + g * 0.6, P[1][1] + g], [P[2][0] + g, P[2][1] - g], [P[3][0] - g * 0.6, P[3][1] - g], [P[0][0] - g, P[0][1] + g],
  ] });
  // upper ledge: sweeps from the nose shoulder back above the plate toward the PUSH button
  out.push({ part: 'head', w: 1.6, h: 0.9, profile: 'box', path: [[185.4, 13.5], [170, 15.2], [150, 17.2], [128, 19.2], [114, 20.6]] });
  // lower ledge under the plate, from the nose shoulder to the joint
  out.push({ part: 'head', w: 1.6, h: 0.9, profile: 'box', path: [[185.4, -9], [165, -8.4], [145, -6.6], [126, -4.4], [117, -3.2]] });
  // stepped slats on the lower flank (6 in the main listing photos)
  for (let x = 120; x <= 156; x += 6.6) out.push({ part: 'head', w: 3.4, h: 0.8, profile: 'saw', path: [[x, -10.5], [x + 5.5, Math.max(-bot(x + 5.5) + 3.2, -21.5)]] });
  // short transverse ribs across the top (product video side shots, d_hero)
  for (let x = 134; x <= 164; x += 6) out.push({ part: 'head', w: 1.2, h: 0.6, profile: 'ridge', path: [[x, top(x) - 0.4], [x - 1.8, top(x) - 7.5]] });
  // --- grip ---
  // slats wrapping around the front of the grip (d_pist, PHOTO-S): side → over the front centre
  for (let x = 23; x <= 79; x += 6.2) {
    const xe = x + 6;
    const inSlot = xe > trigger.start - 2 && xe < trigger.end + 2;
    // stop at the trigger slot edge; elsewhere wrap over the front centre
    const yEnd = inSlot ? yAtZTop(stations, xe, trigger.width / 2 + 1.2) : top(xe) - 0.05;
    out.push({ part: 'handle', w: 3.0, h: 0.6, profile: 'saw', path: [[x, 3.5], [x + 4.6, Math.min(yEnd - 0.5, top(x + 4.6) - 5)], [xe, yEnd]] });
  }
  // raised frame band down the side of the grip (bounds the ribbed front zone)
  const band: [number, number][] = [];
  for (let x = 6; x <= 92; x += 2) band.push([x, Math.min(top(x) - 6, 2.2 + Math.max(0, 20 - x) * 0.35)]);
  out.push({ part: 'handle', w: 2.2, h: 0.8, profile: 'ridge', path: band });
  // back insert: lip along its border + diagonal ribs (PHOTO-P "Handle")
  const lip: [number, number][] = [];
  for (let x = 5; x <= 96; x += 2) lip.push([x, -(bot(x) - 8.6)]);
  out.push({ part: 'handle', w: 1.4, h: 0.7, profile: 'box', path: lip });
  for (let x = 12; x <= 62; x += 3.6) out.push({ part: 'handle', w: 1.1, h: 0.55, profile: 'ridge', path: [[x, -bot(x) + 0.3], [x + 2.2, -bot(x + 2.2) + 6.5]] });
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
