/* ============================================================
   bids-loader.js — parse BIDS electrodes.tsv + coordsystem.json
   and produce a montage object in the same shape montages.js
   exposes, so the rest of the app consumes it unchanged.

   Pipeline: parse → unit-scale → sphere-fit → unit-normalize to
   (ux, uy, uz). The renderers already speak (ux, uy, uz).

   Sphere fit mirrors MNE's two paths:
     1. EEGLAB 4-point: radius = mean(|T7.x|, |T8.x|, |Fpz.y|, |Oz.y|)
        centered on the mean of those four electrodes.
     2. Linear least-squares fallback: solve [2x 2y 2z 1]·u = x²+y²+z².
   ============================================================ */
(function () {
  'use strict';

  const api = {};

  // ---- TSV parsing --------------------------------------------
  api.parseElectrodesTSV = function (text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) throw new Error('electrodes.tsv has no rows');

    const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
    const col = (name) => headers.indexOf(name);
    const iName = col('name'), iX = col('x'), iY = col('y'), iZ = col('z');
    if (iName < 0 || iX < 0 || iY < 0 || iZ < 0) {
      throw new Error('electrodes.tsv is missing one of: name, x, y, z');
    }
    const iType = col('type'), iMat = col('material');

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split('\t');
      const name = (c[iName] || '').trim();
      const x = parseFloat(c[iX]);
      const y = parseFloat(c[iY]);
      const z = parseFloat(c[iZ]);
      // BIDS uses "n/a" for missing; parseFloat → NaN → skip.
      if (!name || !isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
      rows.push({
        name, x, y, z,
        type: iType >= 0 ? (c[iType] || '').trim() : '',
        material: iMat >= 0 ? (c[iMat] || '').trim() : '',
      });
    }
    if (rows.length < 4) throw new Error('Need at least 4 electrodes with finite x,y,z');
    return rows;
  };

  // ---- coordsystem.json ---------------------------------------
  api.parseCoordsystem = function (jsonOrText) {
    const obj = typeof jsonOrText === 'string' ? JSON.parse(jsonOrText) : jsonOrText;
    const prefix = ['EEG', 'iEEG', 'MEG'].find(p => obj[p + 'CoordinateSystem']) || 'EEG';
    return {
      space: obj[prefix + 'CoordinateSystem'] || 'Other',
      units: (obj[prefix + 'CoordinateUnits'] || 'm').toLowerCase(),
      landmarks: obj.AnatomicalLandmarkCoordinates || null,
    };
  };

  function declaredUnitScale(u) {
    if (u === 'mm') return 0.001;
    if (u === 'cm') return 0.01;
    return 1;                       // 'm' or unknown → assume meters
  }

  // BIDS coordinate-system conventions differ on where +X and +Y point.
  // Our 2D/3D viewer assumes RAS+ (+X=right, +Y=anterior, +Z=up). EEGLAB,
  // CTF, 4D and KIT use ALS (+X=anterior, +Y=left, +Z=up). Datasets declared
  // in ALS-style frames need to be rotated before the sphere fit, otherwise
  // the whole cap appears rotated 90° in the viewer. CapTrak, MNI*, ACPC,
  // Talairach, ScanRAS and fsaverage are already RAS+; everything else
  // defaults to identity.
  //
  // See BIDS appendix on coordinate systems:
  //   https://bids-specification.readthedocs.io/en/stable/appendices/coordinate-systems.html
  //
  // Note: ds002578 declares "CTF" but the maintainer has publicly acknowledged
  // the label is wrong and the data is really in EEGLAB convention
  // (same ALS axes, so the rotation applies either way).
  function axisTransformForSpace(space) {
    if (!space) return null;
    const s = space.toUpperCase();
    if (s === 'EEGLAB' || s === 'CTF' || s === '4D' || s === 'KIT') {
      return {
        name: 'ALS→RAS+',
        apply: (e) => ({ ...e, x: -e.y, y: e.x, z: e.z }),
      };
    }
    return null;                    // identity for RAS+ frames and unknown
  }

  // Infer the scale that turns a raw sphere radius into meters, based on what
  // is physically plausible for a human head (~40-150 mm). We trust the data
  // over coordsystem.json, which lies often enough in the wild (see ds002578
  // which declares mm but stores meters).
  function inferMetersScaleFromRadius(rawR) {
    const candidates = [
      { unit: 'm',  scale: 1,     min: 0.04, max: 0.20 },
      { unit: 'mm', scale: 0.001, min: 40,   max: 200 },
      { unit: 'cm', scale: 0.01,  min: 4,    max: 20 },
    ];
    for (const c of candidates) {
      if (rawR >= c.min && rawR <= c.max) return c;
    }
    return null;
  }

  // ---- Sphere fits --------------------------------------------
  function fitSphereEeglab(els) {
    const by = {};
    for (const e of els) by[e.name.toUpperCase()] = e;
    const fpz = by.FPZ, oz = by.OZ;
    const t7  = by.T7 || by.T3;     // T3/T4 are the pre-2005 names
    const t8  = by.T8 || by.T4;
    if (!fpz || !oz || !t7 || !t8) return null;
    const cx = (fpz.x + oz.x + t7.x + t8.x) / 4;
    const cy = (fpz.y + oz.y + t7.y + t8.y) / 4;
    const cz = (fpz.z + oz.z + t7.z + t8.z) / 4;
    const r  = (Math.abs(t7.x - cx) + Math.abs(t8.x - cx) +
                Math.abs(fpz.y - cy) + Math.abs(oz.y - cy)) / 4;
    if (!isFinite(r) || r <= 0) return null;
    return [cx, cy, cz, r];
  }

  function fitSphereLstsq(els) {
    // Solve normal equations AtA·u = Atb for 4-unknown linear system.
    const AtA = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
    const Atb = [0, 0, 0, 0];
    for (const e of els) {
      const a = [2 * e.x, 2 * e.y, 2 * e.z, 1];
      const b = e.x * e.x + e.y * e.y + e.z * e.z;
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) AtA[i][j] += a[i] * a[j];
        Atb[i] += a[i] * b;
      }
    }
    const u = gaussSolve4(AtA, Atb);
    if (!u) return null;
    const [cx, cy, cz, d] = u;
    const r = Math.sqrt(cx * cx + cy * cy + cz * cz + d);
    if (!isFinite(r) || r <= 0) return null;
    return [cx, cy, cz, r];
  }

  function gaussSolve4(A, b) {
    const M = [
      [A[0][0], A[0][1], A[0][2], A[0][3], b[0]],
      [A[1][0], A[1][1], A[1][2], A[1][3], b[1]],
      [A[2][0], A[2][1], A[2][2], A[2][3], b[2]],
      [A[3][0], A[3][1], A[3][2], A[3][3], b[3]],
    ];
    for (let i = 0; i < 4; i++) {
      let p = i;
      for (let k = i + 1; k < 4; k++) {
        if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
      }
      if (Math.abs(M[p][i]) < 1e-12) return null;
      if (p !== i) { const t = M[i]; M[i] = M[p]; M[p] = t; }
      for (let k = i + 1; k < 4; k++) {
        const f = M[k][i] / M[i][i];
        for (let j = i; j < 5; j++) M[k][j] -= f * M[i][j];
      }
    }
    const x = [0, 0, 0, 0];
    for (let i = 3; i >= 0; i--) {
      let s = M[i][4];
      for (let j = i + 1; j < 4; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  }

  api.fitSphere = function (els) {
    return fitSphereEeglab(els) || fitSphereLstsq(els);
  };

  // ---- Region inference ---------------------------------------
  // Two strategies. Labels like "Fp1", "Cz", "PO3" tell us the region directly
  // via prefix. Dataset-specific labels like BioSemi's "A1..H32" or "CH17"
  // don't carry that information, so we fall back to a position-based
  // quadrant map. The loader picks one per montage based on how many labels
  // actually look 10-20-shaped.

  // Standard 10-20 / 10-10 / 10-05 letter prefixes, plus the reference/EGI
  // special cases the built-in montages use.
  const TEN_TWENTY_PREFIXES = new Set([
    'FP', 'AF', 'F', 'FC', 'FT', 'C', 'T', 'CP', 'TP', 'P', 'PO', 'O',
    'N', 'I', 'A',                  // landmarks + ear references
    'FFC', 'AFF', 'AFP', 'FCC', 'CCP', 'CPP', 'PPO', 'POO',  // 10-05 half-rings
    'E',                            // EGI HydroCel
  ]);

  function prefixOf(name) {
    const m = name.match(/^([A-Za-z]+)/);
    let p = m ? m[1].toUpperCase() : '';
    if (p.length > 1 && p.endsWith('Z')) p = p.slice(0, -1);
    return p;
  }

  function regionByLabel(name) {
    const p = prefixOf(name);
    if (p === 'NZ' || p === 'N' || p === 'FP' || p === 'AF') return 'frontal';
    if (p === 'F' || p === 'FC' || p === 'FT' || p === 'FFC' || p === 'AFF' || p === 'AFP') return 'frontal';
    if (p === 'T' || p === 'C' || p === 'FCC' || p === 'CCP') return 'central';
    if (p === 'CP' || p === 'TP' || p === 'CPP') return 'parietal';
    if (p === 'P' || p === 'PPO') return 'parietal';
    if (p === 'PO' || p === 'POO' || p === 'O' || p === 'IZ' || p === 'I') return 'occipital';
    if (p === 'A') return 'reference';
    if (p === 'E') return 'egi';
    return 'other';
  }

  // Region from position in viewer RAS+ (+X=right, +Y=anterior, +Z=vertex).
  // Ordered so anterior-posterior wins over elevation, which matches how
  // scalp anatomy is usually described.
  function regionByPosition(ux, uy, uz) {
    if (uy < -0.7) return 'occipital';
    if (uy > 0.4) return 'frontal';
    if (uy < -0.15 && uz > 0.3) return 'parietal';
    if (uz > 0.5) return 'central';
    return 'central';                         // lateral / lower — temporal-like
  }

  // Decide which strategy to use. If most labels match known 10-20/10-05/EGI
  // prefixes, label-based is more informative. Otherwise fall back to
  // position-based so datasets with opaque labels (BioSemi ABCD, generic
  // CH17) still get meaningful color coding.
  function pickRegionStrategy(electrodes) {
    if (electrodes.length === 0) return 'position';
    let matches = 0;
    for (const e of electrodes) {
      if (TEN_TWENTY_PREFIXES.has(prefixOf(e.name))) matches++;
    }
    return matches / electrodes.length >= 0.7 ? 'label' : 'position';
  }

  // ---- Main entry ---------------------------------------------
  // Returns { label, count, electrodes, space, units, sphere }
  // matching the shape of MONTAGES[key].
  api.buildMontageFromBIDS = function ({ tsvText, coordsystemJson, label }) {
    const parsed = api.parseElectrodesTSV(tsvText);
    const meta = coordsystemJson
      ? api.parseCoordsystem(coordsystemJson)
      : { space: 'Other', units: null, landmarks: null };

    // Step 0: axis convention. Rotate into RAS+ if the declared space uses
    // ALS (EEGLAB/CTF/4D/KIT). The transform is a pure permutation + sign
    // flip, so it's safe to apply before sphere fitting.
    const axisXform = axisTransformForSpace(meta.space);
    const raw = axisXform ? parsed.map(axisXform.apply) : parsed;

    // Step 1: fit a sphere in whatever units the TSV actually uses.
    const rawSphere = api.fitSphere(raw);
    if (!rawSphere) {
      throw new Error(
        'Could not fit a sphere to the electrodes. Need either ' +
        'Fpz/Oz/T7/T8 (EEGLAB method) or at least 4 non-coplanar points.'
      );
    }

    // Step 2: infer the scale from the fitted radius, not the metadata.
    // The data is the ground truth; coordsystem.json frequently lies about
    // units. If the raw radius is a plausible head radius in m/mm/cm we pick
    // the matching scale; otherwise we bail with a clear error.
    const inferred = inferMetersScaleFromRadius(rawSphere[3]);
    if (!inferred) {
      throw new Error(
        `Could not infer coordinate units: fitted radius is ${rawSphere[3].toFixed(3)} ` +
        `(expected 0.04–0.20 m, 40–200 mm, or 4–20 cm). ` +
        `Check the TSV for missing origin translation or axis swaps.`
      );
    }

    // Step 3: apply the inferred scale. Everything below is meters.
    const s = inferred.scale;
    const scaled = raw.map(e => ({ ...e, x: e.x * s, y: e.y * s, z: e.z * s }));
    const [cx, cy, cz, R] = rawSphere.map(v => v * s);

    // Flag a disagreement between declared and inferred units — useful for the
    // UI and for diagnosing datasets with bad coordsystem.json files.
    const declaredUnits = meta.units || null;
    const unitsMismatch = declaredUnits && declaredUnits !== inferred.unit;

    const regionStrategy = pickRegionStrategy(scaled);

    const electrodes = scaled.map(e => {
      const dx = e.x - cx, dy = e.y - cy, dz = e.z - cz;
      const r  = Math.hypot(dx, dy, dz) || R;
      const ux = dx / r, uy = dy / r, uz = dz / r;
      const region = regionStrategy === 'label'
        ? regionByLabel(e.name)
        : regionByPosition(ux, uy, uz);
      return {
        name: e.name,
        x: +dx.toFixed(5),
        y: +dy.toFixed(5),
        z: +dz.toFixed(5),
        ux, uy, uz,
        region,
        type: e.type || 'EEG',
        material: e.material || 'Ag/AgCl',
      };
    });

    return {
      label: label || `Loaded · ${electrodes.length}ch`,
      count: electrodes.length,
      electrodes,
      space: meta.space,
      units: 'm',                   // everything normalized to meters
      sphere: { cx: 0, cy: 0, cz: 0, R },   // centered after translation
      inferredUnits: inferred.unit,
      declaredUnits,
      unitsMismatch,
      axisTransform: axisXform ? axisXform.name : null,
      regionStrategy,
    };
  };

  window.BIDSLoader = api;
})();
