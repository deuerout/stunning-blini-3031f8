#!/usr/bin/env python3
"""Validate SPDX 2.3 / CycloneDX 1.6 JSON SBOMs against the official schemas.

Schemas are vendored locally in ./schemas/ (fetched from the upstream spec
repos) rather than fetched at validation time, so this runs offline in CI
and isn't a supply-chain vector of its own.

Usage:
    validate_sbom.py --spdx path/to/sbom.spdx.json
    validate_sbom.py --cyclonedx path/to/sbom.cdx.json
    validate_sbom.py --spdx a.json --cyclonedx b.json

Exit codes: 0 = all provided documents valid, 1 = one or more invalid,
2 = usage/environment error (missing file, missing dependency, bad schema).
"""
import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SCHEMA_DIR = SCRIPT_DIR / "schemas"
SPDX_SCHEMA_PATH = SCHEMA_DIR / "spdx-2.3.schema.json"
CDX_SCHEMA_PATH = SCHEMA_DIR / "cyclonedx-1.6.schema.json"


def load_json(path: Path, label: str):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"[ERROR] {label} not found: {path}", file=sys.stderr)
        sys.exit(2)
    except json.JSONDecodeError as e:
        print(f"[ERROR] {label} is not valid JSON: {path} -- {e}", file=sys.stderr)
        sys.exit(1)


def validate(doc_path: Path, schema_path: Path, kind: str) -> bool:
    try:
        import jsonschema
    except ImportError:
        print(
            "[ERROR] the 'jsonschema' package is required "
            "(pip install jsonschema) and was not found.",
            file=sys.stderr,
        )
        sys.exit(2)

    schema = load_json(schema_path, f"{kind} schema")
    doc = load_json(doc_path, f"{kind} document")

    validator_cls = jsonschema.validators.validator_for(schema)
    validator_cls.check_schema(schema)
    validator = validator_cls(schema)

    errors = sorted(validator.iter_errors(doc), key=lambda e: list(e.path))
    if not errors:
        print(f"[OK] {doc_path} is a valid {kind} document.")
        return True

    print(f"[FAIL] {doc_path} failed {kind} schema validation ({len(errors)} error(s)):", file=sys.stderr)
    for err in errors[:25]:
        loc = "$" + "".join(f"[{repr(p)}]" for p in err.path) if err.path else "$ (document root)"
        print(f"  - {loc}: {err.message}", file=sys.stderr)
    if len(errors) > 25:
        print(f"  ... and {len(errors) - 25} more", file=sys.stderr)
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--spdx", type=Path, help="Path to an SPDX 2.3 JSON document to validate")
    parser.add_argument("--cyclonedx", type=Path, help="Path to a CycloneDX 1.6 JSON document to validate")
    args = parser.parse_args()

    if not args.spdx and not args.cyclonedx:
        parser.error("provide at least one of --spdx or --cyclonedx")

    if not SPDX_SCHEMA_PATH.exists() or not CDX_SCHEMA_PATH.exists():
        print(f"[ERROR] vendored schemas missing under {SCHEMA_DIR} -- re-fetch before validating.", file=sys.stderr)
        sys.exit(2)

    all_ok = True
    if args.spdx:
        all_ok = validate(args.spdx, SPDX_SCHEMA_PATH, "SPDX 2.3") and all_ok
    if args.cyclonedx:
        all_ok = validate(args.cyclonedx, CDX_SCHEMA_PATH, "CycloneDX 1.6") and all_ok

    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
