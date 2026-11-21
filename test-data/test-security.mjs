/* Regression checks for XSS hardening, CSP/preload contract, browser floor,
 * and BIDS TSV/registry sanitization. Runs in plain Node with zero npm deps. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const bidsLoaderSrc = fs.readFileSync(path.join(root, 'bids-loader.js'), 'utf8');
const topo2dSrc = fs.readFileSync(path.join(root, 'topo2d.js'), 'utf8');

// 1. CSP sits above every <script> and enforces Trusted Types.
const cspMatch = indexHtml.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/?>/);
assert.ok(cspMatch, 'index.html must include a Content-Security-Policy meta tag');
const firstScriptIdx = indexHtml.indexOf('<script');
assert.ok(cspMatch.index < firstScriptIdx, 'CSP meta must precede every <script> tag so all scripts execute under the policy');
assert.match(cspMatch[1], /require-trusted-types-for 'script'/, 'CSP must enforce Trusted Types for DOM sinks');
assert.match(cspMatch[1], /trusted-types 'none'/, 'CSP must forbid creating Trusted Types policies');

// 2. Every <link rel="preload" as="script"> matches an actual <script src="..."> in <head>.
const headHtml = indexHtml.slice(0, indexHtml.indexOf('</head>'));
const preloadHrefs = [...headHtml.matchAll(/<link\s+rel="preload"\s+href="([^"]+)"\s+as="script"\s*\/?>/g)].map(m => m[1]);
const headScripts = [...headHtml.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map(m => m[1]);
assert.ok(preloadHrefs.length >= 2, 'head must preload scripts queued behind montages.js');
for (const href of preloadHrefs) {
  assert.ok(headScripts.includes(href), `preload href "${href}" must match a <script src> in <head>`);
}

// 3. No HTML-string sinks or Safari-13.1-breaking replaceChildren() in app code.
for (const [name, src] of [['index.html', indexHtml], ['bids-loader.js', bidsLoaderSrc], ['topo2d.js', topo2dSrc]]) {
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const banned of [/\binnerHTML\b/, /\bouterHTML\b/, /\binsertAdjacentHTML\b/, /\bdocument\.write\b/, /\breplaceChildren\s*\(/]) {
    assert.doesNotMatch(codeOnly, banned, `${name} must not use ${banned}`);
  }
}

// 4. BIDSLoader sanitizes control characters, preserves HTML payloads as plain text,
//    coerces non-string registry type/material, and preserves real sensor types/materials.
const win = {};
new Function('window', bidsLoaderSrc)(win);
const BL = win.BIDSLoader;

const regMontage = BL.buildMontageFromRegistryDoc({
  hash: 'deadbeefcafe0000',
  modality: 'nirs',
  space_declared: 'CapTrak',
  units_declared: 'm',
  sensors: [
    { name: '<img src=x onerror=alert(1)>', x: 0, y: 0.09, z: 0, type: 'source', material: 'Silica' },
    { name: 'Fp2\tINJECT\nROW', x: -0.03, y: 0.08, z: 0.02, type: 42, material: ['bad'] },
    { name: 'Cz\rCARRIAGE', x: 0, y: 0, z: 0.09, type: true, material: null },
    { name: '-RV1', x: 0.03, y: -0.08, z: 0.02, type: 'detector', material: '' },
  ],
});
assert.equal(regMontage.electrodes[0].name, '<img src=x onerror=alert(1)>');
assert.equal(regMontage.electrodes[0].type, 'source');
assert.equal(regMontage.electrodes[0].material, 'Silica');
assert.equal(regMontage.electrodes[1].name, 'Fp2 INJECT ROW');
assert.equal(regMontage.electrodes[1].type, 'NIRS');
assert.equal(regMontage.electrodes[1].material, '');
assert.equal(regMontage.electrodes[2].name, 'Cz CARRIAGE');
assert.equal(regMontage.electrodes[3].name, '-RV1');

const tsvMontage = BL.buildMontageFromBIDS({
  tsvText: [
    'name\tx\ty\tz\ttype\tmaterial',
    'Fpz\rEVIL\t0\t0.09\t0\tEOG\tTin',
    'Oz\t0\t-0.09\t0\tEEG\tAg/AgCl',
    'T7\t-0.09\t0\t0\tEEG\tAg/AgCl',
    'T8\t0.09\t0\t0\tEEG\tAg/AgCl',
    'Cz\t0\t0\t0.09\tEEG\tAg/AgCl',
  ].join('\n'),
  coordsystemJson: { EEGCoordinateSystem: 'CapTrak', EEGCoordinateUnits: 'm' },
  label: 'test',
});
assert.equal(tsvMontage.electrodes[0].name, 'Fpz EVIL');
assert.equal(tsvMontage.electrodes[0].type, 'EOG');
assert.equal(tsvMontage.electrodes[0].material, 'Tin');

console.log('PASS: all security, CSP/preload, browser-floor, and BIDS sanitization checks');
