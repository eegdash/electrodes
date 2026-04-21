/* ============================================================
   Evidence generator — runs the real BIDSLoader against the
   test fixtures and re-creates the 2D topomap with the same
   projection topo2d.js uses. Output is a standalone SVG you
   can open in any browser: if it shows a recognizable 10-20
   layout on a head circle, the loader + projection are wired
   correctly.
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Load bids-loader.js into a fake window.
const win = {};
new Function('window', fs.readFileSync(path.join(root, 'bids-loader.js'), 'utf8'))(win);
const BL = win.BIDSLoader;

// Load fixtures.
const tsvText = fs.readFileSync(path.join(__dirname, 'sub-01_task-rest_electrodes.tsv'), 'utf8');
const coordsystemJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'sub-01_task-rest_coordsystem.json'), 'utf8'));

// Run the real pipeline.
const montage = BL.buildMontageFromBIDS({ tsvText, coordsystemJson, label: 'sub-01_task-rest' });

console.log('--- Loader report ---');
console.log('label        :', montage.label);
console.log('count        :', montage.count);
console.log('space        :', montage.space);
console.log('units (out)  :', montage.units);
console.log('sphere R (m) :', montage.sphere.R.toFixed(5));
console.log('sample (Cz)  :', JSON.stringify(montage.electrodes.find(e => e.name === 'Cz'), null, 2));
console.log();

// Assertions.
const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } else { console.log('PASS:', msg); } };
const byName = Object.fromEntries(montage.electrodes.map(e => [e.name, e]));
assert(montage.count === 32, '32 channels loaded (1 n/a row dropped)');
assert(!byName.BAD, 'n/a row skipped');
assert(Math.abs(Math.hypot(byName.Cz.ux, byName.Cz.uy, byName.Cz.uz) - 1) < 1e-6, 'Cz ux/uy/uz is unit vector');
assert(byName.Cz.uz > 0.95, 'Cz points to +Z (vertex)');
assert(byName.Fp1.uy > 0.5, 'Fp1 points anterior (+Y)');
assert(byName.Oz.uy < -0.5, 'Oz points posterior (-Y)');
assert(byName.T7.ux < -0.5, 'T7 points left (-X)');
assert(byName.T8.ux > 0.5, 'T8 points right (+X)');
assert(byName.Fp1.region === 'frontal', 'Fp1 region is frontal');
assert(byName.Oz.region === 'occipital', 'Oz region is occipital');
assert(byName.Cz.region === 'central', 'Cz region is central');
assert(byName.Pz.region === 'parietal', 'Pz region is parietal');
// Sphere radius: CapTrak head models are usually ~85-100mm = 0.085-0.1m.
assert(montage.sphere.R > 0.07 && montage.sphere.R < 0.12, `sphere R in reasonable range (${montage.sphere.R.toFixed(3)}m)`);

// --- SVG generation, mirroring topo2d.js exactly ---------------
const VB = 1.25;
const REGION_COLORS = {
  frontal:   '#6e8bc9',
  central:   '#5bab8b',
  parietal:  '#c9a24a',
  occipital: '#c46a57',
  reference: '#7a7a85',
  egi:       '#9075b8',
  other:     '#8a8a85',
};
// topo2d.js projection — copied verbatim (without SVG-specific transforms).
function project(u) {
  const uz = Math.max(-1, Math.min(1, u.uz));
  const theta = Math.acos(uz);
  const az = Math.atan2(u.ux, u.uy);
  const r = Math.min(1, theta / (Math.PI / 2));
  return { x: r * Math.sin(az), y: -r * Math.cos(az) };
}

const parts = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-VB} ${-VB} ${VB*2} ${VB*2}" width="720" height="720" style="background:#faf9f5;font-family:-apple-system,BlinkMacSystemFont,sans-serif">`);
parts.push(`<defs><style>.lbl{font-size:0.034px;font-weight:500;fill:#17181a;pointer-events:none;paint-order:stroke;stroke:#faf9f5;stroke-width:0.014;stroke-linejoin:round}.region{font-size:0.05px;fill:#8a8a85;letter-spacing:0.04em}</style></defs>`);
// Head circle + nose + ears
parts.push(`<circle cx="0" cy="0" r="1" fill="#f7f6f2" stroke="#17181a" stroke-width="0.012"/>`);
// 10-10 reference rings (new in topo2d.js?v=4)
for (const rr of [0.25, 0.5, 0.75]) {
  parts.push(`<circle cx="0" cy="0" r="${rr}" fill="none" stroke="#b5b8bd" stroke-width="0.003" stroke-dasharray="0.012 0.018" opacity="0.45"/>`);
}
parts.push(`<path d="M -0.15 -0.992 Q -0.06 -1.08, 0 -1.12 Q 0.06 -1.08, 0.15 -0.992" fill="none" stroke="#17181a" stroke-width="0.012" stroke-linecap="round"/>`);
parts.push(`<path d="M -0.99 -0.13 C -1.05 -0.09, -1.07 0.02, -1.06 0.09 C -1.05 0.15, -1.03 0.18, -0.995 0.18" fill="none" stroke="#17181a" stroke-width="0.012" stroke-linecap="round"/>`);
parts.push(`<path d="M 0.99 -0.13 C 1.05 -0.09, 1.07 0.02, 1.06 0.09 C 1.05 0.15, 1.03 0.18, 0.995 0.18" fill="none" stroke="#17181a" stroke-width="0.012" stroke-linecap="round"/>`);
// Crosshairs
parts.push(`<line x1="0" y1="-1" x2="0" y2="1" stroke="#aaa" stroke-width="0.004" stroke-dasharray="0.02 0.02" opacity="0.35"/>`);
parts.push(`<line x1="-1" y1="0" x2="1" y2="0" stroke="#aaa" stroke-width="0.004" stroke-dasharray="0.02 0.02" opacity="0.35"/>`);
// Landmarks
parts.push(`<text x="0" y="-1.06" text-anchor="middle" dominant-baseline="alphabetic" class="region">NASION</text>`);
parts.push(`<text x="0" y="1.09" text-anchor="middle" dominant-baseline="hanging" class="region">INION</text>`);
parts.push(`<text x="-1.08" y="0" text-anchor="end" dominant-baseline="middle" class="region">LPA</text>`);
parts.push(`<text x="1.08" y="0" text-anchor="start" dominant-baseline="middle" class="region">RPA</text>`);

for (const el of montage.electrodes) {
  const p = project(el);
  const c = REGION_COLORS[el.region] || REGION_COLORS.other;
  parts.push(`<circle cx="${p.x.toFixed(4)}" cy="${p.y.toFixed(4)}" r="0.028" fill="${c}" stroke="#17181a" stroke-opacity="0.45" stroke-width="0.005"/>`);
  parts.push(`<text x="${p.x.toFixed(4)}" y="${(p.y - 0.04).toFixed(4)}" text-anchor="middle" dominant-baseline="alphabetic" class="lbl">${el.name}</text>`);
}

// Caption
parts.push(`<text x="${-VB + 0.05}" y="${VB - 0.05}" font-size="0.055" fill="#17181a" font-weight="600">Evidence: BIDSLoader + topo2d projection</text>`);
parts.push(`<text x="${-VB + 0.05}" y="${VB - 0.005}" font-size="0.04" fill="#8a8a85">${montage.count}ch · ${montage.space} · input mm → fit sphere R=${(montage.sphere.R * 1000).toFixed(1)}mm</text>`);
parts.push(`</svg>`);

const outPath = path.join(__dirname, 'evidence.svg');
fs.writeFileSync(outPath, parts.join('\n'));
console.log('\nWrote', outPath);
console.log('Open it in a browser to verify the 10-20 layout renders correctly.');
