/**
 * Brushed DC motor, linear model:
 *   I = (V − Ke·ω) / R          (R = total loop resistance incl. battery + wiring)
 *   T = Kt·(I − I0)              (I0 = no-load current, lumps friction/iron losses)
 * with Kt = Ke (SI units).
 *
 * The RS-380SA has no published 3.6 V curve for this specific winding, so Ke and R
 * are calibrated from the rated output figures on the box:
 *   no-load:  ω0 = (V − I0·R) / Ke
 *   stall:    Ts = Ke·(V/R − I0)
 */
export interface MotorModel {
  ke: number; // V·s/rad == N·m/A
  r: number; // Ω (total loop)
  i0: number; // A
}

export interface CalibrationInput {
  voltage: number; // V at which the rating applies
  noLoadMotorRadS: number; // motor no-load speed, rad/s
  stallMotorTorque: number; // N·m at the motor shaft
  noLoadCurrent: number; // A
}

export function calibrateMotor(c: CalibrationInput): MotorModel {
  const { voltage: V, noLoadMotorRadS: w0, stallMotorTorque: Ts, noLoadCurrent: I0 } = c;
  const torqueAt = (R: number) => ((V - I0 * R) / w0) * (V / R - I0);
  // torqueAt is monotonically decreasing in R on (0, V/I0): bisection.
  let lo = 1e-5, hi = I0 > 0 ? V / I0 - 1e-6 : 1e3;
  if (torqueAt(lo) < Ts) throw new Error('Rated stall torque unreachable with this no-load current');
  for (let k = 0; k < 200; k++) {
    const mid = Math.sqrt(lo * hi);
    if (torqueAt(mid) > Ts) lo = mid; else hi = mid;
  }
  const r = Math.sqrt(lo * hi);
  return { ke: (V - I0 * r) / w0, r, i0: I0 };
}

export const rpmToRadS = (rpm: number) => (rpm * 2 * Math.PI) / 60;
export const radSToRpm = (w: number) => (w * 60) / (2 * Math.PI);

/** Steady-state operating point (motor side) for a given voltage and motor-side load torque. */
export function steadyState(m: MotorModel, V: number, loadTorqueMotor: number) {
  // Kt(I − I0) = TL  →  I = TL/Kt + I0 ;  ω = (V − I·R)/Ke
  const I = loadTorqueMotor / m.ke + m.i0;
  const w = (V - I * m.r) / m.ke;
  if (w <= 0) {
    const Is = V / m.r;
    return { omega: 0, current: Is, torque: m.ke * (Is - m.i0), stalled: true };
  }
  return { omega: w, current: I, torque: loadTorqueMotor, stalled: false };
}
