# eegdash / electrodes

Static BIDS electrode-layout viewer. Deployed to **https://electrodes.eegdash.org**.

Pure HTML / SVG / vanilla JS — no build step, no Three.js, no backend.
Loads `electrodes.tsv` + optional `coordsystem.json` via drag-drop or URL
params, auto-detects units, rotates ALS coord systems to RAS+, and renders
an MNE/EEGLAB-style azimuthal-equidistant topomap.

## URL shapes

| URL                                                               | Purpose                                   |
|-------------------------------------------------------------------|-------------------------------------------|
| `/`                                                               | Drag-drop playground (default 10-20 shown)|
| `/?demo=<prefix>`                                                 | Local fixture from `test-data/`           |
| `/?tsv=<url>&coords=<url>`                                        | Direct URL fetch (e.g. OpenNeuro S3)      |
| `/?montage=<registry_id>`                                         | Fetch from eegdash registry (forward-looking) |
| `/?...&embed=1`                                                   | Iframe-embed mode (rails hidden)          |
| `/?...&tweaks=1`                                                  | Show the tweaks panel (debugging)         |

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

## Regression test

```sh
node test-data/generate-evidence.mjs
```

Runs the full loader pipeline against synthetic 10-20 data with 13 assertions.

## Docs / roadmap

See `PLAN.md` in the parent
[`eegdash`](https://github.com/eegdash) repo for the full integration plan.
