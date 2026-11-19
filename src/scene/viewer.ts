import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Part, ScrewdriverModel } from './model';

export type RenderMode = 'solid' | 'xray' | 'ghost';

interface MatState {
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
  wireframe: boolean;
}

export class Viewer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  mode: RenderMode = 'solid';
  background: 'studio' | 'dark' = 'studio';
  composer: EffectComposer;
  private ao: GTAOPass;
  private floor: THREE.Mesh;
  private grid: THREE.GridHelper;
  private floorY = -150;
  section = { enabled: false, offset: 0 };
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private ray = new THREE.Raycaster();
  private down = new THREE.Vector2();
  selected: string | null = null;
  hovered: string | null = null;
  onSelect: (id: string | null) => void = () => {};
  onHover: (id: string | null, x: number, y: number) => void = () => {};
  private origMats = new WeakMap<THREE.Material, MatState>();
  /* ---- on-demand rendering ---- */
  private needsRender = true;
  private hqDone = false;
  private lastChange = 0;
  private pendingHover: PointerEvent | null = null;
  private dragging = false;
  /** Ambient occlusion pass, added once the view has been still for a moment. */
  hqEnabled = true;

  constructor(private host: HTMLElement, public model: ScrewdriverModel) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));
    // shadows are re-rendered only when the model moves (see render())
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    host.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
    this.scene.environmentIntensity = 0.9;

    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 6000);
    this.camera.position.set(-140, 90, 330);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);

    // softbox-style studio lighting (product-photo look)
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-160, 320, 260);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 5;
    key.shadow.blurSamples = 8;
    const sc = key.shadow.camera as THREE.OrthographicCamera;
    sc.left = sc.bottom = -260; sc.right = sc.top = 260; sc.near = 10; sc.far = 1200;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.6;
    const fill = new THREE.DirectionalLight(0xe8eeff, 0.7);
    fill.position.set(300, 120, -120);
    const rim = new THREE.DirectionalLight(0xffffff, 1.4);
    rim.position.set(60, 200, -320);
    this.scene.add(key, fill, rim, new THREE.HemisphereLight(0xffffff, 0x404044, 0.35));

    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.ShadowMaterial({ opacity: 0.18 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
    this.grid = new THREE.GridHelper(1000, 100, 0x2a2f3a, 0x1b1f27);
    this.scene.add(this.grid);
    this.setFloor(this.floorY);
    this.setBackground('studio');

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = new GTAOPass(this.scene, this.camera, 1, 1);
    this.ao.updateGtaoMaterial({ radius: 6, distanceExponent: 1, thickness: 3, scale: 1.2, samples: 8 });
    this.ao.blendIntensity = 0.85;
    this.composer.addPass(this.ao);
    this.composer.addPass(new OutputPass());

    this.scene.add(model.display);
    let saved: string | null = null;
    try { saved = localStorage.getItem('nuclear.quality'); } catch { /* ignore */ }
    if (saved === 'balanced' || saved === 'fast') queueMicrotask(() => this.setQuality(saved as 'balanced' | 'fast'));

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => { this.down.set(e.clientX, e.clientY); this.dragging = true; });
    el.addEventListener('pointerup', (e) => {
      this.dragging = false;
      if (this.down.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 4) return;
      const id = this.pick(e);
      this.select(id);
    });
    // hover picking is coalesced to at most once per frame and skipped while orbiting
    el.addEventListener('pointermove', (e) => { this.pendingHover = e; });
    el.addEventListener('pointerleave', () => { this.pendingHover = null; this.onHover(null, 0, 0); });
    this.controls.addEventListener('change', () => this.invalidate());
    new ResizeObserver(() => { this.resize(); this.invalidate(); }).observe(host);
    this.resize();
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  private pick(e: PointerEvent): string | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const hits = this.ray.intersectObject(this.model.root, true);
    for (const h of hits) {
      if (!h.object.visible) continue;
      const id = h.object.userData.partId as string | undefined;
      if (!id) continue;
      const part = this.model.partById(id);
      if (!part) continue;
      // see-through modes: skip ghosted shells
      if (this.mode !== 'solid' && part.role === 'shell') continue;
      if (this.section.enabled && this.plane.distanceToPoint(h.point) < 0) continue;
      return id;
    }
    return null;
  }

  select(id: string | null) {
    this.selected = id;
    this.applyHighlight();
    this.invalidate();
    this.onSelect(id);
  }

  frame(id?: string) {
    const target = id ? this.model.partById(id)?.obj : this.model.display;
    if (!target) return;
    const box = new THREE.Box3().setFromObject(target);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(c);
    this.camera.position.copy(c).addScaledVector(dir, Math.max(60, size * 2.1));
    this.invalidate();
  }

  setView(name: 'iso' | 'side' | 'top' | 'front') {
    const t = this.controls.target;
    const d = this.camera.position.distanceTo(t);
    const pos = { iso: [0.45, 0.35, 0.82], side: [0, 0, 1], top: [0, 1, 0.001], front: [1, 0.05, 0] }[name];
    this.camera.position.set(t.x + pos[0] * d, t.y + pos[1] * d, t.z + pos[2] * d);
    this.invalidate();
  }

  /* -------- render modes -------- */
  private remember(m: THREE.Material) {
    if (!this.origMats.has(m)) {
      const mm = m as THREE.MeshPhysicalMaterial;
      this.origMats.set(m, { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite, wireframe: !!mm.wireframe });
    }
    return this.origMats.get(m)!;
  }

  applyMode() {
    for (const p of this.model.parts) this.styleMaterials(p);
    this.renderer.clippingPlanes = this.section.enabled ? [this.plane] : [];
    this.plane.constant = this.section.offset;
    this.applyHighlight();
    this.invalidate(true);
  }
  /** Cheap update for the section slider: no material changes. */
  setSectionOffset(v: number) {
    this.section.offset = v;
    this.plane.constant = v;
    this.invalidate();
  }

  private styleMaterials(p: Part) {
    p.obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of ([] as THREE.Material[]).concat(mesh.material)) {
        const orig = this.remember(m);
        let opacity = orig.opacity, transparent = orig.transparent, depthWrite = orig.depthWrite;
        if (this.mode === 'xray') {
          if (p.role === 'shell') { opacity = 0.1; transparent = true; depthWrite = false; }
          if (p.role === 'housing') { opacity = Math.min(orig.opacity, 0.32); transparent = true; depthWrite = false; }
        } else if (this.mode === 'ghost') {
          opacity = p.role === 'shell' ? 0.06 : 0.38;
          transparent = true;
          depthWrite = false;
        }
        m.opacity = opacity;
        m.depthWrite = depthWrite;
        mesh.castShadow = this.mode === 'solid' || p.role !== 'shell';
        // recompiling shaders is expensive — only when the transparency flag actually flips
        if (m.transparent !== transparent) {
          m.transparent = transparent;
          m.needsUpdate = true;
        }
      }
    });
  }

  applyHighlight() {
    for (const p of this.model.parts) {
      const id = p.info.id;
      const color = id === this.selected ? 0x3d7ff0 : id === this.hovered ? 0x3d7ff0 : 0x000000;
      const intensity = id === this.selected ? 0.22 : id === this.hovered ? 0.1 : 0;
      p.obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const m of ([] as THREE.Material[]).concat(mesh.material)) {
          const pm = m as THREE.MeshPhysicalMaterial;
          if (!pm.emissive) continue;
          if (pm.userData.led && pm.emissiveIntensity > 1) continue; // lit LEDs keep their glow
          pm.emissive.setHex(color);
          pm.emissiveIntensity = intensity;
        }
      });
    }
  }

  setBackground(b: 'studio' | 'dark') {
    this.background = b;
    this.needsRender = true; this.hqDone = false;
    this.scene.background = new THREE.Color(b === 'studio' ? 0xf4f4f2 : 0x0f1115);
    (this.floor.material as THREE.ShadowMaterial).opacity = b === 'studio' ? 0.16 : 0.35;
    this.grid.visible = b === 'dark';
  }
  setFloor(y: number) {
    if (Math.abs(y - this.floorY) < 0.5) return;
    this.renderer.shadowMap.needsUpdate = true;
    this.floorY = y;
    this.floor.position.y = y;
    this.grid.position.y = y + 0.1;
  }
  /** Drop the floor just under the model's current lowest point. */
  fitFloor() {
    const box = new THREE.Box3().setFromObject(this.model.display);
    if (Number.isFinite(box.min.y)) this.setFloor(box.min.y - 2);
  }

  /* ---- dynamic resolution while animating ---- */
  private basePR = Math.min(1.5, window.devicePixelRatio || 1);
  motionScale = 1;
  private frameEma = 16;
  private lastAnimFrame = 0;
  private lastScaleChange = 0;
  /** Lower the render resolution while the model animates if frames run slow (> ~40 ms → < 25 fps budget). */
  private adaptResolution(now: number) {
    if (this.lastAnimFrame) this.frameEma = this.frameEma * 0.85 + Math.min(200, now - this.lastAnimFrame) * 0.15;
    this.lastAnimFrame = now;
    if (now - this.lastScaleChange < 400) return;
    let next = this.motionScale;
    if (this.frameEma > 21 && this.motionScale > 0.5) next = Math.max(0.5, this.motionScale - 0.15);
    else if (this.frameEma < 13 && this.motionScale < 1) next = Math.min(1, this.motionScale + 0.1);
    if (next !== this.motionScale) {
      this.motionScale = next;
      this.lastScaleChange = now;
      this.renderer.setPixelRatio(this.basePR * next);
      this.resize();
    }
  }

  quality: 'high' | 'balanced' | 'fast' = 'high';
  /** high: soft shadows + AO when still · balanced: shadows, no AO · fast: no shadows/AO, 1× pixels */
  setQuality(q: 'high' | 'balanced' | 'fast') {
    this.quality = q;
    this.hqEnabled = q === 'high';
    const dpr = window.devicePixelRatio || 1;
    this.basePR = q === 'high' ? Math.min(1.5, dpr) : q === 'balanced' ? Math.min(1.25, dpr) : 1;
    this.motionScale = 1;
    this.renderer.setPixelRatio(this.basePR);
    const shadows = q !== 'fast';
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) for (const mm of ([] as THREE.Material[]).concat(m)) mm.needsUpdate = true;
      });
    }
    this.resize();
    this.invalidate(true);
    try { localStorage.setItem('nuclear.quality', q); } catch { /* ignore */ }
  }

  /** Request a redraw. `shadows` also re-renders the shadow map (model moved). */
  invalidate(shadows = false) {
    this.needsRender = true;
    this.hqDone = false;
    this.lastChange = performance.now();
    if (shadows) this.renderer.shadowMap.needsUpdate = true;
  }

  private lastHoverPick = 0;
  private processHover() {
    const e = this.pendingHover;
    if (!e) return;
    const now = performance.now();
    if (now - this.lastHoverPick < 70) return; // ~14 Hz is plenty for hover highlighting
    this.lastHoverPick = now;
    this.pendingHover = null;
    if (this.dragging) return;
    const id = this.pick(e);
    if (id !== this.hovered) {
      this.hovered = id;
      this.applyHighlight();
      this.invalidate();
    }
    this.onHover(id, e.clientX, e.clientY);
  }

  /**
   * Called every animation frame. Draws only when something changed:
   * fast frames (no AO) while moving, then one ambient-occlusion frame once still.
   * @param animating true while the model itself is moving (motor, swivel, explode…)
   */
  render(animating = false, moveShadows = false) {
    this.processHover();
    if (this.controls.update()) this.invalidate();
    const now = performance.now();
    if (animating) {
      if (moveShadows) this.renderer.shadowMap.needsUpdate = true;
      this.adaptResolution(now);
      this.lastChange = now;
      this.hqDone = false;
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
      return;
    }
    this.lastAnimFrame = 0;
    if (this.motionScale < 1) {
      // motion stopped: back to full resolution
      this.motionScale = 1;
      this.renderer.setPixelRatio(this.basePR);
      this.resize();
      this.needsRender = true;
    }
    if (this.needsRender) {
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
      return;
    }
    const useAO = this.hqEnabled && this.mode === 'solid' && !this.section.enabled;
    if (!this.hqDone && now - this.lastChange > 220) {
      this.hqDone = true;
      if (useAO) {
        this.renderer.shadowMap.needsUpdate = true;
        this.composer.render();
      }
    }
  }

  screenshot(): string {
    this.renderer.shadowMap.needsUpdate = true;
    if (this.hqEnabled && this.mode === 'solid' && !this.section.enabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}
