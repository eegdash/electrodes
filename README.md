# eegdash / electrodes

Static BIDS sensor-layout viewer. Deployed to **https://electrodes.eegdash.org**.

Pure HTML / SVG / vanilla JS — no build step, no Three.js, no backend.
Loads `electrodes.tsv` / `optodes.tsv` + optional `coordsystem.json` via
drag-drop or URL params, auto-detects units, rotates ALS coord systems to
RAS+, and renders the layout in a 2D viewer.

## Supported modalities

| Modality | Source file | Rendering |
|---|---|---|
| **EEG** (scalp) | `_electrodes.tsv` | Sphere mode — MNE/EEGLAB azimuthal-equidistant topomap with head, nose, ears, 10-10 reference rings |
| **MEG** | raw header (FIF / CTF `.ds` / KIT) | Sphere mode — helmet approximates sphere |
| **iEEG** (ECoG / depth) | `_electrodes.tsv` (brain space) | Flat-scatter mode with **faint head silhouette** for orientation |
| **fNIRS** | `_optodes.tsv` | Flat-scatter mode with head silhouette, **sources orange / detectors blue** |
| **EMG** (BEP-030) | `_electrodes.tsv` (body landmarks) | Flat-scatter mode, no head (multi-group datasets laid out in a 2×2 panel grid) |

## URL shapes

| URL | Purpose |
|---|---|
| `/` | Drag-drop playground (default 10-20 shown) |
| `/?demo=<prefix>` | Local fixture from `test-data/` |
| `/?tsv=<url>&coords=<url>` | Direct URL fetch (e.g. OpenNeuro S3) |
| `/?tsv=<url>&modality=<eeg\|ieeg\|emg\|nirs\|meg>` | Explicit modality (otherwise inferred from `coordsystem.json` keys) |
| `/?montage=<registry_id>` | Fetch from eegdash registry (forward-looking) |
| `/?...&embed=1` | Iframe-embed mode (rails hidden) |
| `/?...&tweaks=1` | Show the tweaks panel (debugging) |

## Embedding in eegdash docs

```html
<iframe src="https://electrodes.eegdash.org/?montage=<id>&embed=1"
        loading="lazy" width="100%" height="640"></iframe>
```

## Local development

```sh
python3 -m http.server 9876
open http://localhost:9876/?demo=ds002578_sub-002
```

## Regression tests

```sh
# EEG pipeline (13 assertions)
node test-data/generate-evidence.mjs

# iEEG + EMG (real HySER) + fNIRS flat-layout pipeline (18 assertions)
node test-data/generate-flat-evidence.mjs
```

The EMG test fetches HySER sub-01 from NEMAR (nm000108) — first run needs
network; subsequent runs use the cached TSV under `test-data/`.

## What's visible from each mode

- **Sphere mode (EEG/MEG)** — head circle, nose, ears, dashed 10-10 reference
  rings at r=0.25/0.5/0.75, nasion/inion/LPA/RPA landmarks.
- **Flat + head reference (iEEG/fNIRS)** — bounding box + crosshair + faint
  dashed head silhouette with nose/ears for orientation.
- **Flat only (EMG)** — bounding box + crosshair; multi-frame datasets
  (HySER's ed/ep/fd/fp) partitioned into a 2×2 panel grid.

## Integration plan

See `PLAN.md` in the parent
[`eegdash`](https://github.com/eegdash) repo for the full backend +
Sphinx injection roadmap.
