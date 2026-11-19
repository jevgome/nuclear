import './style.css';
import { App } from './ui/app';

declare global {
  interface Window { nuclear: App }
}
window.nuclear = new App();
