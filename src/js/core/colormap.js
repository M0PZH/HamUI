// Waterfall color maps as 256-entry RGB lookup tables.
import { parseColor, resolveColors } from './theme.js';

/** Built-in maps as evenly spaced [r,g,b] stops. 'theme' reads --ham-wf-0..4. */
export const colormaps = {
  gray: [[8, 9, 12], [245, 246, 248]],
  // matplotlib maps sampled at 9 evenly spaced points
  viridis: [[68, 1, 84], [72, 40, 120], [62, 73, 137], [49, 104, 142], [38, 130, 142], [31, 158, 137], [53, 183, 121], [110, 206, 88], [253, 231, 37]],
  inferno: [[0, 0, 4], [27, 12, 65], [74, 12, 107], [120, 28, 109], [165, 44, 96], [207, 68, 70], [237, 105, 37], [251, 155, 6], [252, 255, 164]],
  plasma: [[13, 8, 135], [75, 3, 161], [125, 3, 168], [168, 34, 150], [203, 70, 121], [229, 107, 93], [248, 148, 65], [253, 195, 40], [240, 249, 33]],
  turbo: [[48, 18, 59], [70, 134, 251], [27, 229, 181], [164, 252, 60], [251, 185, 56], [228, 70, 12], [122, 4, 3]],
};

export function buildLUT(stops) {
  const lut = new Uint8ClampedArray(256 * 3);
  const n = stops.length - 1;
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * n;
    const a = Math.min(n - 1, Math.floor(t));
    const f = t - a;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = stops[a][c] + (stops[a + 1][c] - stops[a][c]) * f;
  }
  return lut;
}

/**
 * Resolve a colormap spec into a LUT.
 * @param {string|Array} spec 'theme' | a built-in name | array of CSS colors or [r,g,b]
 * @param {HTMLElement} el element whose theme tokens apply
 */
export function resolveColormap(spec, el) {
  if (spec === 'theme' || spec == null) {
    const names = ['wf-0', 'wf-1', 'wf-2', 'wf-3', 'wf-4'];
    const c = resolveColors(el, names);
    return buildLUT(names.map((n) => parseColor(c[n])));
  }
  if (typeof spec === 'string') return buildLUT(colormaps[spec] || colormaps.gray);
  const stops = spec.map((s) => (Array.isArray(s) ? s : parseColor(resolveColors(el, [s])[s])));
  return buildLUT(stops);
}
