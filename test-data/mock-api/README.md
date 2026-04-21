# Mock eegdash registry API

Used only for local testing of the `?montage=<hash>` URL shape. The real
backend lives at `https://data.eegdash.org/api/eegdash/montages/<hash>`
and returns the same schema.

## Serving locally

The standard `python3 -m http.server` in the parent `electrode-explorer/`
folder serves these files at
`http://localhost:9876/test-data/mock-api/api/eegdash/montages/<hash>`.

Point the app at this mock with `?api=<base>`, for example:

```
http://localhost:9876/index.html?montage=a1b2c3d4e5f60718&api=http%3A%2F%2Flocalhost%3A9876%2Ftest-data%2Fmock-api
```

Available mock hashes: `a1b2c3d4e5f60718` (17-channel 10-20 subset),
`biosemi-256-eeglab-v1` (256-channel BioSemi cap).

## File naming

Mock response files have **no extension** — the real API path is
`/api/eegdash/montages/<hash>` without a suffix. Python's `http.server`
serves them as `application/octet-stream`, which the browser still parses
via `response.json()` without complaint.

## Schema

Each file matches the `MontageResponse` shape returned by the real
backend (`mongodb-eegdash-server/api/main.py::get_montage`):

```json
{
  "database": "eegdash",
  "data": {
    "hash":            "<16-char sha1 prefix>",
    "modality":        "eeg | ieeg | meg | nirs",
    "n_sensors":       17,
    "space_declared":  "CapTrak | EEGLAB | MNI | …",
    "units_declared":  "m | cm | mm",
    "sensors": [
      {"name": "Fp1", "x": -29.44, "y": 83.92, "z": -6.99, "type": "EEG"},
      …
    ],
    "first_seen":             "2026-04-21T00:00:00Z",
    "representative_dataset": "ds…",
    "representative_subject": "sub-…"
  }
}
```

The viewer's `BIDSLoader.buildMontageFromRegistryDoc` consumes this
directly — no TSV round-trip needed.
