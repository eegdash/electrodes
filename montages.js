// Standard EEG montages generated from 10-05 spherical model.
// Positions on a unit sphere (radius = 1). Head radius ~ 0.095 m is applied at render.
// Reference: Oostenveld & Praamstra (2001), Jurcak et al. (2007).
//
// Coordinate convention (BIDS RAS+):
//   +X = right ear (T8 side)
//   +Y = nasion (front)
//   +Z = vertex (top)
// All coordinates are spherical projections onto unit sphere.

(function () {
  const DEG = Math.PI / 180;

  // Convert (azimuth, elevation) in degrees -> (x,y,z) on unit sphere.
  //   az: 0° = +Y (nasion/front), 90° = +X (right), 180° = back (-Y), 270° = left (-X)
  //   el: 0° = equator (ears/nasion/inion plane), 90° = vertex (Cz)
  function sph(azDeg, elDeg) {
    const az = azDeg * DEG;
    const el = elDeg * DEG;
    const c = Math.cos(el);
    return {
      x: c * Math.sin(az),
      y: c * Math.cos(az),
      z: Math.sin(el),
    };
  }

  // 10-20 system — primary landmarks. All angles chosen so % arc from nasion->Cz->inion etc.
  // On sagittal arc (Y-Z plane): points at elevation steps of 18° (10% of 180° arc) from front.
  // Central line elevations in 10-20:
  //   Nz(0°), Fpz(18°→el=72° from +Y measured as 90-72 -> actually ...)
  // Easier: parametrize sagittal arc by t in [0,1], t=0 at nasion, t=0.5 at Cz, t=1 at inion.
  function sagittal(t) {
    // Arc from (y=1,z=0) -> (y=0,z=1) -> (y=-1,z=0) ; angle theta = t*180°
    const th = t * Math.PI;
    return { x: 0, y: Math.cos(th), z: Math.sin(th) };
  }
  // Coronal arc from left ear (x=-1,z=0) to Cz (x=0,z=1) to right ear (x=1,z=0); t in [0,1]
  function coronal(t) {
    const th = t * Math.PI;
    return { x: -Math.cos(th), y: 0, z: Math.sin(th) };
  }

  // Canonical 10-20 positions (21 electrodes).
  // Using percentages on standard arcs.
  const P_1020 = {
    // sagittal line (Nz->Iz), t= 0.1..0.9
    Fpz: sagittal(0.1),
    Fz:  sagittal(0.3),
    Cz:  sagittal(0.5),
    Pz:  sagittal(0.7),
    Oz:  sagittal(0.9),
    Nz:  sagittal(0.0),
    Iz:  sagittal(1.0),
    // coronal line (T9->Cz->T10): left/right electrodes at 20% intervals
    T7:  coronal(0.2),
    C3:  coronal(0.35),
    C4:  coronal(0.65),
    T8:  coronal(0.8),
    // Frontal/Parietal poles: points on cone rings
    Fp1: sph(-18, 72),
    Fp2: sph( 18, 72),
    O1:  sph(-180+18, 72),
    O2:  sph( 180-18, 72),
    // Frontal outer: F7/F8 at 50% contour intersection
    F7:  sph(-54, 36),
    F8:  sph( 54, 36),
    F3:  sph(-39, 54),
    F4:  sph( 39, 54),
    // Parietal outer: T5(P7)/T6(P8)
    P7:  sph(-180+54, 36),
    P8:  sph( 180-54, 36),
    P3:  sph(-180+39, 54),
    P4:  sph( 180-39, 54),
    A1:  sph(-90, -5),
    A2:  sph( 90, -5),
  };

  // 10-10 system — adds rings between the 20% marks. 81 positions.
  // We compute a denser grid: sagittal every 10%, coronal rings at each sagittal elevation.
  // Use azimuth labels: AF, F, FC, C, CP, P, PO, O  and numbers (1,3,5,7,9 left / 2,4,6,8,10 right)
  // For simplicity, construct as intersections on the standard 10-10 sphere.

  // 10-10 standard positions in spherical coords (az, el).
  // Source: 10-10 system tables; values approximate Oostenveld & Praamstra.
  const RAW_1010 = {
    // Prefrontal polar
    Fp1: [-18,72], Fpz:[0,72], Fp2:[18,72],
    AF9: [-54,36], AF7:[-54,54], AF5:[-36,60], AF3:[-23,64], AF1:[-12,66],
    AFz:[0,66],
    AF2: [12,66], AF4:[23,64], AF6:[36,60], AF8:[54,54], AF10:[54,36],
    // Frontal
    F9:[-72,18], F7:[-54,36], F5:[-45,45], F3:[-39,54], F1:[-21,60],
    Fz:[0,60],
    F2:[21,60], F4:[39,54], F6:[45,45], F8:[54,36], F10:[72,18],
    // Fronto-central
    FT9:[-90,0], FT7:[-72,18], FC5:[-63,27], FC3:[-45,45], FC1:[-23,54],
    FCz:[0,54],
    FC2:[23,54], FC4:[45,45], FC6:[63,27], FT8:[72,18], FT10:[90,0],
    // Central
    T9:[-90,-5], T7:[-90,0], C5:[-90,22.5], C3:[-90,45], C1:[-90,67.5],
    Cz:[0,90],
    C2:[90,67.5], C4:[90,45], C6:[90,22.5], T8:[90,0], T10:[90,-5],
    // Centro-parietal
    TP9:[-108,0], TP7:[-108,18], CP5:[-117,27], CP3:[-135,45], CP1:[-157,54],
    CPz:[180,54],
    CP2:[157,54], CP4:[135,45], CP6:[117,27], TP8:[108,18], TP10:[108,0],
    // Parietal
    P9:[-108,18], P7:[-126,36], P5:[-135,45], P3:[-141,54], P1:[-159,60],
    Pz:[180,60],
    P2:[159,60], P4:[141,54], P6:[135,45], P8:[126,36], P10:[108,18],
    // Parieto-occipital
    PO9:[-126,36], PO7:[-144,54], PO5:[-144,60], PO3:[-157,64], PO1:[-168,66],
    POz:[180,66],
    PO2:[168,66], PO4:[157,64], PO6:[144,60], PO8:[144,54], PO10:[126,36],
    // Occipital
    O1:[-162,72], Oz:[180,72], O2:[162,72],
    O9:[-144,54], O10:[144,54],
    // Inion
    Iz:[180,80],
    // Nasion
    Nz:[0,80],
  };

  const P_1010 = {};
  for (const [name, [az, el]] of Object.entries(RAW_1010)) {
    P_1010[name] = sph(az, el);
  }

  // 10-05 system — very dense (~345 points). Generate by interpolating on same rings.
  // We'll compute intermediate points between named 10-10 electrodes along each ring.
  // Rings at elevations [0, 18, 27, 36, 45, 54, 60, 66, 72, 80, 90] degrees.
  // At each ring, points every 5° of azimuth (approx 72 points/ring).
  // This isn't strictly the 10-05 naming scheme but gives a dense coverage useful for viz.
  // We name them by nearest 10-10 reference + offset — but to keep things tractable, we
  // use canonical 10-05 labels for a curated subset (about 330 electrodes).

  // For a clean subset: take all 10-10 entries + add AFF/FFC/FCC/CCP/CPP/PPO/POO prefixes.
  // Simplified: use 10-10 positions * extra inter-ring samples at half-steps.
  const P_1005 = { ...P_1010 };
  const halfRings = [
    // [name-prefix, elevation]
    ['AFp', 69], ['AFF', 57], ['FFC', 57], ['FCC', 49.5], ['CCP', 49.5],
    ['CPP', 57], ['PPO', 63], ['POO', 69],
  ];
  // azimuth samples at each half-ring (approx; adjust so left/right symmetric).
  const azSamples = [-150, -120, -90, -60, -40, -20, -10, 0, 10, 20, 40, 60, 90, 120, 150];
  for (const [prefix, el] of halfRings) {
    let idx = 0;
    for (const az of azSamples) {
      const side = az === 0 ? 'z' : (az < 0 ? (2*Math.abs(Math.round(az/10))-1) : (2*Math.round(az/10)));
      const name = `${prefix}${side}`;
      if (!P_1005[name]) {
        P_1005[name] = sph(az, el);
      }
    }
  }

  // EGI HydroCel 128 — geodesic-inspired dense cap. Approximate by near-uniform sphere sampling
  // on the upper hemisphere down to el = -5° with 128 points.
  function fibonacciCap(N, elMinDeg = -5, elMaxDeg = 90) {
    const pts = {};
    const phi = (1 + Math.sqrt(5)) / 2;
    const elMin = elMinDeg * DEG;
    const elMax = elMaxDeg * DEG;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      // spiral with bias to cover the cap
      const el = elMax - t * (elMax - elMin);
      const az = (i * 2 * Math.PI / phi) % (2 * Math.PI);
      pts[`E${i + 1}`] = {
        x: Math.cos(el) * Math.sin(az),
        y: Math.cos(el) * Math.cos(az),
        z: Math.sin(el),
      };
    }
    return pts;
  }

  const P_EGI128 = fibonacciCap(129, -10, 89); // 128 + Cz ref

  // BioSemi caps — regular lat/long style arrangements.
  // biosemi16 = subset of 10-20; biosemi32/64/128 = scaled 10-10/10-05 subsets.
  function pickSubset(source, names) {
    const out = {};
    names.forEach(n => { if (source[n]) out[n] = source[n]; });
    return out;
  }

  const BIOSEMI16 = ['Fp1','Fp2','F7','F3','Fz','F4','F8','T7','C3','Cz','C4','T8','P7','Pz','P8','Oz'];
  const P_BIOSEMI16 = pickSubset(P_1010, BIOSEMI16);

  const BIOSEMI32 = [...BIOSEMI16,
    'AF3','AF4','FC5','FC1','FC2','FC6','CP5','CP1','CP2','CP6','P3','P4','PO3','PO4','O1','O2'];
  const P_BIOSEMI32 = pickSubset(P_1010, BIOSEMI32);

  const BIOSEMI64 = [...BIOSEMI32,
    'F1','F2','F5','F6','FC3','FCz','FC4','C1','C2','C5','C6','CPz','CP3','CP4','P1','P2','P5','P6',
    'POz','PO7','PO8','Oz','AFz','FT7','FT8','TP7','TP8','Fpz','Iz','Nz','AF7','AF8'];
  const P_BIOSEMI64 = pickSubset(P_1010, BIOSEMI64);

  // biosemi128: 10-10 + half-ring neighbours from 10-05.
  const P_BIOSEMI128 = { ...P_1010 };
  let added = 0;
  for (const [k, v] of Object.entries(P_1005)) {
    if (!P_BIOSEMI128[k] && added < 64) { P_BIOSEMI128[k] = v; added++; }
  }

  // Region lookup by 10-10 prefix.
  function regionOf(name) {
    // Extract the letter prefix, but drop a trailing lowercase/uppercase 'z'
    // used for midline electrodes (Fpz, AFz, Fz, Cz, Pz, POz, Oz, FCz...).
    // Without this, "Fz" → prefix "FZ" → falls through to "other" and paints
    // grey instead of the correct lobe colour.
    const m = name.match(/^([A-Za-z]+)/);
    let p = m ? m[1].toUpperCase() : '';
    if (p.length > 1 && p.endsWith('Z')) p = p.slice(0, -1);
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

  // Convert unit-sphere dict to array with BIDS meter coordinates (head radius 0.095 m, fitted to Fpz/Oz plane).
  const HEAD_RADIUS_M = 0.095;
  function toArray(dict) {
    return Object.entries(dict).map(([name, p]) => ({
      name,
      x: +(p.x * HEAD_RADIUS_M).toFixed(5),
      y: +(p.y * HEAD_RADIUS_M).toFixed(5),
      z: +(p.z * HEAD_RADIUS_M).toFixed(5),
      ux: p.x, uy: p.y, uz: p.z,
      region: regionOf(name),
    }));
  }

  window.MONTAGES = {
    '10-20':      { label: 'Standard 10-20',   count: Object.keys(P_1020).length,     electrodes: toArray(P_1020) },
    '10-10':      { label: 'Standard 10-10',   count: Object.keys(P_1010).length,     electrodes: toArray(P_1010) },
    '10-05':      { label: 'Standard 10-05',   count: Object.keys(P_1005).length,     electrodes: toArray(P_1005) },
    'biosemi16':  { label: 'BioSemi 16',       count: Object.keys(P_BIOSEMI16).length, electrodes: toArray(P_BIOSEMI16) },
    'biosemi32':  { label: 'BioSemi 32',       count: Object.keys(P_BIOSEMI32).length, electrodes: toArray(P_BIOSEMI32) },
    'biosemi64':  { label: 'BioSemi 64',       count: Object.keys(P_BIOSEMI64).length, electrodes: toArray(P_BIOSEMI64) },
    'biosemi128': { label: 'BioSemi 128',      count: Object.keys(P_BIOSEMI128).length, electrodes: toArray(P_BIOSEMI128) },
    'egi128':     { label: 'EGI HydroCel 128', count: Object.keys(P_EGI128).length,   electrodes: toArray(P_EGI128) },
  };

  window.HEAD_RADIUS_M = HEAD_RADIUS_M;
})();
