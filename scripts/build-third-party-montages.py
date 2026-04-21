#!/usr/bin/env python3
"""Import montage templates that MNE doesn't ship.

Augments the canonical catalog from ``build-canonical-montages.py`` with
templates from Brainstorm, DIPFIT (BESA), and EEGLAB — covering ANT
Waveguard, BrainProducts ActiCap/EasyCap (beyond M1/M10/M43), Neuroscan
Quik-cap, Wearable Sensing DSI-24, EGI classic GSN (pre-HydroCel),
Philips/EGI infant nets, BESA HD-EEG, etc.

Pipeline per source:

1. Download the template file from the upstream GitHub raw URL into
   ``scripts/_vendor-cache/``. Subsequent runs reuse the cache.
2. Parse the format (Brainstorm ``.mat`` / DIPFIT ``.mat`` / EEGLAB
   ``.sfp``) into ``(name, x, y, z)`` tuples in the source's native frame.
3. Rotate to MNE head convention (``+X=right, +Y=nose, +Z=up``) and
   normalize units to metres via a sphere fit (the fitted radius should
   land in 4–15 cm; anything else is a unit-conversion bug).
4. Recentre positions on the sphere centre, drop fiducials and reference
   channels, emit ``{name, x, y, z, ux, uy, uz, region}`` records that
   match the viewer's existing electrode shape.
5. Append to ``montages.json`` (keeping MNE-generated entries) and
   regenerate ``montages.js`` — a thin wrapper that assigns the JSON to
   ``window.MONTAGES``.

Run ``python scripts/build-canonical-montages.py`` first, then this
script. Both are idempotent.
"""
from __future__ import annotations

import json
import math
import re
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
from scipy.io import loadmat

HERE = Path(__file__).resolve().parent.parent  # electrode-explorer/
CACHE = Path(__file__).resolve().parent / "_vendor-cache"
JSON_PATH = HERE / "montages.json"
JS_PATH = HERE / "montages.js"

BST_RAW = "https://raw.githubusercontent.com/brainstorm-tools/brainstorm3/master"
DIPFIT_RAW = "https://raw.githubusercontent.com/sccn/dipfit/master"
EEGLAB_RAW = "https://raw.githubusercontent.com/sccn/eeglab/develop"

# Non-data channels that some vendors include alongside scalp sites.
FIDUCIAL_PATTERNS = re.compile(
    r"^(fid|nas|nz|nasion|inion|iz|lpa|rpa|cms|drl|com(mon)?ref|ref(erence)?|gnd|ground)",
    re.IGNORECASE,
)


def _is_electrode(name: str, channel_type: str | None) -> bool:
    """Keep only scalp EEG sites. Brainstorm tags mastoid refs, EKG, EOG,
    pulse-ox, etc. with non-EEG ``Type`` strings; when a type is supplied,
    gate strictly on that. For formats without a type (``.sfp``, BESA
    ``.mat``) fall back to label pattern matching."""
    if channel_type is not None:
        return channel_type.strip().upper() == "EEG"
    if FIDUCIAL_PATTERNS.match(name or ""):
        return False
    return True


def _region_by_label(name: str) -> str | None:
    """Return the 10-20-style region for a label, or ``None`` if the label
    uses a numeric grid scheme (E1..EN, A1..An for BESA, etc.) that can't
    be mapped to a brain region without the coordinate."""
    m = re.match(r"^([A-Za-z]+)", name or "")
    p = m.group(1).upper() if m else ""
    if p.endswith("Z") and len(p) > 1:
        p = p[:-1]
    if p in {"NZ", "N", "FP", "AF"}:
        return "frontal"
    if p in {"F", "FC", "FT", "FFC", "AFF", "AFP"}:
        return "frontal"
    if p in {"T", "C", "FCC", "CCP"}:
        return "central"
    if p in {"CP", "TP", "CPP", "P", "PPO"}:
        return "parietal"
    if p in {"PO", "POO", "O", "IZ", "I"}:
        return "occipital"
    return None


def _region_by_position(ux: float, uy: float, uz: float) -> str:
    """Bucket a unit direction into coarse regions. Used when the label is
    a generic grid id (E1..En, BESA A1..H24) that carries no 10-20 hint."""
    if uy > 0.4:
        return "frontal"
    if uy < -0.4:
        return "occipital"
    if uz > 0.7:
        return "central"
    if uy < 0 and uz > 0.2:
        return "parietal"
    return "central" if uz > 0.2 else "other"


def _fetch(url: str) -> Path:
    CACHE.mkdir(exist_ok=True)
    dest = CACHE / url.rsplit("/", 1)[-1]
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    with urllib.request.urlopen(url, timeout=30) as resp, dest.open("wb") as f:
        f.write(resp.read())
    return dest


def _sphere_fit(xyz: np.ndarray) -> tuple[np.ndarray, float]:
    """EEGLAB's 4-point-free least squares: minimize sum_i (|x_i - c|^2 - r^2)^2
    via the linear substitution u = (cx, cy, cz, r^2 - |c|^2)."""
    A = np.hstack([2 * xyz, np.ones((len(xyz), 1))])
    b = (xyz ** 2).sum(axis=1)
    u, *_ = np.linalg.lstsq(A, b, rcond=None)
    c = u[:3]
    r = math.sqrt(max(u[3] + c @ c, 0.0))
    return c, r


def _normalize(xyz: np.ndarray, *, source_unit: str = "auto") -> tuple[np.ndarray, float]:
    """Centre on fitted sphere, scale to metres. ``source_unit`` may be 'm',
    'cm', 'mm', or 'auto' (infer from the fitted radius: 4–15 cm is
    plausible, so radii > 0.5 are mm, 1.5–15 are cm, else metres)."""
    c, r = _sphere_fit(xyz)
    if source_unit == "auto":
        if r > 15:
            scale = 0.001  # mm
        elif r > 0.5:
            scale = 0.01  # cm
        else:
            scale = 1.0  # metres
    else:
        scale = {"m": 1.0, "cm": 0.01, "mm": 0.001}[source_unit]
    centred = (xyz - c) * scale
    _, r2 = _sphere_fit(centred)
    return centred, r2


def _rotate_scs_to_mne(xyz: np.ndarray) -> np.ndarray:
    """Brainstorm SCS (+X=nose, +Y=left, +Z=up) → MNE head (+X=right, +Y=nose, +Z=up).
    (x, y, z) → (-y, x, z)."""
    return np.column_stack([-xyz[:, 1], xyz[:, 0], xyz[:, 2]])


# ── format-specific parsers ──────────────────────────────────────────────


def _parse_brainstorm(path: Path) -> tuple[list[str], np.ndarray]:
    m = loadmat(path, struct_as_record=False, squeeze_me=True)
    ch = m["Channel"]
    if not hasattr(ch, "__len__"):
        ch = [ch]
    names: list[str] = []
    rows: list[list[float]] = []
    for c in ch:
        name = str(getattr(c, "Name", "") or "")
        typ = str(getattr(c, "Type", "") or "").strip() or None
        loc = np.asarray(getattr(c, "Loc", None))
        if loc is None or loc.size != 3:
            continue
        loc = loc.astype(float).flatten()
        if not np.isfinite(loc).all() or np.linalg.norm(loc) < 1e-9:
            continue
        if not _is_electrode(name, typ):
            continue
        names.append(name)
        rows.append(loc.tolist())
    return names, np.asarray(rows, dtype=float)


def _parse_dipfit_besa(path: Path) -> tuple[list[str], np.ndarray]:
    m = loadmat(path, struct_as_record=False, squeeze_me=True)
    e = m["elec"]
    labels = [str(s) for s in np.atleast_1d(e.label)]
    pnt = np.asarray(e.pnt, dtype=float)
    keep = [(n, p) for n, p in zip(labels, pnt) if _is_electrode(n, None)]
    names = [n for n, _ in keep]
    rows = np.asarray([p for _, p in keep], dtype=float)
    return names, rows


def _parse_sfp(path: Path) -> tuple[list[str], np.ndarray]:
    names: list[str] = []
    rows: list[list[float]] = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = re.split(r"\s+", line)
        if len(parts) < 4:
            continue
        name = parts[0]
        try:
            x, y, z = float(parts[1]), float(parts[2]), float(parts[3])
        except ValueError:
            continue
        if not _is_electrode(name, None):
            continue
        if abs(x) + abs(y) + abs(z) < 1e-9:
            continue
        names.append(name)
        rows.append([x, y, z])
    return names, np.asarray(rows, dtype=float)


# ── source registry ──────────────────────────────────────────────────────


@dataclass
class Source:
    key: str
    label: str
    url: str
    fmt: str  # 'brainstorm' | 'dipfit_besa' | 'sfp'
    frame: str  # 'scs' (Brainstorm SCS) | 'mne' (already +Y=nose)
    unit: str = "auto"  # 'm', 'cm', 'mm', 'auto'


SOURCES: list[Source] = [
    # ANT Waveguard (Brainstorm NotAligned, SCS, metres)
    Source("antwg32",  "ANT Waveguard 32",  f"{BST_RAW}/defaults/eeg/NotAligned/channel_ANT_Waveguard_32.mat",  "brainstorm", "scs", "m"),
    Source("antwg64",  "ANT Waveguard 64",  f"{BST_RAW}/defaults/eeg/NotAligned/channel_ANT_Waveguard_64.mat",  "brainstorm", "scs", "m"),
    Source("antwg64d", "ANT Waveguard 64 Duke",  f"{BST_RAW}/defaults/eeg/NotAligned/channel_ANT_Waveguard_64_duke.mat", "brainstorm", "scs", "m"),
    Source("antwg128", "ANT Waveguard 128", f"{BST_RAW}/defaults/eeg/NotAligned/channel_ANT_Waveguard_128.mat", "brainstorm", "scs", "m"),
    Source("antwg256", "ANT Waveguard 256", f"{BST_RAW}/defaults/eeg/NotAligned/channel_ANT_Waveguard_256.mat", "brainstorm", "scs", "m"),

    # BrainProducts ActiCap (Brainstorm)
    Source("acticap65",  "BrainProducts ActiCap 65",  f"{BST_RAW}/defaults/eeg/NotAligned/channel_BrainProducts_ActiCap_65.mat",  "brainstorm", "scs", "m"),
    Source("acticap97",  "BrainProducts ActiCap 97",  f"{BST_RAW}/defaults/eeg/NotAligned/channel_BrainProducts_ActiCap_97.mat",  "brainstorm", "scs", "m"),
    Source("acticap128", "BrainProducts ActiCap 128", f"{BST_RAW}/defaults/eeg/NotAligned/channel_BrainProducts_ActiCap_128.mat", "brainstorm", "scs", "m"),
    Source("acticap68",  "BrainProducts ActiCap 68",  f"{BST_RAW}/defaults/eeg/ICBM152/channel_BrainProducts_ActiCap_68.mat",     "brainstorm", "scs", "m"),

    # BrainProducts EasyCap (beyond M1/M10/M43 that MNE ships)
    Source("easycap64",  "BrainProducts EasyCap 64",  f"{BST_RAW}/defaults/eeg/ICBM152/channel_BrainProducts_EasyCap_64.mat",  "brainstorm", "scs", "m"),
    Source("easycap128", "BrainProducts EasyCap 128", f"{BST_RAW}/defaults/eeg/NotAligned/channel_BrainProducts_EasyCap_128.mat", "brainstorm", "scs", "m"),

    # Neuroscan
    Source("neuroscan-maglink-65", "Neuroscan MagLink 65",  f"{BST_RAW}/defaults/eeg/NotAligned/channel_Neuroscan_MagLink_65.mat",  "brainstorm", "scs", "m"),
    Source("neuroscan-quikcap-64", "Neuroscan Quik-cap 64",  f"{BST_RAW}/defaults/eeg/NotAligned/channel_Neuroscan_Quik-cap_64.mat",  "brainstorm", "scs", "m"),
    Source("neuroscan-quikcap-68", "Neuroscan Quik-cap 68",  f"{BST_RAW}/defaults/eeg/NotAligned/channel_Neuroscan_Quik-cap_68.mat",  "brainstorm", "scs", "m"),
    Source("neuroscan-quikcap-123", "Neuroscan Quik-cap 123", f"{BST_RAW}/defaults/eeg/NotAligned/channel_Neuroscan_Quik-cap_123.mat", "brainstorm", "scs", "m"),
    Source("neuroscan-quikcap-128", "Neuroscan Quik-cap 128", f"{BST_RAW}/defaults/eeg/NotAligned/channel_Neuroscan_Quik-cap_128.mat", "brainstorm", "scs", "m"),

    # BioSemi label variants (non-A01/A1 overlap with MNE built-ins — pick the A01 variants as the "alt label" set)
    Source("biosemi64-10-10", "BioSemi 64 (10-10 labels)", f"{BST_RAW}/defaults/eeg/NotAligned/channel_BioSemi_64_10-10.mat", "brainstorm", "scs", "m"),
    Source("biosemi128-A01",  "BioSemi 128 (A01 labels)",  f"{BST_RAW}/defaults/eeg/NotAligned/channel_BioSemi_128_A01.mat", "brainstorm", "scs", "m"),
    Source("biosemi256-A001", "BioSemi 256 (A001 labels)", f"{BST_RAW}/defaults/eeg/NotAligned/channel_BioSemi_256_A001.mat", "brainstorm", "scs", "m"),

    # EGI classic GSN (pre-HydroCel)
    Source("egi-gsn-64v1", "EGI GSN 64 (v1)", f"{BST_RAW}/defaults/eeg/NotAligned/channel_GSN_64_v1.mat", "brainstorm", "scs", "m"),
    Source("egi-gsn-64v2", "EGI GSN 64 (v2)", f"{BST_RAW}/defaults/eeg/NotAligned/channel_GSN_64_v2.mat", "brainstorm", "scs", "m"),
    Source("egi-gsn-128",  "EGI GSN 128",     f"{BST_RAW}/defaults/eeg/NotAligned/channel_GSN_128.mat",   "brainstorm", "scs", "m"),
    Source("egi-gsn-256",  "EGI GSN 256",     f"{BST_RAW}/defaults/eeg/NotAligned/channel_GSN_256.mat",   "brainstorm", "scs", "m"),

    # Wearable Sensing DSI-24 (only in ICBM152, still in SCS axes)
    Source("dsi24", "Wearable Sensing DSI-24", f"{BST_RAW}/defaults/eeg/ICBM152/channel_WearableSensing_DSI_24.mat", "brainstorm", "scs", "m"),

    # U562 high-density custom
    Source("u562-128", "U562 128", f"{BST_RAW}/defaults/eeg/NotAligned/channel_U562_128.mat", "brainstorm", "scs", "m"),

    # BESA HD-EEG 254 (DIPFIT)
    Source("besa-red-254",    "BESA TemplateRed 254",    f"{DIPFIT_RAW}/standard_BESA/TemplateRed254.mat",    "dipfit_besa", "mne", "mm"),
    Source("besa-yellow-254", "BESA TemplateYellow 254", f"{DIPFIT_RAW}/standard_BESA/TemplateYellow254.mat", "dipfit_besa", "mne", "mm"),

    # Philips/EGI infant/adult average nets (.sfp)
    Source("egi-infant-0-2-32",   "EGI Infant 0–2 mo 32",   f"{EEGLAB_RAW}/functions/supportfiles/channel_location_files/philips_neuro/0_2AverageNet32_v1.sfp",   "sfp", "mne", "auto"),
    Source("egi-infant-0-2-64",   "EGI Infant 0–2 mo 64",   f"{EEGLAB_RAW}/functions/supportfiles/channel_location_files/philips_neuro/0_2AverageNet64_v1.sfp",   "sfp", "mne", "auto"),
    Source("egi-infant-0-2-128",  "EGI Infant 0–2 mo 128",  f"{EEGLAB_RAW}/functions/supportfiles/channel_location_files/philips_neuro/0_2AverageNet128_v1.sfp",  "sfp", "mne", "auto"),
    Source("egi-infant-2-9-32",   "EGI Infant 2–9 mo 32",   f"{EEGLAB_RAW}/functions/supportfiles/channel_location_files/philips_neuro/2_9AverageNet32_v1.sfp",   "sfp", "mne", "auto"),
    Source("egi-infant-2-9-64",   "EGI Infant 2–9 mo 64",   f"{EEGLAB_RAW}/functions/supportfiles/channel_location_files/philips_neuro/2_9AverageNet64_v1.sfp",   "sfp", "mne", "auto"),
    Source("egi-infant-2-9-128",  "EGI Infant 2–9 mo 128",  f"{EEGLAB_RAW}/functions/supportfiles/channel_location_files/philips_neuro/2_9AverageNet128_v1.sfp",  "sfp", "mne", "auto"),
    Source("egi-infant-9-18-32",  "EGI Infant 9–18 mo 32",  f"{EEGLAB_RAW}/functions/supportfiles/channel_location_files/philips_neuro/9_18AverageNet32_v1.sfp",  "sfp", "mne", "auto"),
    Source("egi-infant-9-18-64",  "EGI Infant 9–18 mo 64",  f"{EEGLAB_RAW}/functions/supportfiles/channel_location_files/philips_neuro/9_18AverageNet64_v1.sfp",  "sfp", "mne", "auto"),
    Source("egi-infant-9-18-128", "EGI Infant 9–18 mo 128", f"{EEGLAB_RAW}/functions/supportfiles/channel_location_files/philips_neuro/9_18AverageNet128_v1.sfp", "sfp", "mne", "auto"),
    Source("egi-infant-9-18-256", "EGI Infant 9–18 mo 256", f"{EEGLAB_RAW}/functions/supportfiles/channel_location_files/philips_neuro/9_18AverageNet256_v1.sfp", "sfp", "mne", "auto"),
    Source("egi-adult-32",  "EGI Adult Avg 32",  f"{EEGLAB_RAW}/functions/supportfiles/channel_location_files/philips_neuro/AdultAverageNet32_v1.sfp",  "sfp", "mne", "auto"),
    Source("egi-adult-64",  "EGI Adult Avg 64",  f"{EEGLAB_RAW}/functions/supportfiles/channel_location_files/philips_neuro/AdultAverageNet64_v1.sfp",  "sfp", "mne", "auto"),
    Source("egi-adult-128", "EGI Adult Avg 128", f"{EEGLAB_RAW}/functions/supportfiles/channel_location_files/philips_neuro/AdultAverageNet128_v1.sfp", "sfp", "mne", "auto"),
    Source("egi-adult-256", "EGI Adult Avg 256", f"{EEGLAB_RAW}/functions/supportfiles/channel_location_files/philips_neuro/AdultAverageNet256_v1.sfp", "sfp", "mne", "auto"),
]


PARSERS: dict[str, Callable[[Path], tuple[list[str], np.ndarray]]] = {
    "brainstorm":  _parse_brainstorm,
    "dipfit_besa": _parse_dipfit_besa,
    "sfp":         _parse_sfp,
}


def _build(src: Source) -> dict | None:
    path = _fetch(src.url)
    names, xyz = PARSERS[src.fmt](path)
    if len(names) == 0:
        return None
    if src.frame == "scs":
        xyz = _rotate_scs_to_mne(xyz)
    xyz, r = _normalize(xyz, source_unit=src.unit)
    if not (0.04 <= r <= 0.15):
        raise ValueError(f"{src.key}: fitted head radius {r*1000:.1f} mm outside 40–150 mm plausible range — unit inference is off")
    electrodes = []
    for name, p in zip(names, xyz):
        norm = float(np.linalg.norm(p))
        if norm < 1e-9:
            continue
        ux, uy, uz = p[0] / norm, p[1] / norm, p[2] / norm
        region = _region_by_label(name) or _region_by_position(ux, uy, uz)
        electrodes.append({
            "name": name,
            "x": round(float(p[0]), 5),
            "y": round(float(p[1]), 5),
            "z": round(float(p[2]), 5),
            "ux": round(float(ux), 5),
            "uy": round(float(uy), 5),
            "uz": round(float(uz), 5),
            "region": region,
        })
    return {"label": src.label, "count": len(electrodes), "electrodes": electrodes}


def _emit_js(data: dict) -> None:
    head_r = data.get("_meta", {}).get("head_radius_m", 0.09906)
    parts = [
        "// Canonical + third-party sensor montages — generated by",
        "// scripts/build-canonical-montages.py + scripts/build-third-party-montages.py.",
        "// Do NOT edit by hand; regenerate with the Python scripts.",
        "",
        "(function () {",
        f"  window.HEAD_RADIUS_M = {head_r};",
        "  window.MONTAGES = " + json.dumps(
            {k: v for k, v in data.items() if k != "_meta"}, indent=2
        ) + ";",
        "})();",
        "",
    ]
    JS_PATH.write_text("\n".join(parts))


def main() -> None:
    if not JSON_PATH.exists():
        raise SystemExit(
            f"{JSON_PATH} not found — run scripts/build-canonical-montages.py first"
        )
    data = json.loads(JSON_PATH.read_text())
    before = len([k for k in data if k != "_meta"])

    added: list[str] = []
    skipped: list[tuple[str, str]] = []
    for src in SOURCES:
        if src.key in data:
            continue
        try:
            entry = _build(src)
        except Exception as exc:  # noqa: BLE001
            skipped.append((src.key, f"{type(exc).__name__}: {exc}"))
            continue
        if entry is None or entry["count"] == 0:
            skipped.append((src.key, "no electrodes parsed"))
            continue
        data[src.key] = entry
        added.append(src.key)
        print(f"  + {src.key:30s} {entry['count']:4d} ch  ({entry['label']})")

    for k, why in skipped:
        print(f"  - {k:30s} SKIP: {why}")

    JSON_PATH.write_text(json.dumps(data, indent=2))
    _emit_js(data)

    after = len([k for k in data if k != "_meta"])
    total_ch = sum(v.get("count", 0) for k, v in data.items() if k != "_meta")
    print()
    print(f"Wrote {JSON_PATH} ({JSON_PATH.stat().st_size // 1024} KB)")
    print(f"Wrote {JS_PATH} ({JS_PATH.stat().st_size // 1024} KB)")
    print(f"  {before} → {after} montages (+{len(added)}), {total_ch} total channels")


if __name__ == "__main__":
    main()
