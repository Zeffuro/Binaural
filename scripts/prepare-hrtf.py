"""Prepare pinned SADIE II HRIR assets in CI; never normalize ears independently."""

import argparse
import hashlib
import io
import json
import math
import os
from pathlib import Path
import struct
import urllib.request
import zipfile

import h5py
import numpy as np


RECORD = "https://zenodo.org/records/12092466"
BASE = "https://zenodo.org/api/records/12092466/files/"
FILES = {
    "D1_HRIR_SOFA.zip": (38151804, "4850c1eb8e63e2d4f605edcdb4d5c883"),
    "H10_HRIR_SOFA.zip": (9591308, "501542240c1e2688a00a7f4267a11c5e"),
    "LICENSE.txt": (11558, "0ba5044c64ef53cb0189c9546081e228"),
}
RATES = {44100: "44K_16bit_256tap", 48000: "48K_24bit_256tap"}
PAPER = "https://www.mdpi.com/2076-3417/8/11/2029"


def digest(data, algorithm="sha256"):
    return hashlib.new(algorithm, data).hexdigest()


def plain(value):
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="strict").rstrip("\x00")
    if isinstance(value, np.ndarray):
        return plain(value.tolist())
    if isinstance(value, np.generic):
        return plain(value.item())
    if isinstance(value, (list, tuple)):
        return [plain(item) for item in value]
    return value


def attributes(item):
    return {key: plain(value) for key, value in sorted(item.attrs.items())
            if key not in {"DIMENSION_LIST", "REFERENCE_LIST"}}


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")


def download(key, cache):
    target = cache / key
    if not target.exists():
        cache.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(BASE + key + "/content", headers={"User-Agent": "Binaural-HRIR-preparation/1"})
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
        target.write_bytes(data)
    data = target.read_bytes()
    size, md5 = FILES[key]
    if len(data) != size or digest(data, "md5") != md5:
        raise ValueError(f"Pinned source checksum/size mismatch: {key}")
    return data


def inspect_sofa(data, filename):
    with h5py.File(io.BytesIO(data), "r") as source:
        result = {"filename": filename, "sha256": digest(data), "attributes": attributes(source), "datasets": {}}
        for name, item in source.items():
            if not isinstance(item, h5py.Dataset):
                continue
            entry = {"shape": list(item.shape), "dtype": str(item.dtype), "attributes": attributes(item)}
            if name != "Data.IR" and item.size <= 100:
                entry["values"] = plain(item[...])
            if name == "SourcePosition":
                positions = np.asarray(item[...], dtype=np.float64)
                entry["minimum"] = positions.min(axis=0).tolist()
                entry["maximum"] = positions.max(axis=0).tolist()
            result["datasets"][name] = entry
        return result


def load_archive(subject, cache):
    key = subject + "_HRIR_SOFA.zip"
    data = download(key, cache)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = sorted(archive.namelist())
        notices = {}
        for name in entries:
            basename = Path(name).name.lower()
            if basename.startswith(("license", "notice", "readme", "copyright")):
                notices[name] = archive.read(name).decode("utf-8")
        selected = {}
        audit = {"archive": key, "archiveSha256": digest(data), "archiveMd5": FILES[key][1], "entries": entries, "notices": notices, "sofa": {}}
        for rate, suffix in RATES.items():
            expected = f"{subject}_HRIR_SOFA/{subject}_{suffix}_FIR_SOFA.sofa"
            if expected not in entries:
                raise ValueError(f"Native {rate}Hz SOFA missing: {expected}")
            selected[rate] = archive.read(expected)
            audit["sofa"][str(rate)] = inspect_sofa(selected[rate], expected)
        return selected, audit


def require_ci():
    if os.environ.get("CI") != "true" or os.environ.get("GITHUB_ACTIONS") != "true":
        raise RuntimeError("HRIR inspection and preparation must run in GitHub Actions CI")


def numeric(source, name):
    value = np.asarray(source[name][...], dtype=np.float64)
    if not np.isfinite(value).all():
        raise ValueError(f"Non-finite {name}")
    return value


def cartesian(dataset, value):
    kind = str(plain(dataset.attrs.get("Type", ""))).lower()
    units = str(plain(dataset.attrs.get("Units", ""))).lower()
    if kind == "cartesian" and units in {"metre", "meter", "metres", "meters", "m"}:
        return value
    if kind != "spherical" or "degree" not in units or not any(unit in units for unit in ("metre", "meter")):
        raise ValueError(f"Unsupported coordinates {dataset.name}: {kind!r}, {units!r}")
    azimuth, elevation = np.deg2rad(value[:, 0]), np.deg2rad(value[:, 1])
    radius = value[:, 2]
    return np.column_stack((radius * np.cos(elevation) * np.cos(azimuth),
                            radius * np.cos(elevation) * np.sin(azimuth), radius * np.sin(elevation)))


def verified_source(data, rate):
    with h5py.File(io.BytesIO(data), "r") as source:
        metadata = attributes(source)
        if metadata.get("SOFAConventions") != "SimpleFreeFieldHRIR":
            raise ValueError("Only verified SimpleFreeFieldHRIR convention is supported")
        if "apache" not in str(metadata.get("License", "")).lower():
            raise ValueError("Selected SOFA does not declare Apache licensing")
        if "diffuse field equalization" not in str(metadata.get("History", "")).lower():
            raise ValueError("Selected SOFA does not establish upstream diffuse-field equalisation")
        for name, expected in (("ListenerView", [1, 0, 0]), ("ListenerUp", [0, 0, 1])):
            vectors = numeric(source, name).reshape(-1, 3)
            if not np.allclose(vectors, expected, atol=1e-7):
                raise ValueError(f"Unsupported listener orientation: {name}")
        if not np.allclose(numeric(source, "ListenerPosition"), 0, atol=1e-7):
            raise ValueError("Listener must be at the coordinate origin")
        if not np.all(numeric(source, "Data.SamplingRate") == rate):
            raise ValueError("Unexpected native sampling rate")
        if plain(source["Data.SamplingRate"].attrs.get("Units")) != "hertz":
            raise ValueError("Unexpected sampling rate units")
        delay = numeric(source, "Data.Delay")
        if not np.all(delay == 0):
            raise ValueError("Nonzero SOFA Data.Delay requires an explicit delay-preserving format revision")
        receivers = numeric(source, "ReceiverPosition")
        if receivers.shape == (2, 3, 1):
            receivers = receivers[:, :, 0]
        if receivers.shape != (2, 3):
            raise ValueError("Expected two fixed receiver positions")
        receivers = cartesian(source["ReceiverPosition"], receivers)
        if not (receivers[:, 1].min() < 0 < receivers[:, 1].max()):
            raise ValueError("Receiver geometry does not establish left/right ears")
        ears = [int(np.argmax(receivers[:, 1])), int(np.argmin(receivers[:, 1]))]
        positions = cartesian(source["SourcePosition"], numeric(source, "SourcePosition"))
        radii = np.linalg.norm(positions, axis=1)
        if not np.allclose(radii, 1.2, atol=0.002):
            raise ValueError("Unexpected measurement radius; source positions must be the 1.2m HRIR set")
        sofa_unit = positions / radii[:, None]
        app_unit = sofa_unit[:, [1, 2, 0]] * np.array([-1, 1, -1])
        ir = numeric(source, "Data.IR")
        if ir.shape != (len(positions), 2, 256):
            raise ValueError(f"Unexpected IR shape {ir.shape}")
        if np.max(np.abs(ir)) == 0:
            raise ValueError("Empty impulse responses")
        return app_unit, ir[:, ears, :], {
            "sourceEarIndices": ears, "receiverPositionsSofaMetres": receivers.tolist(),
            "delayValues": delay.tolist(), "delayAttributes": attributes(source["Data.Delay"]),
            "radiusMetres": [float(radii.min()), float(radii.max())], "sofaAttributes": metadata,
            "upstreamProcessing": {"description": "Diffuse-field equalisation, low-frequency compensation and windowing are upstream; no additional EQ is applied.",
                                   "sofaHistory": metadata["History"], "authority": PAPER, "section": "3.2.2 and 3.2.3"},
        }


def fibonacci_sphere(count):
    index = np.arange(count, dtype=np.float64)
    y = 1 - 2 * (index + 0.5) / count
    radius = np.sqrt(1 - y * y)
    angle = index * (math.pi * (3 - math.sqrt(5)))
    return np.column_stack((radius * np.cos(angle), y, radius * np.sin(angle)))


def select_grid(positions):
    targets = np.vstack((np.eye(3), -np.eye(3), fibonacci_sphere(384)))
    indices = np.unique(np.argmax(targets @ positions.T, axis=1))
    selected = positions[indices]
    probes = np.vstack((np.eye(3), -np.eye(3), fibonacci_sphere(8192)))
    gap = np.rad2deg(np.arccos(np.clip(np.max(probes @ selected.T, axis=1), -1, 1)))
    source_gap = np.rad2deg(np.arccos(np.clip(np.max(probes @ positions.T, axis=1), -1, 1)))
    if float(gap.max()) > 16 or float(source_gap.max()) > 16:
        raise ValueError(f"Source/selected grid does not cover the full sphere: {source_gap.max()}/{gap.max()} degrees")
    from scipy.spatial import ConvexHull
    hull = ConvexHull(selected)
    if np.any(hull.equations[:, 3] >= -0.05):
        raise ValueError("Selected grid convex hull does not enclose the listener")
    faces = []
    for face in hull.simplices:
        a, b, c = map(int, face)
        if np.dot(np.cross(selected[b] - selected[a], selected[c] - selected[a]), selected[a]) < 0:
            b, c = c, b
        first = min(a, b, c)
        oriented = [a, b, c]
        offset = oriented.index(first)
        faces.append(oriented[offset:] + oriented[:offset])
    faces.sort()
    return indices, faces, {
        "selection": "Nearest measured direction to 384 Fibonacci sphere targets plus six Cartesian axes; duplicate source indices removed.",
        "probeCount": len(probes), "selectedMaxNearestAngleDegrees": float(gap.max()),
        "sourceMaxNearestAngleDegrees": float(source_gap.max()), "fullSphereOriginInsideHull": True,
        "axisOrder": ["right", "up", "back", "left", "down", "front"],
        "axisSourceIndices": np.argmax(probes[:6] @ positions.T, axis=1).tolist(),
        "selectedSourceIndices": indices.tolist(), "sourceDirections": len(positions),
    }


def impulse_metrics(ir, rate, positions):
    peak = np.argmax(np.abs(ir), axis=2)
    energies = np.sum(ir * ir, axis=2)
    if np.any(energies <= 0):
        raise ValueError("Silent ear response")
    itd = (peak[:, 1] - peak[:, 0]) / rate
    ild = 10 * np.log10(energies[:, 0] / energies[:, 1])
    axis_names = ["right", "up", "back", "left", "down", "front"]
    axis_indices = np.argmax(np.vstack((np.eye(3), -np.eye(3))) @ positions.T, axis=1)
    if not (itd[axis_indices[0]] < 0 < itd[axis_indices[3]] and ild[axis_indices[0]] < 0 < ild[axis_indices[3]]):
        raise ValueError("Lateral response timing/energy contradict verified left/right receiver geometry")
    axis_cues = {name: {"index": int(index), "position": positions[index].tolist(),
                       "rightMinusLeftPeakSeconds": float(itd[index]), "leftOverRightEnergyDb": float(ild[index])}
                 for name, index in zip(axis_names, axis_indices)}
    return {"axes": axis_cues, "absolutePeak": float(np.max(np.abs(ir))), "maximumAbsoluteDcSum": float(np.max(np.abs(ir.sum(axis=2)))),
            "peakTapRange": [int(peak.min()), int(peak.max())],
            "rightMinusLeftPeakSecondsRange": [float(itd.min()), float(itd.max())],
            "leftOverRightEnergyDbRange": [float(ild.min()), float(ild.max())]}


def prepare_profile(subject, selected, audit, output):
    profiles = []
    reference_positions = None
    reference_indices = None
    for rate, data in selected.items():
        positions, ir, source_info = verified_source(data, rate)
        if reference_positions is None:
            indices, faces, coverage = select_grid(positions)
            reference_positions, reference_indices = positions, indices
        else:
            if not np.allclose(positions, reference_positions, atol=1e-7):
                raise ValueError("Native sample rate files have different measurement directions/order")
            indices = reference_indices
        records = np.concatenate((positions[indices], ir[indices, 0], ir[indices, 1]), axis=1).astype("<f4")
        binary = struct.pack("<4sIIIII", b"BHRF", 1, len(indices), rate, 256, 0) + records.tobytes()
        if len(binary) > 1_000_000:
            raise ValueError("Packed profile exceeds the 1MB per-rate budget")
        name = f"sadie-{subject.lower()}-{rate}"
        output.mkdir(parents=True, exist_ok=True)
        (output / (name + ".bin")).write_bytes(binary)
        metadata = {
            "format": "BHRF", "version": 1, "profile": "sadie-" + subject.lower(), "sampleRate": rate,
            "taps": 256, "directions": len(indices), "bytes": len(binary), "sha256": digest(binary),
            "binary": name + ".bin", "triangleIndices": [value for face in faces for value in face],
            "coordinates": {"application": "x-right, y-up, z-back", "sofa": "x-front, y-left, z-up",
                            "mapping": "application = [-sofa.y, sofa.z, -sofa.x]", "positions": "unit vectors"},
            "source": {"record": RECORD, "version": "2-2", "archive": audit["archive"],
                       "archiveMd5": audit["archiveMd5"], "archiveSha256": audit["archiveSha256"],
                       "sofa": audit["sofa"][str(rate)], **source_info},
            "coverage": coverage, "measurements": impulse_metrics(ir[indices], rate, positions[indices]),
            "license": {"identifier": "Apache-2.0", "text": "../../licenses/sadie-ii-Apache-2.0.txt",
                        "attribution": "../../licenses/sadie-ii-NOTICE.txt"},
            "transformation": {"generator": "scripts/prepare-hrtf.py", "generatorSha256": digest(Path(__file__).read_bytes()),
                               "description": "Selected measured directions; SOFA coordinate and ear ordering conversion; float64 to little-endian float32. No resampling, normalization, EQ, time alignment or truncation.",
                               "amplitudeScale": 1, "earOrder": ["left", "right"], "dataDelay": "zero in selected SOFA files; retained FIR timing"},
        }
        write_json(output / (name + ".json"), metadata)
        profiles.append(metadata)
    return profiles


def write_notices(licenses, license_data, audit):
    licenses.mkdir(parents=True, exist_ok=True)
    (licenses / "sadie-ii-Apache-2.0.txt").write_bytes(license_data)
    text = ["SADIE II Database — modified HRIR assets", "Copyright 2018, University of York.",
            "All data recorded and developed at the AudioLab, Department of Electronic Engineering, University of York by Cal Armstrong, Lewis Thresh and Gavin Kearney.",
            "Source release 2-2 (18 June 2024): " + RECORD, "License: Apache License, Version 2.0 (see sadie-ii-Apache-2.0.txt).",
            "Reference: C. Armstrong, L. Thresh, D. T. Murphy and G. Kearney (2018), A Perceptual Evaluation of Individual and Non-Individual HRTFs: A Case Study of the SADIE II Database, Applied Sciences 8(11), 2029. " + PAPER,
            "Changes: selected measured directions, transformed coordinate/ear ordering and stored native 44.1/48kHz paired HRIRs as float32. No normalization, resampling, EQ, time alignment or truncation.",
            "The upstream responses are diffuse-field equalised (paper sections 3.2.2–3.2.3). These 1.2m measurements do not represent near-ear measurement or listener personalization.",
            "The selected source archives contain no separate LICENSE or NOTICE files; the release's separate LICENSE.txt is included unmodified.", "", "Selected SOFA attribution and processing metadata (verbatim values):"]
    text.insert(-2, "The H10 source Comment says 2818 positions; its actual SourcePosition/Data.IR dimensions contain 2114. The manifest reports the actual dimensions; the original Comment is retained below.")
    for subject, entry in audit["profiles"].items():
        for rate, sofa in entry["sofa"].items():
            text.append(f"\n{subject} / {rate}Hz / {sofa['filename']}")
            text.append(json.dumps(sofa["attributes"], indent=2, sort_keys=True))
        for filename, notice in entry["notices"].items():
            text.extend([f"\nUpstream {filename}:", notice])
    (licenses / "sadie-ii-NOTICE.txt").write_text("\n".join(text) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("public/audio/hrtf"))
    parser.add_argument("--licenses", type=Path, default=Path("public/licenses"))
    parser.add_argument("--cache", type=Path, default=Path(".hrtf-cache"))
    parser.add_argument("--audit", type=Path, default=Path("hrtf-source-audit.json"))
    parser.add_argument("--inspect-only", action="store_true")
    args = parser.parse_args()
    require_ci()
    license_data = download("LICENSE.txt", args.cache)
    audit = {"record": RECORD, "licenseSha256": digest(license_data), "profiles": {}}
    profiles = []
    for subject in ("D1", "H10"):
        selected, subject_audit = load_archive(subject, args.cache)
        audit["profiles"][subject] = subject_audit
        if not args.inspect_only:
            profiles.extend(prepare_profile(subject, selected, subject_audit, args.output))
    write_json(args.audit, audit)
    if not args.inspect_only:
        write_notices(args.licenses, license_data, audit)
        write_json(args.output / "index.json", {"version": 1, "profiles": [
            {key: profile[key] for key in ("profile", "sampleRate", "directions", "taps", "bytes", "sha256", "binary")}
            for profile in profiles]})
    print(json.dumps({"audit": str(args.audit), "profiles": list(audit["profiles"])}))


if __name__ == "__main__":
    main()
