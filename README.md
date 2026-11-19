# ☢ Nuclear

Digital twin, visualizer and simulator for the **JENABOM TY-0101 3.6 V cordless screwdriver**
(Amazon B0B9XMJ335), built from the team's teardown, the retail box and the product listing.

**Live:** https://jevgome.github.io/nuclear/

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # physics checks (81:1, 220 rpm, 3 N·m, kinematics, …)
npm run build      # typecheck + production bundle in dist/
```

## What it does

- **3D model:**
  - **Shell:** the side profile is traced from the Amazon listing photos.
  - **Controls:** the trigger, F/R push-through button and PUSH swivel release sit where they are on
    the real tool. The LED headlamp is in the chin; the pilot lamp and Micro-USB are at the butt.
  - **Surface detail:** grooves, ribbed back panel, glossy logo and label plates, screw heads,
    lanyard hole.
  - **Internals:** 18650 cell, charge PCB, trigger switch, swivel collar, RS-380SA motor (magnets,
    3-pole armature), translucent gearbox with molded rings, suns, planets, carriers, magnetic hex
    chuck, and all 6 listed bits.
  - **Rendering:** studio lighting, ambient occlusion and soft shadows, with a white or dark backdrop.
- **Views:** Solid / X-ray (ghosted shell and housing) / Ghost (everything translucent), an animated
  **exploded view**, a **section cut** on the parting plane, and the **swivel head** animation
  (180° turn on the diagonal seam, two locked positions).
- **Inspector:** click any part to see what it is, its dimensions, the source of the data and a
  confidence badge.
- **Simulator:** a DC-motor model calibrated so the stock 81:1 gearbox reproduces the box
  (220 rpm, 3 N·m at 3.6 V). It offers fixed 3.6 V or a battery model (SoC, Micro-USB charging),
  and these loads: free run, constant torque, the team's **6-inch beam stall test**, or driving a
  wood screw. Live readouts show speed, torque, current and power, along with a torque–speed chart,
  a 10 s history and Lewis tooth stress with safety factors.
- **Gearbox editor:** add, remove or reorder stages and edit sun/ring/planet teeth, planet count,
  module, face width, efficiency and material (POM, PA66, PLA, PETG, steel). It checks the geometry
  (meshing, equal spacing, planet collisions, undercut) and the axial space in the housing, with an
  option to extend the head shell. The 3D model, X-ray and simulation update live.
- **Custom parts:** add boxes, cylinders, tubes, spheres or gears, or import **STL/OBJ/GLB**. Attach
  each to the handle, the head (swivels with it) or the spindle (spins with the output).
- **Video export (View tab):**
  - **Output:** an MP4 at 720p–4K and 30–240 fps, rendered offline frame by frame at a fixed simulation step, so it's perfectly smooth regardless of live performance.
  - **Options:** slow motion (sim speed ½–1/10×), motor forward/reverse/off, head swivel, explode-and-reassemble, camera orbit, high-quality ambient occlusion and shadows, and burned-in rpm/torque readouts.
  - **Browser:** needs WebCodecs (Chrome or Edge).
- **Performance:**
  - The live view redraws only when something changes, and adds ambient occlusion once still.
  - Parts fully enclosed by the shell aren't drawn in Solid view.
  - Resolution drops automatically while the motor runs if frames get slow.
- **Specs:** every number is editable live, with its source and confidence. Changes are saved in the
  browser and can be exported or imported as JSON.

Keys: `F`/`↑` forward · `R`/`↓` reverse (hold) · `T` trigger · `D` flip F/R · `Space` swivel · `E` explode · `X` render mode.

## Changing values

All defaults live in **`src/config/screwdriver.ts`**. Each value is a `Param` with `value`, `unit`,
`source` and `confidence`. Edit them there, or live in the app's **Specs** tab. Anything not
confirmed is listed in **[UNCERTAINTIES.md](UNCERTAINTIES.md)**.

## Layout

```
src/config/      spec (single source of truth), types, persistence
src/physics/     gears (ratio, validation, kinematics, Lewis), motor, battery, simulator + tests
src/geometry/    involute gear / ring profiles, swept shell halves split at the swivel seam, procedural surface textures
src/scene/       Three.js model builder (parts, explode vectors, kinematics) and viewer
src/ui/          app controller, panels, charts
```

Coordinates are millimetres in the straight configuration: X runs from the butt (0) to the nose
(203), +Y is the trigger side (the head bends toward it), and Z is perpendicular to the shell
parting plane. −Z is the logo side.

## Deployment

Every push to `main` runs `.github/workflows/deploy.yml`, which installs dependencies, runs the
tests, builds the app and publishes `dist/` to GitHub Pages. One-time setup: in the repo go to
**Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.

The build uses a relative base path (`vite.config.ts`), so it works under any sub-path.
