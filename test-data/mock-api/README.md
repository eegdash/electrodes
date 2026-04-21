# Mock eegdash registry API

Used only for local testing of the `?montage=<id>` URL shape before the
real backend endpoint (`https://data.eegdash.org/api/eegdash/montages/<id>`)
is deployed.

## Serving locally

The standard `python3 -m http.server` in the parent `electrode-explorer/`
folder serves these files at
`http://localhost:9876/test-data/mock-api/api/eegdash/montages/<id>`.

Point the app at this mock with `?api=<base>`, for example:

```
http://localhost:9876/index.html?montage=biosemi-256-eeglab-v1&api=http%3A%2F%2Flocalhost%3A9876%2Ftest-data%2Fmock-api
```

## File naming

Mock response files have **no extension** (`biosemi-256-eeglab-v1`, not
`.json`) because the real API path is
`/api/eegdash/montages/biosemi-256-eeglab-v1`. Python's `http.server`
serves them as `application/octet-stream`, which the browser still parses
via `response.json()` without complaint.

## Schema

Each file is a JSON document with the fields below. See `PLAN.md` Step 3
for the canonical schema.

```json
{
  "id":                       "biosemi-256-eeglab-v1",
  "hash":                     "<sha1-of-sorted-names-and-rounded-coords>",
  "n_channels":               256,
  "space_declared":           "CTF | CapTrak | EEGLAB | MNI | …",
  "units_declared":           "m | cm | mm",
  "label":                    "BioSemi 256 (EEGLAB space)",
  "representative_dataset":   "ds002578",
  "representative_subject":   "sub-002",
  "tsv_url":                  "https://…/electrodes.tsv",
  "coords_url":               "https://…/coordsystem.json",
  "first_seen_at":            "2026-04-21T00:00:00Z"
}
```

`tsv_url` is required; `coords_url` is optional.
