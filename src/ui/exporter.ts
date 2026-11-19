import * as THREE from 'three';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { App } from './app';

/**
 * Offline video export. Frames are rendered one at a time with a FIXED simulation step
 * (1/fps × sim speed), so the output is perfectly smooth at any frame rate/resolution no matter
 * how fast the machine renders live. Encoding uses WebCodecs (Chrome / Edge) → H.264 MP4.
 */
export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  duration: number; // seconds of video
  simSpeed: number; // simulated seconds per video second (0.25 = 4× slow motion)
  hq: boolean; // ambient occlusion + shadows every frame
  run: 'none' | 'forward' | 'reverse';
  swivel: boolean; // swing the head to the other position
  explode: boolean; // explode then reassemble
  orbit: number; // degrees of camera orbit over the clip
  overlay: boolean; // burn in rpm / torque readouts
}

export const exportSupported = () => typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window;

const CODECS: { codec: string; mux: 'avc' | 'vp9' }[] = [
  { codec: 'avc1.640034', mux: 'avc' }, // High @ 5.2 (4K60)
  { codec: 'avc1.640033', mux: 'avc' }, // High @ 5.1
  { codec: 'avc1.64002A', mux: 'avc' }, // High @ 4.2 (1080p60)
  { codec: 'avc1.4D0034', mux: 'avc' }, // Main @ 5.2
  { codec: 'vp09.00.51.08', mux: 'vp9' },
  { codec: 'vp09.00.41.08', mux: 'vp9' },
];

async function pickCodec(o: ExportOptions, bitrate: number) {
  for (const c of CODECS) {
    const cfg: VideoEncoderConfig = { codec: c.codec, width: o.width, height: o.height, bitrate, framerate: o.fps };
    try {
      const r = await VideoEncoder.isConfigSupported(cfg);
      if (r.supported) return { ...c, cfg };
    } catch { /* try next */ }
  }
  throw new Error(`No supported encoder for ${o.width}×${o.height} @ ${o.fps} fps in this browser.`);
}

const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

export async function exportVideo(
  app: App, o: ExportOptions, onProgress: (frac: number, msg: string) => void, signal: AbortSignal,
): Promise<Blob> {
  const { viewer, model, sim } = app;
  const renderer = viewer.renderer;
  const canvas = renderer.domElement;
  const W = o.width & ~1, H = o.height & ~1;
  const N = Math.max(1, Math.round(o.duration * o.fps));
  const bitrate = Math.round(Math.min(80e6, W * H * o.fps * 0.12));
  const { cfg, mux } = await pickCodec({ ...o, width: W, height: H }, bitrate);

  // ---- save live state ----
  const saved = {
    pr: renderer.getPixelRatio(),
    st: structuredClone(sim.st),
    timeScale: sim.timeScale,
    head: model.headAngle, headTarget: app.headTarget,
    explode: model.explode, explodeTarget: app.explodeTarget,
    cam: viewer.camera.position.clone(), target: viewer.controls.target.clone(),
    aspect: viewer.camera.aspect,
    direction: app.direction,
  };
  app.paused = true;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: mux, width: W, height: H, frameRate: o.fps }, fastStart: 'in-memory' });
  let encErr: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encErr = e; },
  });
  encoder.configure(cfg);

  // optional 2D compositor for burned-in readouts
  const comp = o.overlay ? document.createElement('canvas') : null;
  if (comp) { comp.width = W; comp.height = H; }
  const ctx = comp?.getContext('2d') ?? null;

  try {
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    viewer.composer.setSize(W, H);
    viewer.camera.aspect = W / H;
    viewer.camera.updateProjectionMatrix();
    sim.timeScale = 1;

    const D = o.duration;
    const dir: 1 | -1 = o.run === 'reverse' ? -1 : 1;
    const head0 = model.headAngle, head1 = head0 > 0.5 ? 0 : 1;
    const camOff = saved.cam.clone().sub(saved.target);
    const useAO = o.hq && viewer.mode === 'solid' && !viewer.section.enabled;
    let lastPose = '';

    for (let i = 0; i < N; i++) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      if (encErr) throw encErr;
      const t = i / o.fps;
      const f = N > 1 ? i / (N - 1) : 0;

      // ---- scripted actions ----
      const runOn = o.run !== 'none' && t >= Math.min(0.3, D * 0.1) && t <= D - Math.min(0.6, D * 0.15);
      app.direction = dir;
      sim.st.trigger = runOn ? dir : 0;
      if (o.swivel) model.headAngle = head0 + (head1 - head0) * smooth(D * 0.2, D * 0.6, t);
      if (o.explode) model.explode = smooth(D * 0.12, D * 0.42, t) * (1 - smooth(D * 0.6, D * 0.9, t));
      if (o.orbit) {
        const off = camOff.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(o.orbit) * f);
        viewer.camera.position.copy(saved.target).add(off);
        viewer.camera.lookAt(saved.target);
      }

      // ---- physics at a fixed step ----
      if (i > 0) sim.step(o.simSpeed / o.fps);
      const st = sim.st;
      model.triggerPressed = st.trigger !== 0;
      model.direction = app.direction;
      model.occlude = viewer.mode === 'solid' && !viewer.section.enabled && model.explode < 0.004 && !app.isolate;
      model.applyLayout();
      model.updateKinematics(st.motorAngle, sim.outputAngle());
      model.setLeds(st.trigger !== 0 && !st.dead, st.charging ? (st.soc < 0.999 ? 'red' : 'green') : 'off');
      const pose = `${model.headAngle.toFixed(4)}|${model.explode.toFixed(4)}`;
      if (pose !== lastPose || i === 0) {
        lastPose = pose;
        renderer.shadowMap.needsUpdate = true;
        viewer.fitFloor();
      }

      // ---- render ----
      if (useAO) { renderer.shadowMap.needsUpdate = true; viewer.composer.render(); }
      else renderer.render(viewer.scene, viewer.camera);

      let src: CanvasImageSource = canvas;
      if (ctx && comp) {
        ctx.drawImage(canvas, 0, 0, W, H);
        const s = Math.max(1, H / 720);
        const lines = [
          `${st.trigger > 0 ? 'FORWARD' : st.trigger < 0 ? 'REVERSE' : 'IDLE'}${st.stalled ? ' · STALLED' : ''}`,
          `${Math.abs(sim.outputRpm()).toFixed(0)} rpm   ${Math.abs(st.outputTorque).toFixed(2)} N·m   ${Math.abs(st.current).toFixed(1)} A`,
          `t = ${st.time.toFixed(2)} s${o.simSpeed !== 1 ? `  (×${o.simSpeed} speed)` : ''}`,
        ];
        ctx.font = `600 ${Math.round(18 * s)}px ui-monospace, Menlo, monospace`;
        const lh = 24 * s, pad = 12 * s;
        const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(pad, pad, bw, lh * lines.length + pad);
        ctx.fillStyle = '#ffffff';
        lines.forEach((l, k) => ctx.fillText(l, pad * 2, pad + lh * (k + 0.8)));
        src = comp;
      }
      const frame = new VideoFrame(src, { timestamp: Math.round((i * 1e6) / o.fps), duration: Math.round(1e6 / o.fps) });
      encoder.encode(frame, { keyFrame: i % Math.max(1, o.fps * 2) === 0 });
      frame.close();

      // backpressure + keep the page responsive
      while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 1));
      if (i % 4 === 0) {
        onProgress((i + 1) / N, `Rendering frame ${i + 1} / ${N}`);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    onProgress(1, 'Finishing encode…');
    await encoder.flush();
    if (encErr) throw encErr;
    muxer.finalize();
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    try { if (encoder.state !== 'closed') encoder.close(); } catch { /* ignore */ }
    // ---- restore live state ----
    Object.assign(sim.st, saved.st);
    sim.timeScale = saved.timeScale;
    model.headAngle = saved.head; app.headTarget = saved.headTarget;
    model.explode = saved.explode; app.explodeTarget = saved.explodeTarget;
    app.direction = saved.direction;
    viewer.camera.position.copy(saved.cam);
    viewer.controls.target.copy(saved.target);
    viewer.camera.aspect = saved.aspect;
    renderer.setPixelRatio(saved.pr);
    viewer.resize();
    app.paused = false;
    viewer.invalidate(true);
  }
}
