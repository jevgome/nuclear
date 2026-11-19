import { defaultSpec, STOCK_STAGE, type ScrewdriverSpec } from '../config/screwdriver';
import { clearSaved, download, loadSpec, mergeSpec, saveSpec } from '../config/store';
import type { CustomPart, MaterialKey, Param, StageSpec } from '../config/types';
import { socAt } from '../physics/battery';
import {
  MATERIALS, stageLoads, stageRatio, totalEfficiency, totalRatio, validateStage,
} from '../physics/gears';
import { radSToRpm } from '../physics/motor';
import { G, outputCurve, Simulator, type LoadMode } from '../physics/sim';
import { BIT_TYPES, ScrewdriverModel, type BitType, type PartGroup } from '../scene/model';
import { Viewer, type RenderMode } from '../scene/viewer';
import { drawChart } from './chart';
import {
  checkbox, conf, CONF_HELP, CONF_LABEL, h, hint, iconBtn, numInput, prop, section, sectionEx, seg, select, stat,
} from './dom';
import { exportSupported, exportVideo, type ExportOptions } from './exporter';
import { icon } from './icons';

type Tab = 'model' | 'sim' | 'gear' | 'parts' | 'specs' | 'render';
const TABS: { id: Tab; icon: string; title: string }[] = [
  { id: 'model', icon: 'layers', title: 'Model' },
  { id: 'sim', icon: 'sim', title: 'Simulation' },
  { id: 'gear', icon: 'gear', title: 'Gearbox' },
  { id: 'parts', icon: 'parts', title: 'Custom parts' },
  { id: 'specs', icon: 'specs', title: 'Specifications' },
  { id: 'render', icon: 'render', title: 'Render' },
];

const SPEC_GROUPS: [keyof ScrewdriverSpec, string][] = [
  ['rated', 'Ratings'], ['motor', 'Motor · RS-380SA'], ['battery', 'Battery · 18650'], ['electrical', 'Electrical'],
  ['gearbox', 'Gearbox layout'], ['spindle', 'Spindle'], ['body', 'Body'], ['controls', 'Controls & features'], ['bit', 'Bit'],
];

const C = {
  accent: '#4f8ef7', amber: '#d6a23a', red: '#e5534b', green: '#46b37b', grid: '#6b7079',
};

export class App {
  spec: ScrewdriverSpec = loadSpec();
  model = new ScrewdriverModel();
  viewer: Viewer;
  sim: Simulator;
  opts: { extendShell: boolean; showBit: boolean; bit: BitType } = { extendShell: true, showBit: true, bit: 'PH2' };
  direction: 1 | -1 = 1;
  triggerHeld = false;
  /** true while the video exporter owns the renderer */
  paused = false;
  exportOpts: ExportOptions = {
    width: 1920, height: 1080, fps: 60, duration: 6, simSpeed: 1, hq: true,
    run: 'forward', swivel: false, explode: false, orbit: 0, overlay: true,
  };
  private exportAbort: AbortController | null = null;
  tab: Tab = 'model';
  headTarget = 1; // listing hero shots show pistol mode
  explodeTarget = 0;
  explodeAnimating = false;
  lockTrigger = false;
  isolate = false;
  private rebuildTimer = 0;
  private last = performance.now();
  private history: { t: number; rpm: number; torque: number; current: number }[] = [];
  private uiTick = 0;
  private lastSig = '';
  private lastMotorAngle = NaN;
  private floorDirty = true;
  private frameTimes: number[] = [];

  // DOM
  panelH = document.getElementById('panel-h')!;
  panelB = document.getElementById('panel-b')!;
  inspector = document.getElementById('inspector')!;
  rail = document.getElementById('rail')!;
  toolbar = document.getElementById('vtoolbar')!;
  statusbar = document.getElementById('statusbar')!;
  tip = document.getElementById('tip')!;
  private readoutEls: Record<string, HTMLElement> = {};
  private sbEls: Record<string, HTMLElement> = {};
  private chartTS?: HTMLCanvasElement;
  private chartHist?: HTMLCanvasElement;
  private stressEl?: HTMLElement;

  constructor() {
    this.model.headAngle = this.headTarget;
    this.viewer = new Viewer(document.getElementById('stage')!, this.model);
    this.sim = new Simulator(this.spec);
    this.viewer.onSelect = (id) => { this.renderInspector(id); this.syncTreeSelection(); };
    this.viewer.onHover = (id, x, y) => {
      if (!id) { this.tip.hidden = true; return; }
      const p = this.model.partById(id);
      this.tip.hidden = false;
      this.tip.textContent = p?.info.name ?? id;
      const r = (this.tip.parentElement as HTMLElement).getBoundingClientRect();
      this.tip.style.left = `${x - r.left + 14}px`;
      this.tip.style.top = `${y - r.top + 14}px`;
    };
    this.rebuild(true);
    this.viewer.setView('iso');
    this.viewer.frame();
    this.renderActions();
    this.renderRail();
    this.renderPanel();
    this.renderToolbar();
    this.renderStatusbar();
    this.renderInspector(null);
    this.bindKeys();
    requestAnimationFrame(this.loop);
  }

  /* ================================================================ */
  rebuild(initial = false) {
    void this.model.build(this.spec, this.opts).then(() => this.viewer.applyMode());
    this.viewer.applyMode();
    this.lastSig = '';
    this.floorDirty = true;
    this.sim.rebuild(this.spec);
    if (this.isolate && this.viewer.selected) this.applyIsolate();
    if (!initial) saveSpec(this.spec);
    this.renderStatus();
  }
  scheduleRebuild(rerenderPanel = true) {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuild();
      if (rerenderPanel) this.renderPanel();
      if (this.viewer.selected) this.renderInspector(this.viewer.selected);
    }, 120);
  }

  loop = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.frameTimes.push(now - this.last);
    if (this.frameTimes.length > 30) this.frameTimes.shift();
    this.last = now;
    if (this.paused) { requestAnimationFrame(this.loop); return; }
    const k = 1 - Math.exp(-dt * 3.2);
    const ha = this.model.headAngle + (this.headTarget - this.model.headAngle) * k;
    this.model.headAngle = Math.abs(ha - this.headTarget) < 1e-3 ? this.headTarget : ha;
    if (this.explodeAnimating) {
      const ex = this.model.explode + (this.explodeTarget - this.model.explode) * k;
      this.model.explode = Math.abs(ex - this.explodeTarget) < 1e-3 ? this.explodeTarget : ex;
      if (this.model.explode === this.explodeTarget) this.explodeAnimating = false;
      const sl = document.getElementById('explode-slider') as HTMLInputElement | null;
      if (sl) sl.value = String(this.model.explode);
    }
    const swivelling = this.model.headAngle !== this.headTarget;
    this.sim.step(dt);
    const st = this.sim.st;
    this.model.triggerPressed = st.trigger !== 0;
    this.model.direction = this.direction;
    const pilot = st.charging ? (st.soc < 0.999 ? 'red' : 'green') : 'off';
    const white = st.trigger !== 0 && !st.dead;
    // interior parts can't be seen in a closed solid view → don't draw them
    this.model.occlude = this.viewer.mode === 'solid' && !this.viewer.section.enabled && this.model.explode < 0.004 && !this.isolate;
    const sig = `${this.model.headAngle}|${this.model.explode}|${st.trigger}|${this.direction}|${white}|${pilot}|${this.model.showWires}|${this.model.occlude}|${this.model.isolateId}`;
    const poseChanged = sig !== this.lastSig;
    const spinning = st.motorAngle !== this.lastMotorAngle;
    if (poseChanged || spinning) {
      this.model.applyLayout();
      this.model.updateKinematics(st.motorAngle, this.sim.outputAngle());
      this.model.setLeds(white, pilot);
    }
    if (poseChanged) {
      this.viewer.invalidate(true);
      this.floorDirty = true;
    }
    this.lastSig = sig;
    this.lastMotorAngle = st.motorAngle;
    this.viewer.render(spinning || swivelling || this.explodeAnimating, swivelling || this.explodeAnimating);
    this.uiTick += dt;
    if (this.uiTick > 1 / 15) {
      this.uiTick = 0;
      if (this.floorDirty) { this.floorDirty = false; this.viewer.fitFloor(); }
      this.history.push({ t: st.time, rpm: Math.abs(this.sim.outputRpm()), torque: Math.abs(st.outputTorque), current: Math.abs(st.current) });
      while (this.history.length && st.time - this.history[0].t > 10 * this.sim.timeScale) this.history.shift();
      this.updateReadouts();
      this.updateStatusbar(swivelling);
    }
    requestAnimationFrame(this.loop);
  };

  /* ================================================================ */
  private bindKeys() {
    const isField = (e: KeyboardEvent) => (e.target as HTMLElement).closest('input,select,textarea');
    window.addEventListener('keydown', (e) => {
      if (isField(e) || e.repeat) return;
      if (e.key === 'f' || e.key === 'ArrowUp') { this.setDirection(1); this.setTrigger(true); }
      else if (e.key === 'r' || e.key === 'ArrowDown') { this.setDirection(-1); this.setTrigger(true); }
      else if (e.key === 't' || e.key === 'Enter') this.setTrigger(true);
      else if (e.key === 'd') this.setDirection(this.direction > 0 ? -1 : 1);
      else if (e.key === ' ') { e.preventDefault(); this.toggleHead(); }
      else if (e.key === 'e') this.toggleExplode();
      else if (e.key === 'x') this.cycleMode();
      else if (e.key === 'Escape') this.viewer.select(null);
    });
    window.addEventListener('keyup', (e) => {
      if (isField(e)) return;
      if (['f', 'r', 't', 'Enter', 'ArrowUp', 'ArrowDown'].includes(e.key) && !this.lockTrigger) this.setTrigger(false);
    });
  }
  /** Trigger (momentary). Direction comes from the F/R button, as on the real tool. */
  setTrigger(on: boolean) {
    this.triggerHeld = on;
    this.sim.st.trigger = on ? this.direction : 0;
  }
  setDirection(d: 1 | -1) {
    this.direction = d;
    if (this.triggerHeld) this.sim.st.trigger = d;
    this.renderPanelIfTab('sim');
  }
  toggleHead() {
    this.headTarget = this.headTarget > 0.5 ? 0 : 1;
    this.renderToolbar();
  }
  toggleExplode() {
    this.explodeTarget = this.explodeTarget > 0.5 ? 0 : 1;
    this.explodeAnimating = true;
    this.renderToolbar();
  }
  setMode(m: RenderMode) {
    this.viewer.mode = m;
    this.viewer.applyMode();
    this.renderToolbar();
  }
  cycleMode() {
    const order: RenderMode[] = ['solid', 'xray', 'ghost'];
    this.setMode(order[(order.indexOf(this.viewer.mode) + 1) % 3]);
  }
  renderPanelIfTab(t: Tab) {
    if (this.tab === t) this.renderPanel();
  }

  /* ================================================================ */
  /*  Chrome: title bar, rail, viewport toolbar, status bar               */
  /* ================================================================ */
  renderStatus() {
    const d = this.sim.d;
    const curve = outputCurve(d, this.spec.rated.voltage.value, 2);
    const custom = this.spec.stages.some((s) => !s.stock) || this.spec.stages.length !== 2 || this.spec.customParts.length > 0;
    const item = (l: string, v: string, cls = '') => h('div', { class: `tb-stat ${cls}` }, h('span', {}, l), h('b', {}, v));
    document.getElementById('status')!.replaceChildren(
      item('Ratio', fmtRatio(totalRatio(this.spec.stages))),
      item('No-load', `${curve[curve.length - 1].rpm.toFixed(0)} rpm`),
      item('Stall', `${curve[0].torque.toFixed(2)} N·m`),
      item('Config', custom ? 'Modified' : 'Stock', custom ? 'mod' : ''),
    );
  }

  private renderActions() {
    document.getElementById('actions')!.replaceChildren(
      iconBtn('camera', 'Save screenshot (PNG)', () => download('nuclear.png', this.viewer.screenshot()), { label: 'Screenshot' }),
      iconBtn('render', 'Export a video', () => { this.tab = 'render'; this.renderRail(); this.renderPanel(); }, { label: 'Export video', cls: 'primary' }),
    );
  }

  renderRail() {
    this.rail.replaceChildren(
      ...TABS.map((t) => {
        const b = iconBtn(t.icon, t.title, () => { this.tab = t.id; this.renderRail(); this.renderPanel(); }, { active: this.tab === t.id });
        b.classList.add('rail-btn');
        return b;
      }),
    );
  }

  renderToolbar() {
    const v = this.viewer;
    const grp = (...els: Node[]) => h('div', { class: 'tb-grp' }, ...els);
    this.toolbar.replaceChildren(
      grp(
        iconBtn('solid', 'Shaded (X cycles)', () => this.setMode('solid'), { active: v.mode === 'solid' }),
        iconBtn('xray', 'X-ray — see-through shell', () => this.setMode('xray'), { active: v.mode === 'xray' }),
        iconBtn('ghost', 'Ghost — everything translucent', () => this.setMode('ghost'), { active: v.mode === 'ghost' }),
      ),
      grp(
        iconBtn('iso', 'Isometric view', () => v.setView('iso')),
        iconBtn('front', 'Front view', () => v.setView('front')),
        iconBtn('side', 'Side view', () => v.setView('side')),
        iconBtn('top', 'Top view', () => v.setView('top')),
        iconBtn('fit', 'Fit to view', () => v.frame()),
      ),
      grp(
        iconBtn('explode', 'Exploded view (E)', () => this.toggleExplode(), { active: this.explodeTarget > 0.5 }),
        iconBtn('section', 'Section cut on the parting plane', () => { v.section.enabled = !v.section.enabled; v.applyMode(); this.renderToolbar(); this.renderPanelIfTab('model'); }, { active: v.section.enabled }),
        iconBtn('swivel', this.headTarget > 0.5 ? 'Swivel head to straight (Space)' : 'Swivel head to pistol (Space)', () => this.toggleHead(), { label: this.headTarget > 0.5 ? 'Pistol' : 'Straight' }),
      ),
    );
  }

  private renderStatusbar() {
    const s = this.sbEls;
    const cell = (k: string, title?: string) => { const e = h('span', { class: 'sb-cell', title }); s[k] = e; return e; };
    this.statusbar.replaceChildren(
      h('div', { class: 'sb-l' }, cell('state'), cell('rpm', 'Output speed'), cell('torque', 'Output torque'), cell('current', 'Motor current'), cell('volt', 'Supply voltage')),
      h('div', { class: 'sb-r' }, cell('sel'), cell('view'), cell('fps', 'Display frame rate')),
    );
    this.updateStatusbar(false);
  }

  private updateStatusbar(swivelling: boolean) {
    const s = this.sbEls, st = this.sim.st;
    if (!s.state) return;
    const state = st.stalled ? 'Stalled' : st.trigger > 0 ? 'Forward' : st.trigger < 0 ? 'Reverse' : swivelling ? 'Swivelling' : 'Idle';
    s.state.className = `sb-cell state ${st.stalled ? 'bad' : st.trigger ? 'run' : ''}`;
    s.state.textContent = state;
    s.rpm.textContent = `${Math.abs(this.sim.outputRpm()).toFixed(0)} rpm`;
    s.torque.textContent = `${Math.abs(st.outputTorque).toFixed(2)} N·m`;
    s.current.textContent = `${Math.abs(st.current).toFixed(2)} A`;
    s.volt.textContent = `${this.sim.supplyVoltage().toFixed(2)} V`;
    const sel = this.viewer.selected ? this.model.partById(this.viewer.selected)?.info.name ?? '' : '';
    s.sel.textContent = sel;
    s.view.textContent = `${{ solid: 'Shaded', xray: 'X-ray', ghost: 'Ghost' }[this.viewer.mode]} · ${this.viewer.quality[0].toUpperCase()}${this.viewer.quality.slice(1)}`;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / Math.max(1, this.frameTimes.length);
    s.fps.textContent = `${Math.round(1000 / Math.max(1, avg))} fps`;
  }

  /* ================================================================ */
  renderPanel() {
    this.readoutEls = {};
    this.chartTS = this.chartHist = undefined;
    this.stressEl = undefined;
    const t = TABS.find((x) => x.id === this.tab)!;
    this.panelH.replaceChildren(h('span', {}, t.title));
    const body =
      this.tab === 'model' ? this.modelTab()
        : this.tab === 'sim' ? this.simTab()
          : this.tab === 'gear' ? this.gearTab()
            : this.tab === 'parts' ? this.partsTab()
              : this.tab === 'specs' ? this.specsTab()
                : this.renderTab();
    this.panelB.replaceChildren(body);
    this.updateReadouts();
  }

  /* ---------------- MODEL ---------------- */
  private modelTab() {
    const v = this.viewer;
    const groups = new Map<PartGroup, typeof this.model.parts>();
    for (const p of this.model.parts) {
      if (p.wire) continue;
      if (!groups.has(p.info.group)) groups.set(p.info.group, []);
      groups.get(p.info.group)!.push(p);
    }
    const tree = h('div', { class: 'tree', role: 'tree' },
      [...groups.entries()].map(([g, ps]) =>
        h('details', { class: 'tree-g', open: g !== 'Gearbox' && g !== 'Motor' },
          h('summary', {}, icon('chevron', 12), h('span', {}, g), h('span', { class: 'count' }, String(ps.length))),
          ps.map((p) => h('div', {
            class: `tree-i${v.selected === p.info.id ? ' sel' : ''}`, 'data-id': p.info.id, role: 'treeitem',
            onclick: () => { v.select(p.info.id); v.frame(p.info.id); },
          }, h('span', { class: 'tree-n' }, p.info.name), conf(p.info.confidence, false))),
        ),
      ),
    );
    const slider = h('input', { id: 'explode-slider', type: 'range', min: '0', max: '1', step: '0.01', value: String(this.model.explode) });
    slider.addEventListener('input', () => {
      this.explodeAnimating = false;
      this.model.explode = this.explodeTarget = parseFloat(slider.value);
    });
    const secPos = h('input', { type: 'range', min: '-30', max: '30', step: '0.5', value: String(v.section.offset), disabled: !v.section.enabled });
    secPos.addEventListener('input', () => v.setSectionOffset(parseFloat(secPos.value)));
    const bitSel = select(BIT_TYPES.map((b) => [b.id, b.name] as [BitType, string]), this.opts.bit, (b) => { this.opts.bit = b; this.rebuild(); });

    return h('div', {},
      section('Browser', tree),
      section('Display',
        prop('Explode', slider),
        prop('Section offset', secPos, 'Enable the section cut from the viewport toolbar'),
        prop('Bit', bitSel),
        prop('', checkbox(this.opts.showBit, 'Show bit', (c) => { this.opts.showBit = c; this.rebuild(); })),
        prop('', checkbox(this.model.showWires, 'Show wiring', (c) => { this.model.showWires = c; }, 'Wire routing is approximate')),
        prop('Backdrop', seg<'studio' | 'dark'>([['studio', 'Light'], ['dark', 'Dark']], v.background, (b) => v.setBackground(b)).el),
        prop('Quality', seg<'high' | 'balanced' | 'fast'>([['high', 'High'], ['balanced', 'Balanced'], ['fast', 'Fast']], v.quality, (x) => { v.setQuality(x); }).el,
          'High adds ambient occlusion when the view is still. Use Fast on integrated graphics.'),
      ),
      sectionEx('Confidence key', { open: false },
        h('div', { class: 'legend' }, ...Object.keys(CONF_LABEL).map((c) => h('div', { class: 'legend-r' }, conf(c), h('span', { class: 'muted' }, CONF_HELP[c])))),
      ),
      sectionEx('Keyboard', { open: false },
        h('div', { class: 'keys' },
          ...([['F / ↑', 'Run forward (hold)'], ['R / ↓', 'Run reverse (hold)'], ['T', 'Trigger, current direction'], ['D', 'Flip F/R'], ['Space', 'Swivel head'], ['E', 'Explode'], ['X', 'Cycle shading'], ['Esc', 'Clear selection']] as const)
            .map(([k, l]) => h('div', { class: 'key-r' }, h('kbd', {}, k), h('span', {}, l)))),
      ),
    );
  }

  private syncTreeSelection() {
    for (const el of this.panelB.querySelectorAll<HTMLElement>('.tree-i')) el.classList.toggle('sel', el.dataset.id === this.viewer.selected);
  }

  /* ---------------- RENDER (video) ---------------- */
  private renderTab() {
    const o = this.exportOpts;
    if (!exportSupported())
      return h('div', {}, section('Video', hint('Video export requires WebCodecs (Chrome or Edge on desktop).')));
    const bar = h('div', { class: 'progress' }, h('i', {}));
    const msg = h('span', { class: 'muted small' }, '');
    const frames = h('span', { class: 'muted small' }, '');
    const est = () => { frames.textContent = `${Math.round(o.duration * o.fps)} frames`; };
    est();
    const go = h('button', { class: 'btn primary' }, 'Render');
    const cancel = h('button', { class: 'btn', hidden: true }, 'Cancel');
    go.addEventListener('click', async () => {
      this.exportAbort = new AbortController();
      go.disabled = true; cancel.hidden = false;
      const t0 = performance.now();
      try {
        const blob = await exportVideo(this, { ...o }, (fr, m) => {
          (bar.firstChild as HTMLElement).style.width = `${(fr * 100).toFixed(1)}%`;
          msg.textContent = m;
        }, this.exportAbort.signal);
        const name = `nuclear-${o.height}p${o.fps}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.mp4`;
        download(name, URL.createObjectURL(blob));
        msg.textContent = `Saved ${name} · ${(blob.size / 1e6).toFixed(1)} MB · ${((performance.now() - t0) / 1000).toFixed(1)} s`;
      } catch (e) {
        msg.textContent = (e as Error).name === 'AbortError' ? 'Cancelled' : `Export failed: ${(e as Error).message ?? e}`;
      } finally {
        go.disabled = false; cancel.hidden = true; this.exportAbort = null;
      }
    });
    cancel.addEventListener('click', () => this.exportAbort?.abort());
    const resV = `${o.width}x${o.height}`;
    return h('div', {},
      sectionEx('Output', { info: 'Frames are rendered offline at a fixed simulation step, so playback is smooth at any frame rate regardless of live performance. H.264 MP4 via WebCodecs.' },
        prop('Resolution', select([['1280x720', '1280 × 720'], ['1920x1080', '1920 × 1080'], ['2560x1440', '2560 × 1440'], ['3840x2160', '3840 × 2160']], resV, (r) => { const [w, hh] = r.split('x').map(Number); o.width = w; o.height = hh; })),
        prop('Frame rate', select([['30', '30 fps'], ['60', '60 fps'], ['120', '120 fps'], ['240', '240 fps']], String(o.fps), (f) => { o.fps = Number(f); est(); })),
        prop('Duration', numInput(o.duration, (d) => { o.duration = Math.max(0.5, Math.min(120, d)); est(); }, { step: 0.5, min: 0.5, max: 120, unit: 's' })),
        prop('Sim speed', select([['1', '1× real time'], ['0.5', '0.5×'], ['0.25', '0.25×'], ['0.1', '0.1×']], String(o.simSpeed), (s) => { o.simSpeed = Number(s); }), 'Below 1× produces slow motion'),
      ),
      section('Sequence',
        prop('Motor', select([['forward', 'Forward'], ['reverse', 'Reverse'], ['none', 'Off']], o.run, (r) => { o.run = r; })),
        prop('Camera orbit', numInput(o.orbit, (d) => { o.orbit = d; }, { step: 15, unit: '°' })),
        prop('', checkbox(o.swivel, 'Swivel head', (c) => { o.swivel = c; })),
        prop('', checkbox(o.explode, 'Explode and reassemble', (c) => { o.explode = c; })),
      ),
      section('Quality',
        prop('', checkbox(o.hq, 'Ambient occlusion and shadows', (c) => { o.hq = c; })),
        prop('', checkbox(o.overlay, 'Burn in readouts', (c) => { o.overlay = c; })),
      ),
      h('div', { class: 'actions-row' }, go, cancel, h('span', { class: 'grow' }), frames),
      h('div', { class: 'pad' }, bar, msg),
      sectionEx('Still image', { open: true },
        h('div', { class: 'pad-row' }, h('button', { class: 'btn', onclick: () => download('nuclear.png', this.viewer.screenshot()) }, 'Save PNG')),
      ),
    );
  }

  /* ---------------- SIMULATION ---------------- */
  private simTab() {
    const sim = this.sim;
    const trig = h('button', { class: 'btn trigger' }, 'Hold to run');
    trig.addEventListener('pointerdown', (e) => { e.preventDefault(); this.setTrigger(true); });
    for (const ev of ['pointerup', 'pointerleave']) trig.addEventListener(ev, () => { if (!this.lockTrigger) this.setTrigger(false); });

    const L = sim.load;
    let loadRows: Node[] = [];
    if (L.mode === 'constant') loadRows = [prop('Torque', numInput(L.constantNm, (v) => (L.constantNm = v), { step: 0.05, min: 0, unit: 'N·m' }))];
    else if (L.mode === 'beam') {
      loadRows = [
        prop('Mass', numInput(L.beamMassKg, (v) => { L.beamMassKg = v; this.renderPanel(); }, { step: 0.05, min: 0, unit: 'kg' })),
        prop('Beam length', numInput(L.beamLengthM * 1000, (v) => { L.beamLengthM = v / 1000; this.renderPanel(); }, { step: 1, min: 10, unit: 'mm' })),
        stat('Applied torque', `${(L.beamMassKg * G * L.beamLengthM).toFixed(2)} N·m`),
        stat('Stall mass (model)', `${(outputCurve(sim.d, sim.supplyVoltage(), 1)[0].torque / (G * L.beamLengthM)).toFixed(2)} kg`),
        stat('Team measurement', `1.64 N·m (${(1.64 / (G * L.beamLengthM)).toFixed(2)} kg)`),
      ];
    } else if (L.mode === 'screw') {
      const s = L.screw;
      loadRows = [
        prop('Screw length', numInput(s.lengthMm, (v) => (s.lengthMm = v), { step: 1, unit: 'mm' })),
        prop('Thread pitch', numInput(s.pitchMm, (v) => (s.pitchMm = v), { step: 0.1, unit: 'mm' })),
        prop('Start torque', numInput(s.startNm, (v) => (s.startNm = v), { step: 0.05, unit: 'N·m' })),
        prop('End torque', numInput(s.endNm, (v) => (s.endNm = v), { step: 0.05, unit: 'N·m' })),
        prop('Seating torque', numInput(s.seatNm, (v) => (s.seatNm = v), { step: 0.1, unit: 'N·m' })),
        stat('Depth', '—', 'depth', this.readoutEls),
        prop('', h('button', { class: 'btn', onclick: () => { sim.st.screwDepthMm = 0; sim.st.peakTorque = 0; } }, 'New screw')),
      ];
    }

    this.chartTS = h('canvas', { class: 'chart' });
    this.chartHist = h('canvas', { class: 'chart short' });
    this.stressEl = h('div', {});
    const r = this.readoutEls;
    return h('div', {},
      sectionEx('Controls', { info: 'Single speed. The F/R push-through button sets direction; the trigger runs the motor and lights the LED headlamp.' },
        prop('Direction', seg<'1' | '-1'>([['1', 'Forward'], ['-1', 'Reverse']], this.direction > 0 ? '1' : '-1', (v) => this.setDirection(v === '1' ? 1 : -1)).el),
        prop('Trigger', trig),
        prop('', checkbox(this.lockTrigger, 'Lock trigger on', (c) => { this.lockTrigger = c; this.setTrigger(c); })),
      ),
      sectionEx('Supply', { info: `Rated mode holds 3.6 V so outputs match the box (220 rpm, 3 N·m). The battery model follows a generic Li-ion OCV curve (assumed); 3.6 V ≈ ${(socAt(3.6) * 100).toFixed(0)} % state of charge.` },
        prop('Source', seg<'rated' | 'battery'>([['rated', 'Rated'], ['battery', 'Battery']], sim.voltageMode, (m) => { sim.voltageMode = m; this.renderPanel(); }).el),
        sim.voltageMode === 'battery' ? (() => {
          const soc = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(sim.st.soc) });
          soc.addEventListener('input', () => { sim.st.soc = parseFloat(soc.value); });
          return h('div', {},
            prop('State of charge', soc),
            stat('Cell', '—', 'soc', r),
            prop('', checkbox(sim.st.charging, 'Connected to USB', (c) => { sim.st.charging = c; })),
            prop('Time scale', select([['1', '1×'], ['10', '10×'], ['60', '60×'], ['600', '600×']], String(sim.timeScale), (x) => { sim.timeScale = Number(x); })),
          );
        })() : null,
      ),
      section('Load',
        prop('Type', select<LoadMode>([['none', 'Free running'], ['constant', 'Constant torque'], ['beam', 'Beam stall test'], ['screw', 'Wood screw']], L.mode,
          (m) => { L.mode = m; sim.st.screwDepthMm = 0; sim.st.peakTorque = 0; this.renderPanel(); })),
        ...loadRows,
      ),
      section('Readouts',
        h('div', { class: 'stats' },
          stat('Output speed', '—', 'outRpm', r), stat('Output torque', '—', 'outT', r), stat('Motor speed', '—', 'motRpm', r),
          stat('Current', '—', 'cur', r), stat('Supply', '—', 'volt', r), stat('Power in', '—', 'pin', r), stat('Power out', '—', 'pout', r),
          stat('Efficiency', '—', 'eff', r), stat('Peak torque', '—', 'peak', r), stat('Energy', '—', 'energy', r), stat('Runtime at load', '—', 'runtime', r),
        ),
      ),
      sectionEx('Torque–speed', { info: 'Output characteristic of the current gearbox (solid) vs the stock 81:1 (dashed). Reference lines: box rating, listing and team measurement. Dot = operating point.' },
        this.chartTS, h('div', { class: 'chart-key' },
          key(C.accent, 'Current'), key(C.grid, 'Stock 81:1', true), key(C.red, 'Operating point'),
          key('#7c818b', `Rated ${this.spec.rated.maxTorque.value} N·m / ${this.spec.rated.noLoadRpm.value} rpm`, true),
          key(C.amber, `Listing ${this.spec.rated.listingTorque.value} N·m`, true), key(C.green, `Measured ${this.spec.rated.measuredTorque.value} N·m`, true))),
      sectionEx('History · 10 s', { open: true },
        this.chartHist, h('div', { class: 'chart-key' }, key(C.accent, 'rpm ÷ 100'), key(C.amber, 'N·m'), key(C.red, 'A ÷ 10'))),
      sectionEx('Tooth stress', { info: 'Lewis bending with equal load sharing and textbook allowables (assumed). Profile-shifted 6-tooth suns are stronger than the plain Lewis factor implies — use to compare designs.' }, this.stressEl),
    );
  }

  updateReadouts() {
    const r = this.readoutEls;
    if (!Object.keys(r).length && !this.chartTS) return;
    const sim = this.sim, st = sim.st;
    const set = (k: string, s: string) => { if (r[k]) r[k].textContent = s; };
    const rpm = sim.outputRpm();
    const V = Math.abs(st.voltage) || sim.supplyVoltage();
    const pin = Math.abs(st.voltage * st.current);
    const pout = Math.abs(st.outputTorque * (st.omega / sim.d.ratio));
    set('outRpm', `${rpm.toFixed(1)} rpm`);
    set('outT', `${st.outputTorque.toFixed(3)} N·m`);
    set('motRpm', `${radSToRpm(st.omega).toFixed(0)} rpm`);
    set('cur', `${st.current.toFixed(2)} A`);
    set('volt', `${V.toFixed(2)} V`);
    set('pin', `${pin.toFixed(2)} W`);
    set('pout', `${pout.toFixed(2)} W`);
    set('eff', pin > 0.01 ? `${((pout / pin) * 100).toFixed(0)} %` : '—');
    set('peak', `${st.peakTorque.toFixed(2)} N·m`);
    set('energy', `${(st.energyWh * 1000).toFixed(1)} mWh`);
    set('soc', `${(st.soc * 100).toFixed(1)} % · ${sim.supplyVoltage().toFixed(2)} V`);
    set('depth', `${st.screwDepthMm.toFixed(1)} / ${sim.load.screw.lengthMm} mm`);
    const capWh = this.spec.battery.capacity.value * this.spec.battery.nominal.value;
    set('runtime', pin > 0.05 ? `${((capWh / pin) * 60).toFixed(0)} min` : '—');

    if (this.chartTS) {
      const Vs = sim.supplyVoltage();
      const cur = outputCurve(sim.d, Vs);
      const stock = outputCurve({ ...sim.d, ratio: sim.d.stockRatio, eta: sim.d.stockEta }, Vs);
      const R = this.spec.rated;
      drawChart(this.chartTS, {
        series: [
          { pts: stock.map((p) => ({ x: p.rpm, y: p.torque })), color: C.grid, dash: [4, 3], width: 1.25 },
          { pts: cur.map((p) => ({ x: p.rpm, y: p.torque })), color: C.accent, width: 2 },
        ],
        markers: [
          { x: R.noLoadRpm.value, y: 0, color: '#7c818b', label: '', shape: 'vline' },
          { x: 0, y: R.maxTorque.value, color: '#7c818b', label: '', shape: 'hline' },
          { x: 0, y: R.listingTorque.value, color: C.amber, label: '', shape: 'hline' },
          { x: 0, y: R.measuredTorque.value, color: C.green, label: '', shape: 'hline' },
          { x: Math.abs(rpm), y: Math.abs(st.outputTorque), color: C.red, label: '', shape: 'dot' },
        ],
        xLabel: 'rpm', yLabel: 'N·m',
      });
    }
    if (this.chartHist && this.history.length > 1) {
      const t0 = this.history[0].t;
      drawChart(this.chartHist, {
        series: [
          { pts: this.history.map((p) => ({ x: p.t - t0, y: p.rpm / 100 })), color: C.accent, width: 1.5 },
          { pts: this.history.map((p) => ({ x: p.t - t0, y: p.torque })), color: C.amber, width: 1.5 },
          { pts: this.history.map((p) => ({ x: p.t - t0, y: p.current / 10 })), color: C.red, width: 1.5 },
        ],
        xLabel: 's', yLabel: '', xMax: 10 * sim.timeScale,
      });
    }
    if (this.stressEl) {
      const Tm = Math.abs(st.outputTorque) / (sim.d.ratio * sim.d.eta);
      const loads = stageLoads(this.spec.stages, Tm);
      const stallTm = sim.d.motor.ke * (sim.supplyVoltage() / sim.d.motor.r - sim.d.motor.i0);
      const stall = stageLoads(this.spec.stages, stallTm);
      this.stressEl.replaceChildren(
        h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Stage'), h('th', { class: 'r' }, 'Force'), h('th', { class: 'r' }, 'Sun σ'), h('th', { class: 'r' }, 'SF'), h('th', { class: 'r' }, 'SF stall'))),
          h('tbody', {}, loads.map((l, i) => h('tr', {},
            h('td', {}, `${i + 1} · ${MATERIALS[this.spec.stages[i].material].name.split(' ')[0]}`),
            h('td', { class: 'r' }, `${l.toothForce.toFixed(1)} N`),
            h('td', { class: 'r' }, `${l.sunStress.toFixed(1)} MPa`),
            h('td', { class: `r ${sfClass(l.safety)}` }, l.safety > 99 ? '—' : l.safety.toFixed(1)),
            h('td', { class: `r ${sfClass(stall[i].safety)}` }, stall[i].safety.toFixed(2)),
          ))),
        ),
      );
    }
  }

  /* ---------------- GEARBOX ---------------- */
  private gearTab() {
    const S = this.spec;
    const curve = outputCurve(this.sim.d, S.rated.voltage.value, 1);
    const gb = S.gearbox;
    const pitches = S.stages.map((s) => s.faceWidth + gb.carrierThickness.value + gb.stageGap.value);
    const need = gb.stageGap.value + pitches.reduce((a, b) => a + b, 0) + 1;
    const avail = gb.housingEndX.value - gb.housingStartX.value;

    const update = (s: StageSpec, k: keyof StageSpec, v: number | string) => {
      (s as unknown as Record<string, unknown>)[k] = v;
      if (k !== 'material' && k !== 'efficiency') s.stock = false;
      if (k === 'material' && v !== 'POM') s.stock = false;
      this.scheduleRebuild();
    };
    const stages = S.stages.map((s, i) => {
      const issues = validateStage(s);
      const worst = issues.some((x) => x.severity === 'error') ? 'error' : issues.some((x) => x.severity === 'warning') ? 'warning' : 'ok';
      const actions = h('span', { class: 'sec-actions' },
        i > 0 ? iconBtn('up', 'Move toward motor', () => { [S.stages[i - 1], S.stages[i]] = [S.stages[i], S.stages[i - 1]]; this.scheduleRebuild(); }) : null,
        S.stages.length > 1 ? iconBtn('trash', 'Remove stage', () => { S.stages.splice(i, 1); this.scheduleRebuild(); }) : null,
      );
      const int = (k: 'sun' | 'ring' | 'planet' | 'planets', min: number, max?: number) => numInput(s[k], (v) => update(s, k, Math.round(v)), { step: 1, min, max });
      return sectionEx(`Stage ${i + 1} · ${stageRatio(s).toFixed(3).replace(/\.?0+$/, '')}:1${s.stock ? '' : ' · modified'}`, { aside: actions },
        h('div', { class: 'grid4' },
          h('label', { class: 'cell' }, h('span', {}, 'Sun'), int('sun', 3)),
          h('label', { class: 'cell' }, h('span', {}, 'Ring'), int('ring', 10)),
          h('label', { class: 'cell' }, h('span', {}, 'Planet'), int('planet', 4)),
          h('label', { class: 'cell' }, h('span', {}, 'Count'), int('planets', 1, 8)),
        ),
        prop('Module', numInput(s.module, (v) => update(s, 'module', v), { step: 0.05, min: 0.2, unit: 'mm' })),
        prop('Face width', numInput(s.faceWidth, (v) => update(s, 'faceWidth', v), { step: 0.5, min: 1, unit: 'mm' })),
        prop('Efficiency', numInput(s.efficiency, (v) => update(s, 'efficiency', v), { step: 0.01, min: 0.3, max: 1 })),
        prop('Material', select((Object.keys(MATERIALS) as MaterialKey[]).map((k) => [k, MATERIALS[k].name] as [MaterialKey, string]), s.material, (m) => update(s, 'material', m))),
        h('div', { class: `checks ${worst}` },
          issues.length ? issues.map((x) => h('div', { class: `chk ${x.severity}` }, x.message)) : h('div', { class: 'chk ok' }, 'Geometry valid')),
        Number.isInteger((s.ring - s.sun) / 2) && s.planet !== (s.ring - s.sun) / 2
          ? h('div', { class: 'pad-row' }, h('button', { class: 'btn', onclick: () => { s.planet = (s.ring - s.sun) / 2; s.stock = false; this.scheduleRebuild(); } }, `Set planet to ${(s.ring - s.sun) / 2} (standard)`))
          : null,
      );
    });

    return h('div', {},
      sectionEx('Summary', { info: 'The motor is fixed (RS-380SA calibrated to the box ratings through the stock 81:1). Output = motor × ratio × η. Ring fixed, sun input, carrier output.' },
        h('div', { class: 'stats' },
          stat('Total ratio', fmtRatio(totalRatio(S.stages))),
          stat('Efficiency', `${(totalEfficiency(S.stages) * 100).toFixed(1)} %`),
          stat('No-load at 3.6 V', `${curve[1].rpm.toFixed(1)} rpm`),
          stat('Stall at 3.6 V', `${curve[0].torque.toFixed(2)} N·m`),
          stat('Axial length', `${need.toFixed(1)} / ${avail.toFixed(1)} mm`),
        ),
        need > avail
          ? h('div', { class: 'callout warning' },
            h('span', {}, `Needs ${(need - avail).toFixed(1)} mm beyond the stock housing.`),
            checkbox(this.opts.extendShell, 'Lengthen head to fit', (c) => { this.opts.extendShell = c; this.rebuild(); this.renderPanel(); }))
          : null,
      ),
      ...stages,
      h('div', { class: 'actions-row' },
        h('button', { class: 'btn', onclick: () => { S.stages.push({ ...STOCK_STAGE(uid()), stock: false }); this.scheduleRebuild(); } }, 'Add stage'),
        h('button', { class: 'btn', title: 'Sun 12 · ring 36 · planet 12', onclick: () => { S.stages.push({ ...STOCK_STAGE(uid()), sun: 12, ring: 36, planet: 12, stock: false }); this.scheduleRebuild(); } }, 'Add 4:1 stage'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn subtle', onclick: () => { S.stages = defaultSpec().stages; this.scheduleRebuild(); } }, 'Reset'),
      ),
    );
  }

  /* ---------------- CUSTOM PARTS ---------------- */
  private partsTab() {
    const S = this.spec;
    const add = (kind: CustomPart['kind']) => {
      const sizes: Record<string, number[]> = { box: [20, 10, 10], cylinder: [8, 20], tube: [10, 15, 7], sphere: [6], gear: [20, 0.667, 4], mesh: [1] };
      S.customParts.push({
        id: uid(), name: `${kind[0].toUpperCase()}${kind.slice(1)} ${S.customParts.length + 1}`, kind, attach: 'handle', color: '#4f8ef7', size: sizes[kind],
        position: [0, -40, 0], rotation: [0, 0, 0], massG: 0,
      });
      this.scheduleRebuild();
    };
    const file = h('input', { type: 'file', accept: '.stl,.obj,.glb,.gltf', hidden: true });
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      if (f.size > 8e6) { alert('File exceeds 8 MB.'); return; }
      const ext = f.name.split('.').pop()!.toLowerCase();
      const fr = new FileReader();
      fr.onload = () => {
        S.customParts.push({
          id: uid(), name: f.name, kind: 'mesh', attach: 'handle', color: '#4f8ef7', size: [1],
          position: [0, -40, 0], rotation: [0, 0, 0], massG: 0, meshData: String(fr.result),
          meshFormat: ext === 'stl' ? 'stl' : ext === 'obj' ? 'obj' : 'glb', note: `Imported ${f.name} (units: mm)`,
        });
        this.scheduleRebuild();
      };
      fr.readAsDataURL(f);
    });
    const sizeLabels: Record<string, [string, string][]> = {
      box: [['X', 'mm'], ['Y', 'mm'], ['Z', 'mm']], cylinder: [['Radius', 'mm'], ['Length', 'mm']], tube: [['Outer radius', 'mm'], ['Length', 'mm'], ['Inner radius', 'mm']],
      sphere: [['Radius', 'mm']], gear: [['Teeth', ''], ['Module', 'mm'], ['Face width', 'mm']], mesh: [],
    };
    const xyz = (vals: number[], unit: string, step: number, set: (k: number, v: number) => void) =>
      h('div', { class: 'xyz' }, ...['X', 'Y', 'Z'].map((ax, k) => h('label', { class: 'cell' }, h('span', {}, ax), numInput(vals[k], (v) => set(k, v), { step, unit }))));
    const items = S.customParts.map((c, i) => {
      const upd = () => this.scheduleRebuild(false);
      const name = h('input', { type: 'text', value: c.name });
      name.addEventListener('change', () => { c.name = name.value; upd(); });
      const col = h('input', { type: 'color', value: c.color });
      col.addEventListener('input', () => { c.color = col.value; upd(); });
      const actions = h('span', { class: 'sec-actions' },
        iconBtn('focus', 'Select and focus', () => { this.viewer.select(`custom-${c.id}`); this.viewer.frame(`custom-${c.id}`); }),
        iconBtn('trash', 'Delete', () => { S.customParts.splice(i, 1); this.scheduleRebuild(); }));
      return sectionEx(c.name, { aside: actions },
        prop('Name', name),
        prop('Attach to', select([['handle', 'Handle'], ['head', 'Head'], ['spindle', 'Spindle (rotates)'], ['world', 'World']], c.attach, (a) => { c.attach = a; upd(); })),
        prop('Colour', col),
        prop('Mass', numInput(c.massG, (v) => { c.massG = v; upd(); }, { step: 1, min: 0, unit: 'g' })),
        ...sizeLabels[c.kind].map(([l, u], k) => prop(l, numInput(c.size[k] ?? 0, (v) => { c.size[k] = v; upd(); }, { step: 0.5, unit: u }))),
        h('div', { class: 'sub-l' }, 'Position'), xyz(c.position, 'mm', 1, (k, v) => { c.position[k] = v; upd(); }),
        h('div', { class: 'sub-l' }, 'Rotation'), xyz(c.rotation, '°', 5, (k, v) => { c.rotation[k] = v; upd(); }),
      );
    });
    const mass = S.body.massG.value + S.customParts.reduce((a, c) => a + c.massG, 0);
    return h('div', {},
      sectionEx('Add', { info: 'Coordinates in mm, straight configuration: X from butt (0) to nose, Y up, Z toward the viewer. Head parts swivel with the head; spindle parts rotate with the output.' },
        h('div', { class: 'btn-grid' },
          ...(['box', 'cylinder', 'tube', 'sphere', 'gear'] as const).map((k) => h('button', { class: 'btn', onclick: () => add(k) }, k[0].toUpperCase() + k.slice(1))),
          h('button', { class: 'btn', onclick: () => file.click() }, 'Import mesh…'), file,
        ),
        stat('Estimated mass', `${mass.toFixed(0)} g`),
      ),
      ...(items.length ? items : [h('div', { class: 'empty' }, 'No custom parts')]),
    );
  }

  /* ---------------- SPECIFICATIONS ---------------- */
  private specsFilter = false;
  private specsTab() {
    const S = this.spec;
    const d = this.sim.d;
    const imp = h('input', { type: 'file', accept: '.json', hidden: true });
    imp.addEventListener('change', async () => {
      const f = imp.files?.[0];
      if (!f) return;
      try {
        this.spec = mergeSpec(JSON.parse(await f.text()));
        this.rebuild(); this.renderPanel();
      } catch (e) { alert(`Could not import: ${e}`); }
    });
    const groups = SPEC_GROUPS.map(([key, title]) => {
      const g = S[key] as unknown as Record<string, Param>;
      const rows = Object.entries(g).filter(([, p]) => !this.specsFilter || p.confidence === 'assumed' || p.confidence === 'uncertain')
        .map(([k, p]) => h('div', { class: 'spec', title: `${p.source}${p.note ? `\n\n${p.note}` : ''}` },
          h('span', { class: 'spec-l' }, conf(p.confidence, false), h('span', {}, p.label)),
          numInput(p.value, (v) => { g[k] = { ...p, value: v }; this.scheduleRebuild(); }, { step: p.step, min: p.min, max: p.max, unit: p.unit })));
      return rows.length ? sectionEx(title, { open: key === 'rated' }, ...rows) : null;
    });
    const prof = h('table', { class: 'tbl edit' },
      h('thead', {}, h('tr', {}, ...['x', 'top', 'bottom', 'half'].map((t) => h('th', { class: 'r' }, t)))),
      h('tbody', {}, S.profile.map((st) => h('tr', {}, ...(['x', 'top', 'bottom', 'half'] as const).map((k) =>
        h('td', {}, numInput(st[k], (v) => { st[k] = v; this.scheduleRebuild(false); }, { step: 0.5 })))))));
    return h('div', {},
      section('File',
        h('div', { class: 'btn-grid' },
          h('button', { class: 'btn', onclick: () => download('nuclear-spec.json', JSON.stringify(this.spec, null, 2)) }, 'Export JSON'),
          h('button', { class: 'btn', onclick: () => imp.click() }, 'Import JSON'), imp,
          h('button', { class: 'btn subtle', onclick: () => { if (confirm('Reset every value to the built-in defaults?')) { clearSaved(); this.spec = defaultSpec(); this.rebuild(); this.renderPanel(); } } }, 'Reset all'),
        ),
        prop('', checkbox(this.specsFilter, 'Unverified only', (c) => { this.specsFilter = c; this.renderPanel(); })),
      ),
      sectionEx('Motor model', { info: 'Solved so the stock 81:1 gearbox (η = stage η²) reproduces the box ratings at 3.6 V exactly.', open: false },
        h('div', { class: 'stats' },
          stat('No-load speed', `${d.motorNoLoadRpm.toFixed(0)} rpm`),
          stat('Stall torque', `${(d.motorStallTorque * 1000).toFixed(1)} mN·m`),
          stat('Ke = Kt', `${(d.motor.ke * 1000).toFixed(3)} mV·s/rad`),
          stat('Loop resistance', `${(d.motor.r * 1000).toFixed(0)} mΩ`),
          stat('Stall current', `${(S.rated.voltage.value / d.motor.r).toFixed(1)} A`),
          stat('Winding resistance', `${((d.motor.r - S.battery.internalR.value - S.electrical.wiringR.value) * 1000).toFixed(0)} mΩ`),
        ),
      ),
      ...groups,
      sectionEx('Shell profile', { open: false, info: 'Side profile stations in mm (straight configuration). Section facets (e, sd, ct, cb) are edited in src/config/screwdriver.ts.' }, prof),
    );
  }

  /* ---------------- PROPERTIES ---------------- */
  renderInspector(id: string | null) {
    const p = id ? this.model.partById(id) : null;
    const head = h('div', { class: 'insp-h' }, h('span', {}, 'Properties'));
    if (!p) {
      this.inspector.replaceChildren(head, h('div', { class: 'empty' }, 'No selection', h('span', {}, 'Select a part in the viewport or browser.')));
      return;
    }
    this.inspector.replaceChildren(
      head,
      h('div', { class: 'insp-title' }, h('div', { class: 'insp-name' }, p.info.name), h('div', { class: 'insp-sub' }, p.info.group)),
      h('div', { class: 'insp-actions' },
        iconBtn('focus', 'Zoom to part', () => this.viewer.frame(p.info.id), { label: 'Focus' }),
        iconBtn('isolate', 'Show only this part', () => { this.isolate = !this.isolate; this.applyIsolate(); this.renderInspector(id); }, { label: 'Isolate', active: this.isolate }),
        iconBtn('x', 'Clear selection (Esc)', () => this.viewer.select(null)),
      ),
      h('div', { class: 'insp-grid' },
        prop('Confidence', conf(p.info.confidence)),
        p.info.dims ? prop('Dimensions', h('span', { class: 'tnum' }, p.info.dims)) : null,
      ),
      h('div', { class: 'insp-block' }, h('div', { class: 'sub-l' }, 'Description'), h('p', {}, p.info.desc)),
      h('div', { class: 'insp-block' }, h('div', { class: 'sub-l' }, 'Source'), h('p', { class: 'muted' }, p.info.source)),
    );
    if (this.isolate) this.applyIsolate();
  }
  applyIsolate() {
    this.model.isolateId = this.isolate ? this.viewer.selected : null;
    this.model.applyLayout();
    this.model.updateKinematics(this.sim.st.motorAngle, this.sim.outputAngle());
    this.viewer.invalidate(true);
  }
}

/* ---------------- helpers ---------------- */
const sfClass = (sf: number) => (sf < 1 ? 'bad' : sf < 1.5 ? 'warn' : 'good');
const fmtRatio = (r: number) => `${Number.isInteger(r) ? r : r.toFixed(2)}:1`;
const uid = () => Math.random().toString(36).slice(2, 8);
const key = (color: string, label: string, dashed = false) =>
  h('span', { class: 'ck' }, h('i', { style: `background:${dashed ? 'transparent' : color};border-top:${dashed ? `1.5px dashed ${color}` : 'none'}` }), label);
