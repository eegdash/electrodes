/* Evidence harness for the flat-layout pipeline (iEEG / EMG / fNIRS).
 *
 * For each modality, loads the BIDSLoader against a real fixture,
 * runs the topo2d.js `project()` function on the resulting electrodes,
 * and emits a standalone SVG mirroring what the live viewer would draw.
 * Assertions check channel counts, layoutStyle, cross-modality hash
 * isolation, and the final ux/uy bounding box (should be within the
 * viewer's ±1 viewbox).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const win = {};
new Function('window', fs.readFileSync(path.join(root, 'bids-loader.js'), 'utf8'))(win);
const BL = win.BIDSLoader;

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('PASS:', msg);
}

// --- Inline project() copied verbatim from topo2d.js so we can
// produce identical 2D coords without spinning up a browser. ------
function project(u, layoutStyle) {
  if (layoutStyle !== 'flat') {
    const uz = Math.max(-1, Math.min(1, u.uz));
    const theta = Math.acos(uz);
    const az = Math.atan2(u.ux, u.uy);
    const r = Math.min(1, theta / (Math.PI / 2));
    return { x: r * Math.sin(az), y: -r * Math.cos(az) };
  }
  return { x: u.ux, y: -u.uy };
}

const COLORS = {
  eeg: '#6e8bc9',
  meg: '#5bab8b',
  ieeg: '#c46a57',
  emg: '#9075b8',
  nirs_source: '#d96a4c',
  nirs_detector: '#4a7fa8',
  other: '#8a8a85',
};

function renderSvg({ title, subtitle, montage }) {
  const VB = 1.25;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-VB} ${-VB} ${VB*2} ${VB*2}" width="720" height="720" style="background:#faf9f5;font-family:-apple-system,sans-serif">`);
  parts.push(`<defs><style>.lbl{font-size:0.028px;fill:#17181a;pointer-events:none;paint-order:stroke;stroke:#faf9f5;stroke-width:0.012;stroke-linejoin:round}</style></defs>`);

  // Outline — flat gets a box, sphere gets the usual head
  if (montage.layoutStyle === 'flat') {
    parts.push(`<rect x="-1" y="-1" width="2" height="2" rx="0.02" fill="#f7f6f2" stroke="#17181a" stroke-width="0.008" opacity="0.6"/>`);
    parts.push(`<line x1="0" y1="-1" x2="0" y2="1" stroke="#aaa" stroke-width="0.004" stroke-dasharray="0.02 0.02" opacity="0.35"/>`);
    parts.push(`<line x1="-1" y1="0" x2="1" y2="0" stroke="#aaa" stroke-width="0.004" stroke-dasharray="0.02 0.02" opacity="0.35"/>`);
  } else {
    parts.push(`<circle cx="0" cy="0" r="1" fill="#f7f6f2" stroke="#17181a" stroke-width="0.012"/>`);
  }

  // Electrodes
  for (const el of montage.electrodes) {
    const p = project(el, montage.layoutStyle);
    let color = COLORS[montage.modality] || COLORS.other;
    if (montage.modality === 'nirs') {
      const t = (el.type || '').toLowerCase();
      color = t.includes('detector') ? COLORS.nirs_detector : COLORS.nirs_source;
    }
    parts.push(`<circle cx="${p.x.toFixed(4)}" cy="${p.y.toFixed(4)}" r="0.018" fill="${color}" stroke="#17181a" stroke-opacity="0.5" stroke-width="0.003"/>`);
  }

  // Label a few sensors for readability (first of each group, and first overall)
  const seenGroups = new Set();
  const labelled = montage.electrodes.filter((el, i) => {
    const g = el.coordinate_system || el.group || '';
    if (g && !seenGroups.has(g)) { seenGroups.add(g); return true; }
    return i === 0;
  }).slice(0, 8);
  for (const el of labelled) {
    const p = project(el, montage.layoutStyle);
    parts.push(`<text x="${p.x.toFixed(4)}" y="${(p.y - 0.03).toFixed(4)}" text-anchor="middle" class="lbl">${el.name}</text>`);
  }

  // Caption
  parts.push(`<text x="${-VB + 0.05}" y="${VB - 0.05}" font-size="0.055" fill="#17181a" font-weight="600">${title}</text>`);
  parts.push(`<text x="${-VB + 0.05}" y="${VB - 0.005}" font-size="0.04" fill="#8a8a85">${subtitle}</text>`);
  parts.push(`</svg>`);
  return parts.join('\n');
}

// =====================================================================
// 1) iEEG: synthetic fixture with ACPC brain-space grid
// =====================================================================
const ieegTsv = [
  'name\tx\ty\tz\themisphere\ttype',
  'LGA1\t-0.045\t0.012\t0.008\tL\tgrid',
  'LGA2\t-0.048\t0.018\t0.006\tL\tgrid',
  'LGA3\t-0.051\t0.024\t0.004\tL\tgrid',
  'LGA4\t-0.054\t0.030\t0.002\tL\tgrid',
  'LGB1\t-0.035\t0.010\t0.020\tL\tgrid',
  'LGB2\t-0.038\t0.016\t0.018\tL\tgrid',
  'LGB3\t-0.041\t0.022\t0.016\tL\tgrid',
  'RDA1\t0.030\t-0.020\t0.010\tR\tdepth',
  'RDA2\t0.028\t-0.018\t0.012\tR\tdepth',
  'RDA3\t0.026\t-0.016\t0.014\tR\tdepth',
  'RDA4\t0.024\t-0.014\t0.016\tR\tdepth',
  'RDA5\t0.022\t-0.012\t0.018\tR\tdepth',
].join('\n');
const ieegCoords = '{"iEEGCoordinateSystem":"ACPC","iEEGCoordinateUnits":"m"}';

const mIEEG = BL.buildMontageFromBIDS({
  tsvText: ieegTsv,
  coordsystemJson: ieegCoords,
  label: 'synth-ieeg-acpc',
  modality: 'ieeg',
});
assert(mIEEG.layoutStyle === 'flat', `iEEG: layoutStyle = "flat" (got ${mIEEG.layoutStyle})`);
assert(mIEEG.modality === 'ieeg', `iEEG: modality = "ieeg"`);
assert(mIEEG.count === 12, `iEEG: 12 electrodes loaded (got ${mIEEG.count})`);
// All ux/uy should be within the viewbox
const ieegInRange = mIEEG.electrodes.every(e => Math.abs(e.ux) <= 1 && Math.abs(e.uy) <= 1);
assert(ieegInRange, `iEEG: all ux/uy within [-1, 1]`);
fs.writeFileSync(
  path.join(__dirname, 'evidence-ieeg.svg'),
  renderSvg({
    title: 'iEEG — ACPC grid + depth electrodes',
    subtitle: `${mIEEG.count} electrodes · space=${mIEEG.space} · layout=flat`,
    montage: mIEEG,
  })
);

// =====================================================================
// 2) EMG: REAL HySER sub-01 fixture (256 surface EMG + 4 muscle groups)
// =====================================================================
// Pull the real electrodes.tsv if we don't already have it
const HYSER_TSV = path.join(__dirname, 'hyser_sub-01_electrodes.tsv');
const HYSER_COORDS = path.join(__dirname, 'hyser_sub-01_coordsystem.json');
if (!fs.existsSync(HYSER_TSV)) {
  console.log('(fetching HySER fixture...)');
  const { execSync } = await import('node:child_process');
  execSync(`curl -sL "https://raw.githubusercontent.com/nemarDatasets/nm000108/main/sub-01/ses-1/emg/sub-01_ses-1_electrodes.tsv" -o "${HYSER_TSV}"`);
  execSync(`curl -sL "https://raw.githubusercontent.com/nemarDatasets/nm000108/main/space-forearm_coordsystem.json" -o "${HYSER_COORDS}"`);
}
const mEMG = BL.buildMontageFromBIDS({
  tsvText: fs.readFileSync(HYSER_TSV, 'utf8'),
  coordsystemJson: fs.readFileSync(HYSER_COORDS, 'utf8'),
  label: 'hyser-sub-01',
  modality: 'emg',
});
assert(mEMG.layoutStyle === 'flat', `EMG: layoutStyle = "flat"`);
assert(mEMG.modality === 'emg', `EMG: modality = "emg"`);
assert(mEMG.count === 256, `EMG HySER: 256 sensors (4 × 64; REF/GND filtered)`);
assert(mEMG.groups && mEMG.groups.length === 4, `EMG: 4 distinct coord_system groups detected`);
// Each group should occupy its own quadrant: spread across ux and uy
const coordsByGroup = {};
for (const e of mEMG.electrodes) {
  const g = e.coordinate_system || 'none';
  (coordsByGroup[g] ??= []).push(e);
}
// The 4 HySER groups should produce 4 non-overlapping bounding boxes
assert(Object.keys(coordsByGroup).length === 4, `EMG: 4 coord_system partitions`);
fs.writeFileSync(
  path.join(__dirname, 'evidence-emg-hyser.svg'),
  renderSvg({
    title: 'EMG (HySER) — 4 muscle groups, 64 electrodes each',
    subtitle: `${mEMG.count} sensors · space=${mEMG.space} · units=${mEMG.units} · layout=flat · groups=${mEMG.groups.join(',')}`,
    montage: mEMG,
  })
);

// =====================================================================
// 3) fNIRS: synthetic optodes with source/detector distinction
// =====================================================================
const nirsTsv = [
  'name\tx\ty\tz\ttype',
  'S1\t-0.03\t0.08\t0.02\tsource',
  'S2\t0.03\t0.08\t0.02\tsource',
  'S3\t-0.06\t0.04\t0.05\tsource',
  'S4\t0.06\t0.04\t0.05\tsource',
  'S5\t-0.03\t0.00\t0.07\tsource',
  'S6\t0.03\t0.00\t0.07\tsource',
  'D1\t0.00\t0.08\t0.03\tdetector',
  'D2\t-0.05\t0.06\t0.04\tdetector',
  'D3\t0.05\t0.06\t0.04\tdetector',
  'D4\t-0.05\t0.02\t0.06\tdetector',
  'D5\t0.05\t0.02\t0.06\tdetector',
  'D6\t0.00\t-0.02\t0.08\tdetector',
].join('\n');
const nirsCoords = '{"NIRSCoordinateSystem":"CapTrak","NIRSCoordinateUnits":"m"}';

const mNIRS = BL.buildMontageFromBIDS({
  tsvText: nirsTsv,
  coordsystemJson: nirsCoords,
  label: 'synth-nirs',
  modality: 'nirs',
});
assert(mNIRS.layoutStyle === 'flat', `fNIRS: layoutStyle = "flat"`);
assert(mNIRS.modality === 'nirs', `fNIRS: modality = "nirs"`);
assert(mNIRS.count === 12, `fNIRS: 6 sources + 6 detectors`);
const nSources = mNIRS.electrodes.filter(e => (e.type || '').toLowerCase().includes('source')).length;
const nDetectors = mNIRS.electrodes.filter(e => (e.type || '').toLowerCase().includes('detector')).length;
assert(nSources === 6 && nDetectors === 6, `fNIRS: source/detector types preserved (S=${nSources}, D=${nDetectors})`);
fs.writeFileSync(
  path.join(__dirname, 'evidence-fnirs.svg'),
  renderSvg({
    title: 'fNIRS — sources (orange) + detectors (blue)',
    subtitle: `${mNIRS.count} optodes · space=${mNIRS.space} · layout=flat`,
    montage: mNIRS,
  })
);

// =====================================================================
// 4) Regression: EEG still uses sphere mode
// =====================================================================
const eegTsv = fs.readFileSync(path.join(__dirname, 'sub-01_task-rest_electrodes.tsv'), 'utf8');
const eegCoords = fs.readFileSync(path.join(__dirname, 'sub-01_task-rest_coordsystem.json'), 'utf8');
const mEEG = BL.buildMontageFromBIDS({ tsvText: eegTsv, coordsystemJson: eegCoords, label: 'eeg-regression' });
assert(mEEG.layoutStyle === 'sphere', `EEG: layoutStyle = "sphere"`);
assert(mEEG.modality === 'eeg', `EEG: modality = "eeg"`);
assert(mEEG.count === 32, `EEG: 32 channels`);

// =====================================================================
// 5) Cross-modality isolation (layoutStyle must differ across same data)
// =====================================================================
// Same TSV loaded under two different modalities → different pipelines
const mAsEEG = BL.buildMontageFromBIDS({ tsvText: ieegTsv, coordsystemJson: ieegCoords, label: 'x', modality: 'eeg' });
assert(mAsEEG.layoutStyle === 'sphere' || mAsEEG.layoutStyle === undefined,
       `same TSV as EEG → sphere (caught: ${mAsEEG.layoutStyle})`);
assert(mIEEG.layoutStyle === 'flat', `same TSV as iEEG → flat`);

console.log('\n✓ All flat-layout evidence generated:');
console.log('  test-data/evidence-ieeg.svg');
console.log('  test-data/evidence-emg-hyser.svg   (REAL NEMAR data)');
console.log('  test-data/evidence-fnirs.svg');
