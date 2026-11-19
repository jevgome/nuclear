# Nuclear: uncertainty register

Every value in Nuclear has a confidence tag (shown as coloured badges and dots in the app, and in
`src/config/screwdriver.ts`). This file lists everything that is **not** confirmed, ordered by
impact. Each one can be changed in one place: the **Specs** tab in the app, or
`src/config/screwdriver.ts`.

Sources: **BOX** = retail box photos · **OWNER** = project owner's answers · **DOC** = team report ·
**TEARDOWN** = the scale-calibrated teardown photo in DOC (the 65 mm 18650 cell is the scale reference) ·
**LISTING** = Amazon B0B9XMJ335.

## Needs verification on the physical unit

| # | Item | Current value | Why it's uncertain | How to verify |
|---|------|---------------|--------------------|---------------|
| 1 | **Planet tooth count** | 19 (DOC notebook) | With sun 6 and ring 48 (OWNER), standard gears need planet = (48−6)/2 = **21**. With 19, the sun would need a +2.0·m profile shift; the 3D view shows the resulting gap. **The 81:1 ratio is unaffected.** | Recount the planet teeth. If it's 21, use "Snap planet to standard" in the Gearbox tab. |
| 2 | **Shell width (Z)** | Grip 31 mm, barrel 42 mm, joint ≈36 mm | The listing has only side and ¾ views, and the teardown shows halves lying flat. Widths are sized to fit the 18 mm cell and the 37 mm gearbox with 2 mm walls. | Calipers across the grip and barrel at 3–4 stations. Edit Specs → Shell side profile → half-w. |
| 3 | **Swivel collar / socket** | R 16 mm, 6 mm deep | Not visible in any photo. Something like it must exist: the motor end-cap (x = 115 mm, TEARDOWN) crosses the 36° seam plane at its lower edge. | Open the joint. |
| 4 | **Pilot lamp colour** | Red while charging, green when full (LISTING) | The teardown LED looks red-tinted, so it may be single-colour on this unit. | Charge the tool to full and look. |
| 5 | **Housing nose taper** | Full Ø until 181 mm, nose from 187 mm | The teardown gives ≈192 mm, but the listing nose cone (traced) is too narrow there. | Measure the housing. |

## Resolved from the Amazon listing (2nd pass)

- **Controls and where they sit** (traced from the listing photos at 4.72 px/mm):
  - **Trigger ("Switch Button"):** red paddle on the grip front, 54–86 mm.
  - **F/R button ("Positive and Negative Switch"):** red push-through pill at 87–94 mm, visible on both sides.
  - **PUSH swivel release ("Rotary Switch"):** on top of the head just ahead of the seam, with the ⟳ icon.
  - **Pilot lamp:** front of the butt hook. **Micro-USB:** butt end face.
  - **LED headlamp:** in a chin under the barrel, 163–178 mm.
- **Internal orientation** (matches the teardown): the cell runs along the back of the grip, and the trigger switch and charge PCB sit on the trigger side.
- **Swivel:** the bend is 72°. It's measured directly in the pistol photos, and the seam measures 36°, which gives the same answer. The listing text's "ninety degrees" is not borne out by its photos.
- **Length:** 21.5 cm straight including the chuck (listing), so the body is 203 mm.
- **Bits:** PH1, PH2, slotted 5 and 6, and 3.0 and 2.0 mm hex-shank twist drills (listing photo). Drill lengths are estimated from photo proportions.

## Shell surface (from listing close-ups)

- **Cross-section:** a near-round superellipse body (the tool is essentially cylindrical) cut by flat planes:
  - a flat **side panel** (`sd`), where the logo and label plates sit;
  - an **upper chamfer** facet (`ct`, angle `at`), forming the long barrel crease;
  - a **lower chamfer** facet (`cb`, angle `ab`).
- **Sampling:** sample points cluster at every crease so edges render crisp. Each station in `screwdriver.ts` carries its own values.
- **Facet depth is limited by the internals.** `src/geometry/clearance.test.ts` checks that the inner wall clears the motor can, mount ring, gearbox housing and 18650 cell at every station.
  - Near the nose (≈165–183 mm) only ≈1.5 mm remains above the housing, so facets there are shallow.
  - To fit, the barrel there is about 47 mm wide (assumed).
- **Nose:** a round cone with a hard step at the shoulder (186 mm) and a break at 196.5 mm. The butt end face is flat.
- **Accuracy:** facet depths and angles are read by eye from the photos (±1 mm). Widths are still assumed (no top view).
- **Raised relief is real geometry** (`src/geometry/relief.ts`, flat-shaded swept ribs that follow the shell surface):
  - **Barrel:** glossy raised logo/label plate with chamfered walls; raised frame around the plate; upper and lower ledges; 6 stepped slats on the lower flank; 6 short ribs across the top.
  - **Grip:** front slats that wrap over the front face and stop at the trigger slot; raised frame band on each side; back-insert lip and diagonal ribs.
- **Relief sources and accuracy:** positions and counts come from the 8 listing images and the listing's product video. The top ribs are visible in the video and the 47-piece render. Rib heights (0.5–0.9 mm) and widths are estimated (±0.5 mm).
- **Still painted, not modelled:** the back-insert parting groove, the ⟳ icon and screw heads.

## Engineering assumptions (reasonable, but not measured)

| Item | Value | Notes |
|------|-------|-------|
| Box "Max torque 3 N·m" | Treated as **output stall torque at 3.6 V** | Calibration anchor (OWNER: use box values). |
| Stage efficiency | 0.90 per stage (0.81 total) | Typical plastic planetary. Changes the motor stall torque backed out of the 3 N·m rating. |
| Motor no-load current I₀ | 0.5 A | With the box values this gives Ke ≈ 1.89 mV·s/rad, loop R ≈ 146 mΩ, stall current ≈ 24.7 A. |
| Rotor inertia | 2.5×10⁻⁶ kg·m² | Only affects spin-up time (~0.1 s). |
| Release behaviour | Motor **coasts** (no electronic brake) | Not confirmed whether the switch shorts the motor in neutral. |
| Switch type | DPDT polarity reversal | Inferred from the two-direction rocker; internals not inspected. |
| Li-ion OCV curve | Generic NMC/LCO curve | Cell datasheet unknown. |
| Cell internal R / cutoff | 50 mΩ / 3.0 V | No protection IC identified on the PCB. |
| Charge current / charger IC | 0.5 A / unidentified | Listing says Micro-USB. Charge time is not specified reliably (sources say 2–5 h). |
| Gear material | POM (acetal), ivory | Visual identification only. Used for the Lewis stress allowable (40 MPa, textbook). |
| Module | 0.667 | Derived: planet OD 14 mm (DOC) ÷ (19 + 2). Would be ≈0.61 if planets are 21T. |
| Carrier plate thickness, stage gap, spindle bearing length | 2 mm, 1.5 mm, 10 mm | Set the axial-space budget for adding stages. The stock pair leaves 3.5 mm spare. |
| Housing OD | 36.9 mm drawn (36 mm measured) | Auto-enlarged so the ring's tooth root has a wall. |
| Spindle socket depth | 12 mm | Not measured. |
| Shell wall thickness | 2 mm | DOC left "Width of material:" blank. |
| Surface detail | Grooves, ribs, plates, screw holes, ⟳ icon placed from photos | Positions ±2 mm; groove counts approximate. Logo is a stylised stand-in. |
| F/R neutral/lock position | None (two states) | Unknown whether the push-through button has a centre lock. |
| Wire routing | Approximate | Colours from the photo; paths not traced. |
| Wood-screw load scenario | Illustrative numbers | Not measured; it shows behaviour only. |

## Known discrepancies between sources

| Quantity | BOX | LISTING | DOC (measured) | Used |
|----------|-----|---------|----------------|------|
| Max torque | 3 N·m | 3.5 N·m | 1.64 N·m (6 in beam) | **3 N·m (box)**; others shown as reference lines |
| No-load speed | 220 rpm | 250 rpm (some mirrors) | not measured | **220 rpm (box)** |
| Battery | 3.6 V | 3.6 V, 1300 mAh (some variants) | cell printed 1500 mAh | **1500 mAh** |

Note: the battery model reproduces 220 rpm at 3.6 V (≈27 % SoC) and gives ≈237 rpm on a full 4.18 V
cell, which may explain the 250 rpm listing figure. The measured 1.64 N·m is consistent with a partly
discharged cell, battery/switch sag at ~25 A stall current, or the beam test detecting slip before
true stall. These are hypotheses, not verified.

## Not modelled

- Internal screw bosses (the screw heads are drawn as surface detail at the visible positions)
- Bit wobble or spindle misalignment noted in DOC
- The 5 other bits (types unconfirmed)
- Thermal behaviour of motor and gears
