import './style.css';
import { App } from './ui/app';

declare global {
  interface Window { nuclear: App }
}

const boot = document.getElementById('boot');
const status = document.getElementById('boot-status');
const say = (s: string) => { if (status) status.textContent = s; };
/** Let the browser paint the current boot status before continuing. */
const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function start() {
  if (!webglAvailable()) throw new Error('WebGL is not available. Enable hardware acceleration in your browser settings, or try Chrome, Edge or Firefox.');
  say('Building model');
  await nextPaint();
  window.nuclear = new App();
  say('Rendering');
  // wait for the first frames of the viewport (and the UI font) before revealing
  await Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]);
  await nextPaint();
  boot?.classList.add('done');
  boot?.setAttribute('aria-busy', 'false');
  setTimeout(() => boot?.remove(), 600);
}

start().catch((e: unknown) => {
  console.error(e);
  boot?.classList.add('error');
  say(`Could not start: ${(e as Error)?.message ?? e}`);
});
