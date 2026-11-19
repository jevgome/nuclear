import * as THREE from 'three';
import { PRESSURE_ANGLE } from '../physics/gears';

const inv = (a: number) => Math.tan(a) - a;

interface OutlineOpts {
  z: number;
  m: number;
  shift?: number; // profile shift coefficient x
  tipR?: number; // override tip radius
  rootR?: number; // override root radius
  flankPts?: number;
}

/**
 * Closed involute outline (external gear) as a polyline, tooth 0 centred at angle 0.
 * Also used for ring-gear holes (gaps of a ring have the shape of external teeth).
 */
export function gearOutline({ z, m, shift = 0, tipR, rootR, flankPts = 7 }: OutlineOpts): THREE.Vector2[] {
  const a = PRESSURE_ANGLE;
  const rp = (m * z) / 2;
  const rb = rp * Math.cos(a);
  let ra = tipR ?? rp + m * (1 + shift);
  const rf = Math.max(0.2 * m, rootR ?? rp - m * (1.25 - shift));
  const psiP = (Math.PI / 2 + 2 * shift * Math.tan(a)) / z; // half-angle of tooth at pitch circle
  const halfAt = (r: number) => {
    if (r <= rb) return psiP + inv(a);
    return psiP + inv(a) - inv(Math.acos(rb / r));
  };
  // keep tip from going pointed
  const minHalf = 0.12 / z;
  if (halfAt(ra) < minHalf) {
    let lo = Math.max(rb, rf), hi = ra;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (halfAt(mid) > minHalf) lo = mid; else hi = mid;
    }
    ra = lo;
  }
  const r0 = Math.max(rb, rf);
  const pitch = (2 * Math.PI) / z;
  const pts: THREE.Vector2[] = [];
  const P = (r: number, t: number) => pts.push(new THREE.Vector2(r * Math.cos(t), r * Math.sin(t)));
  for (let k = 0; k < z; k++) {
    const c = k * pitch;
    // root (between previous tooth and this one) — start at the left of the gap
    const hr0 = halfAt(r0);
    const gapStart = c - pitch + hr0;
    const gapEnd = c - hr0;
    const gapMid = (gapStart + gapEnd) / 2;
    if (rf < r0) {
      P(rf, gapMid);
      P(rf, gapEnd);
    } else {
      P(rf, gapMid);
    }
    // rising flank (right side of tooth)
    for (let i = 0; i <= flankPts; i++) {
      const r = r0 + ((ra - r0) * i) / flankPts;
      P(r, c - halfAt(r));
    }
    // tip
    P(ra, c);
    // falling flank (left side)
    for (let i = flankPts; i >= 0; i--) {
      const r = r0 + ((ra - r0) * i) / flankPts;
      P(r, c + halfAt(r));
    }
    if (rf < r0) P(rf, c + hr0);
  }
  return pts;
}

const circle = (r: number, n = 48, reverse = false) => {
  const path = new THREE.Path();
  for (let i = 0; i <= n; i++) {
    const t = ((reverse ? -1 : 1) * i * 2 * Math.PI) / n;
    const x = r * Math.cos(t), y = r * Math.sin(t);
    if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
  }
  return path;
};

const extrude = (shape: THREE.Shape | THREE.Shape[], depth: number) => {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 });
  // ExtrudeGeometry extrudes along +Z; tool axis is X → rotate so depth runs along +X
  g.rotateY(Math.PI / 2);
  g.computeVertexNormals();
  return g;
};

export function externalGearGeometry(z: number, m: number, face: number, boreR = 0, shift = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(gearOutline({ z, m, shift }));
  if (boreR > 0) shape.holes.push(circle(boreR, 32, true));
  return extrude(shape, face);
}

/** Ring gear: outer circle with an internal toothed hole. Ring tooth centred at angle 0. */
export function ringGearGeometry(z: number, m: number, face: number, outerR: number): THREE.BufferGeometry {
  const rp = (m * z) / 2;
  const holePts = gearOutline({ z, m, tipR: rp + 1.25 * m, rootR: rp - m }).map((v) =>
    v.clone().rotateAround(new THREE.Vector2(), Math.PI / z),
  );
  const shape = new THREE.Shape();
  const n = 96;
  for (let i = 0; i <= n; i++) {
    const t = (i * 2 * Math.PI) / n;
    if (i === 0) shape.moveTo(outerR * Math.cos(t), outerR * Math.sin(t));
    else shape.lineTo(outerR * Math.cos(t), outerR * Math.sin(t));
  }
  const hole = new THREE.Path(holePts.reverse());
  shape.holes.push(hole);
  return extrude(shape, face);
}

/** Flat disc/annulus along X. */
export function discGeometry(outerR: number, thickness: number, innerR = 0, holes: { y: number; z: number; r: number }[] = []) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerR, 0, Math.PI * 2, false);
  if (innerR > 0) shape.holes.push(circle(innerR, 32, true));
  for (const h of holes) {
    const p = new THREE.Path();
    p.absarc(h.y, h.z, h.r, 0, Math.PI * 2, true);
    shape.holes.push(p);
  }
  return extrude(shape, thickness);
}

/** Hexagon prism (across-flats) along X, optional round bore or hex socket. */
export function hexGeometry(af: number, length: number) {
  const r = af / Math.sqrt(3);
  const shape = new THREE.Shape();
  for (let i = 0; i <= 6; i++) {
    const t = (i * Math.PI) / 3;
    if (i === 0) shape.moveTo(r * Math.cos(t), r * Math.sin(t)); else shape.lineTo(r * Math.cos(t), r * Math.sin(t));
  }
  return extrude(shape, length);
}

/** Round tube with hex socket (spindle). */
export function socketTubeGeometry(outerR: number, hexAF: number, length: number) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerR, 0, Math.PI * 2, false);
  const r = hexAF / Math.sqrt(3);
  const hole = new THREE.Path();
  for (let i = 0; i <= 6; i++) {
    const t = (-i * Math.PI) / 3;
    if (i === 0) hole.moveTo(r * Math.cos(t), r * Math.sin(t)); else hole.lineTo(r * Math.cos(t), r * Math.sin(t));
  }
  shape.holes.push(hole);
  return extrude(shape, length);
}
