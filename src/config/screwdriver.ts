import { p, type Param, type StageSpec, type Station, type CustomPart } from './types';

/**
 * ============================================================================
 *  JENABOM TY-0101 3.6 V cordless screwdriver — single source of truth.
 * ============================================================================
 *  Sources referenced below:
 *   BOX      – retail box photos (IMG_9760.jpg, IMG_9761.jpg): "TY-0101", "3.6V",
 *              "n0: 220RPM", "Max torque: 3 N.m"
 *   OWNER    – direct answers from the project owner (2026-11-18)
 *   DOC      – "Junior Design Reverse Engineering Project.docx" (team measurements)
 *   TEARDOWN – teardown photo in DOC (media/image14.jpg), scale-calibrated against
 *              the 65 mm 18650 cell (≈5.89 px/mm at full resolution)
 *   LISTING  – Amazon ASIN B0B9XMJ335 (3.6 V, 3.5 N·m, Micro-USB, front LED, 6 bits)
 *   PHOTO-S  – listing image 61TvSmJEptL (straight mode, labelled "21.5cm"): side silhouette
 *              traced at 4.72 px/mm (chuck Ø check: 11 mm vs 12 mm actual)
 *   PHOTO-P  – listing images 61qjylpcp2L / 61ADWuuoe9L (pistol mode, side): grip back edge,
 *              seam angle, control locations
 *   RS-380   – Mabuchi RS-380 series can dimensions (industry standard)
 *  Anything marked 'assumed' or 'uncertain' is listed in UNCERTAINTIES.md.
 * ============================================================================
 */

export interface ScrewdriverSpec {
  rated: Record<'voltage' | 'noLoadRpm' | 'maxTorque' | 'stockRatio' | 'listingTorque' | 'measuredTorque' | 'massListing', Param>;
  motor: Record<
    | 'canDiameter' | 'canLength' | 'endcapLength' | 'shaftDiameter' | 'shaftProtrusion'
    | 'noLoadCurrent' | 'rotorInertia' | 'startX',
    Param
  >;
  battery: Record<
    'capacity' | 'nominal' | 'full' | 'cutoff' | 'internalR' | 'diameter' | 'length' | 'startX' | 'chargeCurrent',
    Param
  >;
  electrical: Record<'wiringR' | 'ledCurrent', Param>;
  gearbox: Record<
    'stageEfficiency' | 'housingDiameter' | 'housingStartX' | 'housingEndX' | 'noseDiameter' | 'carrierThickness' | 'stageGap' | 'spindleBearingLen',
    Param
  >;
  spindle: Record<'outerDiameter' | 'innerDiameter' | 'hexAF' | 'exposedLength' | 'socketDepth', Param>;
  body: Record<
    'handleLength' | 'headLength' | 'bodyLength' | 'seamCenter' | 'shellDiameter' | 'seamAngle' | 'wall' | 'massG',
    Param
  >;
  /** External controls & features (straight-configuration coordinates: X from butt, +Y = trigger side) */
  controls: Record<
    | 'triggerStart' | 'triggerEnd' | 'triggerHeight' | 'triggerWidth'
    | 'frX' | 'frY' | 'frLength' | 'frWidth'
    | 'pushX' | 'pushWidth'
    | 'chinStart' | 'chinEnd' | 'chinDepth'
    | 'collarRadius' | 'collarDepth',
    Param
  >;
  bit: Record<'length' | 'hexAF', Param>;
  stages: StageSpec[];
  /** Side profile of the shell (straight configuration). Approximated from TEARDOWN. */
  profile: Station[];
  customParts: CustomPart[];
}

export const STOCK_STAGE = (id: string): StageSpec => ({
  id,
  sun: 6, // OWNER
  ring: 48, // OWNER
  planet: 19, // DOC notebook "# teeth on gear: 19" — see UNCERTAINTIES (geometry wants 21)
  planets: 3, // DOC photo + notebook "Total # of gears: 6 (3×2)"
  module: 0.667, // derived: planet OD 14 mm (DOC) / (19 + 2)
  faceWidth: 4, // DOC notebook: gear thickness 0.4 cm
  efficiency: 0.9, // assumed — typical plastic planetary stage
  material: 'POM',
  stock: true,
});

export function defaultSpec(): ScrewdriverSpec {
  return {
    rated: {
      voltage: p(3.6, 'V', 'Rated voltage', 'confirmed', 'BOX "3.6V"; LISTING; motor stamp "DC3.6V"'),
      noLoadRpm: p(220, 'rpm', 'No-load output speed', 'confirmed', 'BOX "n0: 220RPM" (OWNER: use box)'),
      maxTorque: p(3.0, 'N·m', 'Max torque (rated)', 'confirmed', 'BOX "Max torque: 3 N.m" (OWNER: use box)',
        'Treated as output stall torque at rated voltage.'),
      stockRatio: p(81, ':1', 'Stock gearbox ratio', 'confirmed', 'OWNER + DOC: 2 stages × (1 + 48/6) = 81',
        'The motor is calibrated against THIS ratio; custom gearboxes reuse the same motor.'),
      listingTorque: p(3.5, 'N·m', 'Max torque (listing)', 'listing', 'LISTING title "3.5N·m Max Torque"',
        'Reference only — box value is used for calibration.'),
      measuredTorque: p(1.64, 'N·m', 'Measured stall torque', 'measured', 'DOC App. C: 6 in beam + weights',
        'Reference only. Measured on a unit whose battery state was unknown.'),
      massListing: p(269, 'g', 'Tool mass', 'listing', 'LISTING ("269gram handheld screwdriver")'),
    },
    motor: {
      canDiameter: p(27.7, 'mm', 'Can diameter', 'standard', 'RS-380 standard; stamp "RS380SA" (OWNER confirmed)'),
      canLength: p(38, 'mm', 'Can length', 'standard', 'RS-380 standard'),
      endcapLength: p(5, 'mm', 'Rear end-cap + terminals', 'measured', 'TEARDOWN (≈43 mm overall − 38 mm can)'),
      shaftDiameter: p(2.3, 'mm', 'Shaft diameter', 'standard', 'RS-380 standard'),
      shaftProtrusion: p(8, 'mm', 'Shaft protrusion into gearbox', 'assumed', 'Not visible in photos'),
      noLoadCurrent: p(0.5, 'A', 'No-load current', 'assumed', 'Typical small RS-380 at 3.6 V',
        'Used as the friction/iron-loss term in motor calibration.', { min: 0, max: 3, step: 0.05 }),
      rotorInertia: p(2.5e-6, 'kg·m²', 'Rotor inertia', 'assumed', 'Typical RS-380 armature',
        'Only affects spin-up/spin-down time.', { min: 1e-7, max: 1e-4, step: 1e-7 }),
      startX: p(115, 'mm', 'Motor rear face position', 'measured', 'TEARDOWN (≈115 mm from butt)'),
    },
    battery: {
      capacity: p(1.5, 'Ah', 'Capacity', 'measured', 'TEARDOWN: cell printed "1500mAh"',
        'Some listings say 1300 mAh; the photographed cell is used.'),
      nominal: p(3.6, 'V', 'Nominal voltage', 'confirmed', 'BOX'),
      full: p(4.2, 'V', 'Full-charge voltage', 'standard', 'Li-ion standard'),
      cutoff: p(3.0, 'V', 'Discharge cutoff', 'assumed', 'No protection IC identified on the PCB'),
      internalR: p(0.05, 'Ω', 'Cell internal resistance', 'assumed', 'Typical 18650 1500 mAh'),
      diameter: p(18, 'mm', 'Cell diameter', 'standard', '18650 format'),
      length: p(65, 'mm', 'Cell length', 'standard', '18650 format (used as the photo scale reference)'),
      startX: p(21, 'mm', 'Cell rear position', 'measured', 'TEARDOWN'),
      chargeCurrent: p(0.5, 'A', 'Charge current', 'assumed', 'Charger IC not identified; Micro-USB 5 V'),
    },
    electrical: {
      wiringR: p(0.02, 'Ω', 'Wiring + switch resistance', 'assumed', 'Estimate'),
      ledCurrent: p(0.02, 'A', 'White LED current', 'assumed', 'Typical 5 mm LED'),
    },
    gearbox: {
      stageEfficiency: p(0.9, '', 'Stock stage efficiency (calibration)', 'assumed',
        'Typical plastic planetary stage 0.85–0.93', 'Used to back out motor stall torque from the 3 N·m box rating.',
        { min: 0.5, max: 1, step: 0.01 }),
      housingDiameter: p(36, 'mm', 'Housing outer diameter', 'measured', 'TEARDOWN (≈1.3× motor can)'),
      housingStartX: p(162, 'mm', 'Housing rear face', 'measured', 'TEARDOWN'),
      housingEndX: p(180, 'mm', 'Housing full-Ø end (taper starts)', 'derived', 'TEARDOWN ≈192 mm overall; must taper by ≈180 mm to fit inside the nose cone traced from PHOTO-S (checked by clearance.test.ts)',
        'Gears must end before this point; adding stages beyond it extends the head.'),
      noseDiameter: p(20, 'mm', 'Housing nose diameter', 'measured', 'TEARDOWN / image9 (hex nose)'),
      carrierThickness: p(2, 'mm', 'Carrier plate thickness', 'assumed', 'Clear carrier disc visible in image9; not measured'),
      stageGap: p(1.5, 'mm', 'Axial clearance per stage', 'assumed', 'Not measured'),
      spindleBearingLen: p(10, 'mm', 'Spindle bearing length in nose', 'assumed', 'Not measured (nose has ≈15 mm available)'),
    },
    spindle: {
      outerDiameter: p(12, 'mm', 'Spindle outer diameter', 'measured', 'DOC "outer diameter of 1.2cm"'),
      innerDiameter: p(8, 'mm', 'Socket (measured)', 'measured', 'DOC "inner diameter of 0.8 cm"',
        'Consistent with a 1/4" hex socket measured across corners (7.33 mm).'),
      hexAF: p(6.35, 'mm', 'Hex socket across flats', 'standard', '1/4" hex bit standard'),
      exposedLength: p(12, 'mm', 'Exposed length', 'measured', 'DOC "0.5 inches/1.2cm long"'),
      socketDepth: p(12, 'mm', 'Socket depth', 'assumed', 'Not measured'),
    },
    body: {
      handleLength: p(110, 'mm', 'Handle length', 'measured', 'DOC + OWNER (11 cm)',
        'Butt to the swivel seam centre (PHOTO-S puts the seam centre at 109.6 mm).'),
      headLength: p(93, 'mm', 'Head length (excl. spindle)', 'measured', 'DOC + OWNER (9 cm); PHOTO-S 93 mm',
        'Seam centre to nose. 110 + 93 = 203 mm body.'),
      bodyLength: p(203, 'mm', 'Body length, straight (excl. spindle)', 'listing',
        'LISTING photo "21.5cm / 8.46inch" incl. 12 mm spindle → 203 mm; TEARDOWN ≈202 mm'),
      seamCenter: p(109.6, 'mm', 'Swivel seam centre (on axis)', 'measured', 'PHOTO-S trace'),
      shellDiameter: p(55.6, 'mm', 'Shell max height (at joint)', 'measured', 'DOC + OWNER (5.56 cm)',
        'PHOTO-S: the side profile peaks at ≈55 mm at the joint — consistent.'),
      seamAngle: p(36, '°', 'Swivel seam angle (from perpendicular)', 'measured',
        'PHOTO-P: seam line ≈36° to the grip normal; bend between barrel and grip ≈71–74°',
        'Angled (pistol) bend = 2 × seam angle = 72°. Listing text says "rotate ninety degrees" (marketing; photos show ≈72°).',
        { min: 10, max: 60, step: 0.5 }),
      wall: p(2, 'mm', 'Shell wall thickness', 'assumed', 'Not measured (DOC "Width of material:" left blank)'),
      massG: p(269, 'g', 'Mass', 'listing', 'LISTING'),
    },
    controls: {
      triggerStart: p(54, 'mm', 'Trigger rear end (X)', 'measured', 'PHOTO-S red paddle 54–86 mm'),
      triggerEnd: p(86, 'mm', 'Trigger front end (X)', 'measured', 'PHOTO-S'),
      triggerHeight: p(31, 'mm', 'Trigger tip height above axis', 'measured', 'PHOTO-S (paddle rises toward the butt)'),
      triggerWidth: p(10, 'mm', 'Trigger width', 'assumed', 'PHOTO-P proportion'),
      frX: p(88, 'mm', 'F/R button centre (X)', 'measured', 'PHOTO-S red pill, front edge level with the trigger front (yaw-corrected); PHOTO-P agrees (≈87.6)'),
      frY: p(9, 'mm', 'F/R button centre height', 'measured', 'PHOTO-S (2.5–15 mm above axis)'),
      frLength: p(12.5, 'mm', 'F/R pill length', 'measured', 'PHOTO-S'),
      frWidth: p(7, 'mm', 'F/R pill width', 'measured', 'PHOTO-S'),
      pushX: p(96.5, 'mm', 'PUSH (swivel release) centre (X)', 'measured', 'PHOTO-S red button 93–100 mm on top, head side of seam'),
      pushWidth: p(9, 'mm', 'PUSH button width', 'assumed', 'PHOTO-P proportion'),
      chinStart: p(163, 'mm', 'LED chin start (X)', 'measured', 'PHOTO-S bump under barrel'),
      chinEnd: p(178, 'mm', 'LED chin end (X)', 'measured', 'PHOTO-S'),
      chinDepth: p(27.2, 'mm', 'LED chin depth below axis', 'measured', 'PHOTO-S'),
      collarRadius: p(16, 'mm', 'Swivel collar radius', 'assumed', 'Required so the motor end-cap clears the 36° seam'),
      collarDepth: p(6, 'mm', 'Swivel collar depth into handle', 'assumed', 'Not visible'),
    },
    bit: {
      length: p(50, 'mm', 'Screwdriver bit length', 'measured', 'TEARDOWN (≈54 mm in photo); LISTING "4 x Long Screwdriver Bits"'),
      hexAF: p(6.35, 'mm', 'Bit shank', 'standard', '1/4" hex'),
    },
    stages: [STOCK_STAGE('stage-1'), STOCK_STAGE('stage-2')],
    profile: [
      // Side profile, straight configuration. x from butt, top = +Y (trigger side), bottom = −Y.
      // top/bottom: PHOTO-S trace (bottom of the grip from PHOTO-P). half-width: ASSUMED (no top view),
      // sized round-ish as the photos show (barrel ≈ as wide as tall).
      // Section = near-round body (e) cut by flat facets (listing close-ups): sd = flat side panel,
      // ct/cb = upper/lower chamfer depth (mm) at normal angle at/ab. The upper chamfer deepens toward
      // the nose so its crease drops, as in the photos. `sharp` = hard break (nose shoulder, butt face).
      { x: 0, top: 22, bottom: 7, half: 13.8, e: 2.5, sd: 1.4, ct: 2.4, cb: 2.4, sharp: true },
      { x: 2, top: 24.5, bottom: 11, half: 15, e: 2.45, sd: 1.3, ct: 2.5, cb: 2.3, sharp: true },
      { x: 5.5, top: 26.3, bottom: 14.5, half: 15.6, e: 2.35, sd: 1.2, ct: 2.6, cb: 1.6 },
      { x: 8.5, top: 27.8, bottom: 17.5, half: 15.9, e: 2.35, sd: 1.2, ct: 2.6, cb: 1.6 },
      { x: 11.7, top: 28.4, bottom: 18.8, half: 16, e: 2.35, sd: 1.2, ct: 2.6, cb: 1.6 },
      { x: 14.8, top: 27.1, bottom: 19.6, half: 16, e: 2.35, sd: 1.2, ct: 2.6, cb: 1.6 },
      { x: 18, top: 25, bottom: 20.3, half: 16, e: 2.35, sd: 1.2, ct: 2.6, cb: 1.6 },
      { x: 21, top: 22.7, bottom: 21, half: 16, e: 2.35, sd: 1.2, ct: 2.6, cb: 1.6 },
      { x: 24.4, top: 20.4, bottom: 21.5, half: 16, e: 2.35, sd: 1.2, ct: 2.6, cb: 1.6 },
      { x: 30, top: 20.7, bottom: 22, half: 16, e: 2.35, sd: 1.2, ct: 2.6, cb: 1.6 },
      { x: 34, top: 21.6, bottom: 22.3, half: 16, e: 2.35, sd: 1.2, ct: 2.6, cb: 1.6 },
      { x: 40, top: 22.9, bottom: 22.3, half: 16, e: 2.35, sd: 1.2, ct: 2.6, cb: 1.6 },
      { x: 53, top: 23.5, bottom: 22.4, half: 16, e: 2.35, sd: 1.2, ct: 2.6, cb: 1.6 },
      { x: 65, top: 23.5, bottom: 22, half: 16, e: 2.35, sd: 1.2, ct: 2.6, cb: 1.6 },
      { x: 80, top: 23.3, bottom: 22, half: 16.3, e: 2.35, sd: 1.2, ct: 2.6, cb: 1.6 },
      { x: 91, top: 23.3, bottom: 23.1, half: 17.4, e: 2.35, sd: 1.4, ct: 2.6, cb: 2.4 },
      { x: 97.5, top: 25.8, bottom: 24.2, half: 18.6, e: 2.3, sd: 1.6, ct: 2.4, cb: 2.6 },
      { x: 103.8, top: 26.4, bottom: 27.5, half: 20, e: 2.3, sd: 1.8, ct: 2.2, cb: 3 },
      { x: 108, top: 26, bottom: 29.2, half: 21, e: 2.3, sd: 2, ct: 2, cb: 3.3 },
      { x: 113, top: 24.6, bottom: 27.4, half: 22, e: 2.25, sd: 3.2, ct: 2.6, cb: 3.4, at: 44, ab: -40 },
      { x: 120, top: 24.4, bottom: 23.3, half: 22.8, e: 2.2, sd: 4.0, ct: 3.4, cb: 3.8, at: 46, ab: -40 },
      { x: 132, top: 24.2, bottom: 23.3, half: 23, e: 2.2, sd: 4.2, ct: 4.2, cb: 4, at: 46, ab: -40 },
      { x: 145, top: 23.9, bottom: 23.5, half: 23.2, e: 2.2, sd: 4.2, ct: 4.6, cb: 4, at: 44, ab: -40 },
      { x: 156, top: 23.7, bottom: 23.6, half: 23.3, e: 2.2, sd: 3.6, ct: 3.8, cb: 3.6, at: 42, ab: -40 },
      { x: 161, top: 23.5, bottom: 23.6, half: 23.4, e: 2.2, sd: 2.6, ct: 3.0, cb: 3.0, at: 40, ab: -40 },
      { x: 170, top: 22, bottom: 23, half: 23.6, e: 2.15, sd: 1.7, ct: 1.6, cb: 2.4, at: 40, ab: -40 },
      { x: 177, top: 21.8, bottom: 22, half: 23.4, e: 2.1, sd: 1.5, ct: 1.2, cb: 1.6, at: 42, ab: -40 },
      { x: 183, top: 20.8, bottom: 20.6, half: 22.2, e: 2.1, sd: 1.2, ct: 1.6, cb: 1.5, at: 40, ab: -40 },
      // nose: crease ring at 186, a short collar, a second crease at 195.5 and a full, rounded cap
      // (listing close-ups; the cap is fuller than a straight cone)
      { x: 185.8, top: 20.4, bottom: 20, half: 21.2, e: 2.1, sd: 1.2, ct: 2.2, cb: 1.8, at: 40, ab: -40, sharp: true },
      { x: 186.2, top: 19.3, bottom: 19.1, half: 19.9, e: 2.05, sd: 0.4, ct: 0, cb: 0, sharp: true },
      { x: 190, top: 18.7, bottom: 18.4, half: 18.9, e: 2.0, sd: 0.3 },
      { x: 193, top: 17.9, bottom: 17.6, half: 18, e: 2.0, sd: 0.25 },
      { x: 195.5, top: 16.8, bottom: 16.5, half: 16.8, e: 2.0, sd: 0.2, sharp: true },
      { x: 199, top: 14.2, bottom: 14, half: 14.1, e: 2.0 },
      { x: 202.3, top: 11.4, bottom: 11.3, half: 11.4, e: 2.0, sharp: true },
      { x: 203, top: 10.6, bottom: 10.6, half: 10.6, e: 2.0, sharp: true },
    ],
    customParts: [],
  };
}
