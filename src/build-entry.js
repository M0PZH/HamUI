// Bundle entry: pulls in the stylesheet so Vite emits dist/hamui.css,
// and re-exports the JS API. Native-ESM users import src/js/index.js
// and link src/css/hamui.css directly instead.
import './css/hamui.css';
export * from './js/index.js';
export { default } from './js/index.js';
