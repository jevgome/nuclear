import type { MaterialKey, StageSpec } from '../config/types';

export const PRESSURE_ANGLE = (20 * Math.PI) / 180;

/** Ring fixed, sun input, carrier output. */
export const stageRatio = (s: StageSpec): number => 1 + s.ring / s.sun;
export const totalRatio = (stages: StageSpec[]): number => stages.reduce((r, s) => r * stageRatio(s), 1);
export const totalEfficiency = (stages: StageSpec[]): number => stages.reduce((e, s) => e * s.efficiency, 1);

/** Centre distance sun↔planet as dictated by the ring (ring & planet unshifted). */
export const carrierRadius = (s: StageSpec): number => (s.module * (s.ring - s.planet)) / 2;
/** Profile shift (in modules) the sun would need to reach the planets. */
export const requiredSunShift = (s: StageSpec): number => (carrierRadius(s) - (s.module * (s.sun + s.planet)) / 2) / s.module;
export const standardPlanetTeeth = (s: StageSpec): number => (s.ring - s.sun) / 2;

export type Severity = 'error' | 'warning' | 'info';
export interface Issue {
  severity: Severity;
  message: string;
}

export function validateStage(s: StageSpec): Issue[] {
  const out: Issue[] = [];
  const int = (n: number) => Number.isInteger(n) && n > 0;
  if (![s.sun, s.ring, s.planet, s.planets].every(int)) {
    out.push({ severity: 'error', message: 'Tooth and planet counts must be positive integers.' });
    return out;
  }
  if (s.ring <= s.sun + 2) out.push({ severity: 'error', message: 'Ring must have far more teeth than the sun.' });
  const std = standardPlanetTeeth(s);
  if (std !== s.planet) {
    const shift = requiredSunShift(s);
    out.push({
      severity: Math.abs(shift) > 1.2 ? 'warning' : 'info',
      message:
        `Standard geometry needs planet = (ring − sun)/2 = ${Number.isInteger(std) ? std : std.toFixed(1)} teeth; ` +
        `with ${s.planet} the sun needs a profile shift of ${shift >= 0 ? '+' : ''}${shift.toFixed(2)}·m to mesh.`,
    });
  }
  if ((s.ring + s.sun) % s.planets !== 0)
    out.push({
      severity: 'error',
      message: `Planets cannot be equally spaced: (ring + sun) = ${s.ring + s.sun} is not divisible by ${s.planets}.`,
    });
  // neighbouring planets must not collide
  const a = carrierRadius(s);
  const chord = 2 * a * Math.sin(Math.PI / s.planets);
  const tipD = s.module * (s.planet + 2);
  if (chord <= tipD + 0.2 * s.module)
    out.push({ severity: 'error', message: `Adjacent planets collide (spacing ${chord.toFixed(2)} mm < tip Ø ${tipD.toFixed(2)} mm).` });
  if (s.sun < 12)
    out.push({ severity: 'info', message: `${s.sun}-tooth sun is below the 17-tooth undercut limit — requires positive profile shift (common in toy/tool gearboxes).` });
  if (s.ring - s.planet < 10)
    out.push({ severity: 'warning', message: 'Ring − planet < 10 teeth: risk of internal tip interference.' });
  if (s.efficiency <= 0 || s.efficiency > 1) out.push({ severity: 'error', message: 'Efficiency must be in (0, 1].' });
  return out;
}

/* ---------- strength (Lewis bending) ---------- */
const LEWIS_Y: [number, number][] = [
  [6, 0.17], [8, 0.2], [10, 0.22], [12, 0.245], [13, 0.261], [14, 0.277], [15, 0.29], [16, 0.296],
  [17, 0.303], [18, 0.309], [19, 0.314], [20, 0.322], [21, 0.328], [22, 0.331], [24, 0.337],
  [26, 0.346], [28, 0.353], [30, 0.359], [34, 0.371], [38, 0.384], [43, 0.397], [50, 0.409],
  [60, 0.422], [75, 0.435], [100, 0.447], [150, 0.46], [300, 0.472],
];
/** Lewis form factor, 20° full depth. Values below 12 teeth are extrapolated (profile-shifted gears differ). */
export function lewisY(z: number): number {
  if (z <= LEWIS_Y[0][0]) return LEWIS_Y[0][1];
  for (let i = 1; i < LEWIS_Y.length; i++) {
    const [z1, y1] = LEWIS_Y[i];
    if (z <= z1) {
      const [z0, y0] = LEWIS_Y[i - 1];
      return y0 + ((y1 - y0) * (z - z0)) / (z1 - z0);
    }
  }
  return LEWIS_Y[LEWIS_Y.length - 1][1];
}

/** Typical allowable bending stress, MPa (assumed textbook values). */
export const MATERIALS: Record<MaterialKey, { name: string; allowMPa: number; color: number }> = {
  POM: { name: 'POM (acetal)', allowMPa: 40, color: 0xf1e6cc },
  PA66: { name: 'Nylon PA66', allowMPa: 45, color: 0xf5ecd6 },
  PLA: { name: 'PLA (3D print)', allowMPa: 25, color: 0x6aa7e0 },
  PETG: { name: 'PETG (3D print)', allowMPa: 22, color: 0x7fd1b9 },
  Steel: { name: 'Steel', allowMPa: 250, color: 0xb8bcc2 },
};

export interface StageLoad {
  inputTorque: number; // N·m on sun
  outputTorque: number; // N·m on carrier
  toothForce: number; // N per sun–planet mesh
  sunStress: number; // MPa
  planetStress: number; // MPa
  safety: number; // allowable / max stress
}

/** Torque flow through the stages for a given motor torque (N·m). */
export function stageLoads(stages: StageSpec[], motorTorque: number): StageLoad[] {
  let t = motorTorque;
  return stages.map((s) => {
    const rSun = (s.module * s.sun) / 2 / 1000; // m
    const ft = t / (rSun * s.planets); // N per mesh (equal load sharing assumed)
    const b = s.faceWidth, m = s.module; // mm → stress in N/mm² = MPa
    const sunStress = ft / (b * m * lewisY(s.sun));
    const planetStress = ft / (b * m * lewisY(s.planet));
    const out = t * stageRatio(s) * s.efficiency;
    const res: StageLoad = {
      inputTorque: t,
      outputTorque: out,
      toothForce: ft,
      sunStress,
      planetStress,
      safety: MATERIALS[s.material].allowMPa / Math.max(sunStress, planetStress, 1e-9),
    };
    t = out;
    return res;
  });
}

/* ---------- kinematics & mesh phasing ---------- */
export interface StagePose {
  sun: number; // absolute angle, rad
  carrier: number;
  planets: number[]; // absolute spin angle of each planet
  planetOrbit: number[]; // orbit angle of each planet centre
}

const frac = (v: number) => v - Math.floor(v);

/**
 * Angles of every gear given the motor angle. Conventions: an external gear has
 * a tooth centred at local angle 0; the ring has a tooth centred at angle 0.
 * Phases are chosen so teeth interleave (planet gap faces ring tooth, sun tooth
 * faces planet gap), then everything follows the rolling constraints.
 */
export function poseStages(stages: StageSpec[], motorAngle: number): StagePose[] {
  let input = motorAngle;
  return stages.map((s) => {
    const R = s.ring, S = s.sun, P = s.planet;
    const carrier = input * (S / (S + R));
    const planets: number[] = [];
    const orbit: number[] = [];
    let sunPhase0 = 0;
    for (let i = 0; i < s.planets; i++) {
      const a0 = (2 * Math.PI * i) / s.planets;
      const alpha = carrier + a0;
      // rolling on fixed ring: planet gap aligned with ring tooth at contact
      const phi = alpha * (1 - R / P) - Math.PI / P;
      planets.push(phi);
      orbit.push(alpha);
      if (i === 0) {
        // phase of sun for planet 0 at the reference pose
        const a = a0;
        const phiRef = a * (1 - R / P) - Math.PI / P;
        const fp = frac(((a + Math.PI - phiRef) * P) / (2 * Math.PI));
        const fs = frac(0.5 - fp);
        sunPhase0 = a - (fs * 2 * Math.PI) / S;
      }
    }
    const sun = input + sunPhase0;
    input = carrier;
    return { sun, carrier, planets, planetOrbit: orbit };
  });
}
