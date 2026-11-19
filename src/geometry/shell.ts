import * as THREE from 'three';
import type { Station } from '../config/types';

/**
 * Shell cross-sections (from the listing close-ups): a near-round superellipse body — the tool is
 * essentially cylindrical — cut by flat planes that leave crisp creases:
 *
 *        ╭───╮          round top
 *       ╱     ╲  ← upper chamfer facet (ct mm deep, normal at `at`°) — the long barrel crease
 *      │       │ ← flat side panel (sd mm deep) — logo / label plates sit here
 *       ╲     ╱  ← lower chamfer facet (cb mm deep, normal at `ab`°)
 *        ╰───╯          round bottom
 */
export interface Prof {
  top: number;
  bottom: number;
  half: number;
  e: number; // superellipse exponent (2 = ellipse)
  sd: number; // side-panel cut depth, mm
  ct: number; // upper chamfer cut depth, mm
  cb: number; // lower chamfer cut depth, mm
  at: number; // upper chamfer normal angle, deg above horizontal
  ab: number; // lower chamfer normal angle, deg (negative = below)
}

const DEF = { e: 2.3, sd: 0, ct: 0, cb: 0, at: 45, ab: -45 };
const full = (s: Station): Prof => ({
  top: s.top, bottom: s.bottom, half: s.half,
  e: s.e ?? DEF.e, sd: s.sd ?? DEF.sd, ct: s.ct ?? DEF.ct, cb: s.cb ?? DEF.cb, at: s.at ?? DEF.at, ab: s.ab ?? DEF.ab,
});
const KEYS: (keyof Prof)[] = ['top', 'bottom', 'half', 'e', 'sd', 'ct', 'cb', 'at', 'ab'];

/** Profile lookup: Catmull–Rom between smooth stations, linear next to `sharp` stations (crisp breaks). */
export function profileAt(stations: Station[], x: number): Prof {
  const s = stations;
  if (x <= s[0].x) return full(s[0]);
  if (x >= s[s.length - 1].x) return full(s[s.length - 1]);
  let i = 0;
  while (i < s.length - 2 && x > s[i + 1].x) i++;
  const a = full(s[i]), b = full(s[i + 1]);
  const t = (x - s[i].x) / Math.max(1e-6, s[i + 1].x - s[i].x);
  const out = {} as Prof;
  if (s[i].sharp || s[i + 1].sharp) {
    for (const k of KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
    return out;
  }
  const p0 = full(s[Math.max(0, i - 1)]), p3 = full(s[Math.min(s.length - 1, i + 2)]);
  for (const k of KEYS) {
    if (k === 'top' || k === 'bottom' || k === 'half') {
      const A = p0[k], B = a[k], C = b[k], D = p3[k];
      const v = 0.5 * (2 * B + (-A + C) * t + (2 * A - 5 * B + 4 * C - D) * t * t + (-A + 3 * B - 3 * C + D) * t * t * t);
      const lo = Math.min(B, C), hi = Math.max(B, C);
      out[k] = Math.min(hi + 0.2 * (hi - lo), Math.max(lo - 0.2 * (hi - lo), v));
    } else out[k] = a[k] + (b[k] - a[k]) * t;
  }
  return out;
}

/* ---------- cross-section polyline ---------- */
// pieces bottom→top: arc, lower facet, arc, side panel, arc, upper facet, arc
const PIECES = [6, 4, 4, 6, 4, 4, 6];
export const SEC_N = PIECES.reduce((a, b) => a + b, 0);

const cache = new Map<string, Float64Array>();

/** Half-section for the +Z side as [z0,y0, z1,y1, …] (SEC_N+1 points), bottom-centre → top-centre. */
export function sectionPolyline(p: Prof, inset = 0): Float64Array {
  const key = KEYS.map((k) => p[k].toFixed(3)).join(',') + ',' + inset;
  const hit = cache.get(key);
  if (hit) return hit;
  const T = Math.max(1, p.top - inset), B = Math.max(1, p.bottom - inset), H = Math.max(1, p.half - inset);
  const ex = 2 / Math.max(1.2, p.e);
  const base = (ph: number): [number, number] => {
    const sn = Math.sin(ph), cs = Math.cos(ph);
    return [H * Math.pow(Math.abs(cs), ex), (sn >= 0 ? T : B) * Math.sign(sn) * Math.pow(Math.abs(sn), ex)];
  };
  // cutting planes (z, y normal; offset d) — offsets measured from the body's support in that direction
  const planes: { n: [number, number]; d: number }[] = [];
  const support = (n: [number, number]) => {
    let m = -Infinity;
    for (let k = 0; k <= 360; k++) {
      const q = base(-Math.PI / 2 + (Math.PI * k) / 360);
      m = Math.max(m, n[0] * q[0] + n[1] * q[1]);
    }
    return m;
  };
  const mk = (deg: number, cut: number) => {
    const r = (deg * Math.PI) / 180;
    const n: [number, number] = [Math.cos(r), Math.sin(r)];
    return { n, d: support(n) - Math.max(0, cut) };
  };
  const pl = [mk(p.ab, p.cb), { n: [1, 0] as [number, number], d: H - Math.max(0, p.sd) }, mk(p.at, p.ct)];
  planes.push(...pl);
  const viol = (k: number, ph: number) => {
    const q = base(ph);
    return planes[k].n[0] * q[0] + planes[k].n[1] * q[1] - planes[k].d;
  };
  // angular interval each plane cuts away (empty → collapsed at its normal direction)
  const intervals: [number, number][] = planes.map((_, k) => {
    let a = NaN, b = NaN, best = -Infinity, bestPh = 0;
    const N = 720;
    for (let i = 0; i <= N; i++) {
      const ph = -Math.PI / 2 + (Math.PI * i) / N;
      const v = viol(k, ph);
      if (v > best) { best = v; bestPh = ph; }
      if (v > 0) { if (Number.isNaN(a)) a = ph; b = ph; }
    }
    if (Number.isNaN(a)) return [bestPh, bestPh];
    const refine = (lo: number, hi: number) => {
      for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (viol(k, m) > 0) hi = m; else lo = m; }
      return hi;
    };
    const step = Math.PI / N;
    a = refine(Math.max(-Math.PI / 2, a - step), a);
    // refine upper edge (violation → no violation going up)
    let lo = b, hi = Math.min(Math.PI / 2, b + step);
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (viol(k, m) > 0) lo = m; else hi = m; }
    return [a, lo];
  });
  // keep the pieces ordered and non-overlapping
  const bp = [-Math.PI / 2, intervals[0][0], intervals[0][1], intervals[1][0], intervals[1][1], intervals[2][0], intervals[2][1], Math.PI / 2];
  for (let i = 1; i < bp.length; i++) bp[i] = Math.max(bp[i], bp[i - 1]);
  const out = new Float64Array((SEC_N + 1) * 2);
  let n = 0;
  const emit = (ph: number) => {
    let [z, y] = base(ph);
    for (let pass = 0; pass < 3; pass++)
      for (const P of planes) {
        const v = P.n[0] * z + P.n[1] * y - P.d;
        if (v > 0) { z -= v * P.n[0]; y -= v * P.n[1]; }
      }
    out[n++] = Math.max(0, z); out[n++] = y;
  };
  for (let piece = 0; piece < PIECES.length; piece++) {
    const a = bp[piece], b = bp[piece + 1], cnt = PIECES[piece];
    // cosine clustering toward both ends → crisp creases
    for (let k = 0; k < cnt; k++) emit(a + (b - a) * (0.5 - 0.5 * Math.cos((Math.PI * k) / cnt)));
  }
  emit(Math.PI / 2);
  out[0] = 0; out[out.length - 2] = 0; // close on the centre plane
  if (cache.size > 20000) cache.clear();
  cache.set(key, out);
  return out;
}

const arcCache = new WeakMap<Float64Array, Float64Array>();
/** Normalised arc length at each polyline vertex (used as the texture v coordinate). */
export function arcParams(pl: Float64Array): Float64Array {
  const hit = arcCache.get(pl);
  if (hit) return hit;
  const a = new Float64Array(SEC_N + 1);
  for (let i = 1; i <= SEC_N; i++) a[i] = a[i - 1] + Math.hypot(pl[i * 2] - pl[i * 2 - 2], pl[i * 2 + 1] - pl[i * 2 - 1]);
  for (let i = 0; i <= SEC_N; i++) a[i] /= a[SEC_N] || 1;
  arcCache.set(pl, a);
  return a;
}

/** Point on a half-section at parameter t ∈ [0,1] (bottom-centre → top-centre). */
export function sectionPoint(prof: Prof, t: number, side: 1 | -1, inset = 0) {
  const pl = sectionPolyline(prof, inset);
  const f = Math.min(SEC_N, Math.max(0, t * SEC_N));
  const i = Math.min(SEC_N - 1, Math.floor(f)), w = f - i;
  const z = pl[i * 2] + (pl[i * 2 + 2] - pl[i * 2]) * w;
  const y = pl[i * 2 + 1] + (pl[i * 2 + 3] - pl[i * 2 + 1]) * w;
  return { y, z: side * z };
}

/** Section parameter t (index-based, as used by sectionPoint) of the outer point at height y. */
export function tParamForY(prof: Prof, y: number) {
  const pl = sectionPolyline(prof);
  if (y <= pl[1]) return 0;
  for (let i = 0; i < SEC_N; i++) {
    const y0 = pl[i * 2 + 1], y1 = pl[i * 2 + 3];
    if (y1 > y0 && y >= y0 && y <= y1) return (i + (y - y0) / (y1 - y0)) / SEC_N;
  }
  return 1;
}

/** Texture v (normalised arc length) of the outer-surface point at height y. */
export function tForY(prof: Prof, y: number) {
  const pl = sectionPolyline(prof);
  const ar = arcParams(pl);
  if (y <= pl[1]) return 0;
  for (let i = 0; i < SEC_N; i++) {
    const y0 = pl[i * 2 + 1], y1 = pl[i * 2 + 3];
    if (y1 > y0 && y >= y0 && y <= y1) return ar[i] + (ar[i + 1] - ar[i]) * ((y - y0) / (y1 - y0));
  }
  return 1;
}

export interface SeamDef {
  x0: number; // seam centre on the axis
  beta: number; // seam tilt from the perpendicular plane, rad
}
/** Seam plane: the +Y (trigger) side is nearer the butt (PHOTO-S/PHOTO-P), so the head bends toward +Y. */
export const seamX = (seam: SeamDef, y: number) => seam.x0 - y * Math.tan(seam.beta);
export const seamNormal = (seam: SeamDef) => new THREE.Vector3(Math.cos(seam.beta), Math.sin(seam.beta), 0);

/** UV convention shared with the shell textures: u = x / L, v = section parameter t. */
export const UV_LENGTH = 203;

/** Axial sample positions: uniform spacing plus both sides of every `sharp` station (crisp creases). */
function axialSamples(stations: Station[], x0: number, x1: number, step: number) {
  const xs = new Set<number>();
  for (let x = x0; x <= x1 + 1e-6; x += step) xs.add(+x.toFixed(4));
  for (const s of stations) if (s.sharp && s.x > x0 && s.x < x1) { xs.add(s.x); xs.add(s.x - 0.08); xs.add(s.x + 0.08); }
  xs.add(x1);
  return [...xs].sort((a, b) => a - b);
}

/**
 * One shell half (left/right × handle/head) with wall thickness. Columns follow a shared axial
 * grid and are clamped to the diagonal seam, so creases line up exactly with sharp stations.
 */
export function shellHalfGeometry(
  stations: Station[],
  part: 'handle' | 'head',
  side: 1 | -1,
  seam: SeamDef,
  xEnd: number,
  wall: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const seamProf = profileAt(stations, seam.x0);
  const reach = Math.max(seamProf.top, seamProf.bottom) * Math.tan(seam.beta) + 1;
  const xsAll = part === 'handle'
    ? axialSamples(stations, 0, seam.x0 + reach, 1.6)
    : axialSamples(stations, seam.x0 - reach, xEnd, 1.6);
  const nU = xsAll.length - 1;
  const nV = SEC_N;
  const grid = (inset: number) => {
    const start = pos.length / 3;
    for (let i = 0; i <= nU; i++) {
      for (let j = 0; j <= nV; j++) {
        const t = j / nV;
        const yS = sectionPoint(seamProf, t, side, inset).y;
        const xs = seamX(seam, yS) + (part === 'handle' ? -0.12 : 0.12);
        const x = part === 'handle' ? Math.min(xsAll[i], xs) : Math.max(xsAll[i], xs);
        const pr = profileAt(stations, x);
        const q = sectionPoint(pr, t, side, inset);
        pos.push(x, q.y, q.z);
        uv.push(x / UV_LENGTH, arcParams(sectionPolyline(pr, inset))[j]);
      }
    }
    return start;
  };
  const o = grid(0);
  const n = grid(wall);
  const at = (base: number, i: number, j: number) => base + i * (nV + 1) + j;
  const flip = side < 0;
  const quad = (a: number, b: number, c: number, d: number, rev: boolean) => {
    if (rev !== flip) idx.push(a, c, b, a, d, c);
    else idx.push(a, b, c, a, c, d);
  };
  for (let i = 0; i < nU; i++)
    for (let j = 0; j < nV; j++) {
      quad(at(o, i, j), at(o, i + 1, j), at(o, i + 1, j + 1), at(o, i, j + 1), false);
      quad(at(n, i, j), at(n, i + 1, j), at(n, i + 1, j + 1), at(n, i, j + 1), true);
    }
  const rim = (pairs: [number, number][]) => {
    for (let k = 0; k < pairs.length - 1; k++) {
      const [a0, b0] = pairs[k], [a1, b1] = pairs[k + 1];
      const base = pos.length / 3;
      for (const v of [a0, a1, b1, b0]) {
        pos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        uv.push(0.999, 0.999);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };
  const lines: [number, number][][] = [[], [], [], []];
  for (let i = 0; i <= nU; i++) {
    lines[0].push([at(o, i, 0), at(n, i, 0)]);
    lines[1].push([at(o, i, nV), at(n, i, nV)]);
  }
  for (let j = 0; j <= nV; j++) {
    lines[2].push([at(o, 0, j), at(n, 0, j)]);
    lines[3].push([at(o, nU, j), at(n, nU, j)]);
  }
  lines.forEach(rim);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Half bulkhead plate lying in the seam plane, with a central pass-through hole. */
export function seamPlateGeometry(stations: Station[], side: 1 | -1, seam: SeamDef, inset: number, offset: number, holeR: number) {
  const prof = profileAt(stations, seam.x0);
  const nrm = seamNormal(seam);
  const pos: number[] = [];
  const idx: number[] = [];
  const N = SEC_N;
  const up = new THREE.Vector3(-Math.sin(seam.beta), Math.cos(seam.beta), 0);
  for (let j = 0; j <= N; j++) {
    const t = j / N;
    const xs = seamX(seam, sectionPoint(prof, t, side, inset).y);
    const q = sectionPoint(profileAt(stations, xs), t, side, inset);
    const outer = new THREE.Vector3(xs, q.y, q.z).addScaledVector(nrm, offset);
    const phi = -Math.PI / 2 + Math.PI * t;
    const inner = new THREE.Vector3(seam.x0, 0, 0)
      .addScaledVector(up, holeR * Math.sin(phi))
      .add(new THREE.Vector3(0, 0, side * holeR * Math.cos(phi)))
      .addScaledVector(nrm, offset);
    pos.push(outer.x, outer.y, outer.z, inner.x, inner.y, inner.z);
  }
  for (let j = 0; j < N; j++) {
    const a = j * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
