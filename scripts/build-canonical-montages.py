#!/usr/bin/env python3
"""Generate canonical montage positions using MNE.

Replaces the hand-rolled spherical formulas in ``montages.js`` (which were
documented to be wrong by up to 76° for Fp1/Fp2 compared to MNE's
canonical templates). The output is frozen into ``montages.js`` as
inlined constants — no runtime MNE dependency on the client.

For each canonical cap, we pull MNE's ``make_standard_montage`` positions
(head coord frame, metres), compute a unit direction (ux, uy, uz), and
emit a ``{name, x, y, z, ux, uy, uz, region}`` record matching the
viewer's existing electrode shape.

Usage::

    python scripts/build-canonical-montages.py
    # writes electrode-explorer/montages.json next to montages.js

Regenerate after bumping MNE's version; check the diff by hand before
committing.
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

import mne

HERE = Path(__file__).resolve().parent.parent  # electrode-explorer/
OUT_PATH = HERE / "montages.json"

# Map our viewer-facing keys to MNE montage names. 10-10 isn't a separate
# MNE montage — it's the 88-channel subset of 10-05 that MNE packages as
# standard_1005 but with only "10-10" labels. We filter the 10-05 output
# to get it.
CANONICAL = [
    ("10-20",      "standard_1020",       "Standard 10-20"),
    ("10-10",      "standard_1005",       "Standard 10-10"),   # filtered below
    ("10-05",      "standard_1005",       "Standard 10-05"),
    ("biosemi16",  "biosemi16",           "BioSemi 16"),
    ("biosemi32",  "biosemi32",           "BioSemi 32"),
    ("biosemi64",  "biosemi64",           "BioSemi 64"),
    ("biosemi128", "biosemi128",          "BioSemi 128"),
    ("biosemi256", "biosemi256",          "BioSemi 256"),
    ("egi128",     "GSN-HydroCel-128",    "EGI HydroCel 128"),
    ("egi256",     "GSN-HydroCel-256",    "EGI HydroCel 256"),
    ("mgh60",      "mgh60",               "MGH 60"),
    ("easycap-M1", "easycap-M1",          "EasyCap M1"),
]

# 10-10 labels — the subset of 10-05 names that appear in the classical
# 10-10 system. Drop the half-step prefixes (AFp, AFF, FFC, FCC, CCP, CPP,
# PPO, POO) and the 10-05 interpolated numerics.
TEN_TEN_PREFIXES = {
    "FP", "AF", "F", "FC", "FT", "C", "T", "CP", "TP",
    "P", "PO", "O", "N", "I", "A",
}


def _prefix(name: str) -> str:
    m = re.match(r"^([A-Za-z]+)", name)
    p = m.group(1).upper() if m else ""
    if p.endswith("Z") and len(p) > 1:
        p = p[:-1]
    return p


def _is_ten_ten(name: str) -> bool:
    """Return True for a 10-10 label. Classical 10-10 uses integer numerics;
    the 10-05 half-step prefixes like AFp/AFF/FFC/etc. don't appear in 10-10."""
    p = _prefix(name)
    if p not in TEN_TEN_PREFIXES:
        return False
    return True


def _region_of(name: str) -> str:
    """Port of bids-loader.js::regionByLabel — mirror the viewer's logic so the
    exported JSON is self-describing."""
    p = _prefix(name)
    if p in {"NZ", "N", "FP", "AF"}:
        return "frontal"
    if p in {"F", "FC", "FT", "FFC", "AFF", "AFP"}:
        return "frontal"
    if p in {"T", "C", "FCC", "CCP"}:
        return "central"
    if p in {"CP", "TP", "CPP"}:
        return "parietal"
    if p in {"P", "PPO"}:
        return "parietal"
    if p in {"PO", "POO", "O", "IZ", "I"}:
        return "occipital"
    if p == "A":
        return "reference"
    if p == "E":
        return "egi"
    return "other"


def _dump_one(key: str, mne_name: str, label: str) -> dict:
    m = mne.channels.make_standard_montage(mne_name)
    pos = m.get_positions()["ch_pos"]
    electrodes = []
    for name, p in pos.items():
        x, y, z = float(p[0]), float(p[1]), float(p[2])
        r = math.sqrt(x * x + y * y + z * z)
        if r < 1e-9:
            # Skip zero-position entries (MNE sometimes includes them for fiducials)
            continue
        if key == "10-10" and not _is_ten_ten(name):
            continue
        electrodes.append({
            "name": name,
            "x": round(x, 5),
            "y": round(y, 5),
            "z": round(z, 5),
            "ux": round(x / r, 5),
            "uy": round(y / r, 5),
            "uz": round(z / r, 5),
            "region": _region_of(name),
        })
    return {"label": label, "count": len(electrodes), "electrodes": electrodes}


def main() -> None:
    print(f"[build-canonical-montages] MNE version: {mne.__version__}")
    output = {}
    for key, mne_name, label in CANONICAL:
        try:
            output[key] = _dump_one(key, mne_name, label)
            print(f"  {key:12s} ← {mne_name:24s} {output[key]['count']:4d} ch  ({label})")
        except Exception as exc:  # noqa: BLE001
            print(f"  {key:12s} SKIP: {exc}")

    # Also include HEAD_RADIUS_M derived from the mean magnitude across all
    # channels in the largest montage (10-05). Keeps the viewer's "r = X mm"
    # caption in sensible territory when no sphere fit runs.
    ref = output.get("10-05") or next(iter(output.values()))
    mags = [
        math.sqrt(e["x"] ** 2 + e["y"] ** 2 + e["z"] ** 2)
        for e in ref["electrodes"]
    ]
    mean_r = sum(mags) / len(mags)
    output["_meta"] = {
        "head_radius_m": round(mean_r, 5),
        "mne_version": mne.__version__,
        "generated_from": "mne.channels.make_standard_montage",
    }

    OUT_PATH.write_text(json.dumps(output, indent=2))
    total_channels = sum(v.get("count", 0) for k, v in output.items() if k != "_meta")
    print(f"\nWrote {OUT_PATH}")
    print(f"  {len(output) - 1} montages, {total_channels} total channels")
    print(f"  derived head radius ≈ {mean_r * 1000:.1f} mm")


if __name__ == "__main__":
    main()
