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
    for subject in ("D1", "H10"):
        selected, subject_audit = load_archive(subject, args.cache)
        audit["profiles"][subject] = subject_audit
        if not args.inspect_only:
            raise RuntimeError("Preparation gate awaits review of actual selected SOFA metadata; use --inspect-only")
    write_json(args.audit, audit)
    print(json.dumps({"audit": str(args.audit), "profiles": list(audit["profiles"])}))


if __name__ == "__main__":
    main()
