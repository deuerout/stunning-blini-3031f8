#!/usr/bin/env bash
#
# generate-sbom.sh
#
# Generates SPDX 2.3 and CycloneDX 1.6 JSON SBOMs for a directory.
#
# Preferred path: delegate to `syft` (Anchore) if installed -- it correctly
# implements both spec versions, resolves nested/transitive deps across
# ecosystems, and is what enterprise procurement scanners (Snyk, Black Duck,
# Dependency-Track) actually expect to ingest. Hand-rolling full spec
# compliance in bash is not realistic to keep correct as the specs evolve.
#
# Fallback path (syft unavailable): emits a MINIMAL, schema-valid SBOM built
# from `npm ls` / `pip list`, covering only top-level + declared dependencies
# with the mandatory fields. This is clearly labeled as minimal in the SBOM
# metadata itself -- it is NOT a substitute for syft in CI, only a local
# convenience so the pipeline doesn't hard-fail when syft isn't on PATH yet.
#
# Usage:
#   ./generate-sbom.sh [target-dir] [output-dir]
#
# Output:
#   <output-dir>/solomon-sbom.spdx.json
#   <output-dir>/solomon-sbom.cdx.json

set -uo pipefail

TARGET_DIR="${1:-.}"
OUTPUT_DIR="${2:-${TARGET_DIR}/.solomon-audit}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SPDX_OUT="${OUTPUT_DIR}/solomon-sbom.spdx.json"
CDX_OUT="${OUTPUT_DIR}/solomon-sbom.cdx.json"

log()  { printf '%s\n' "$*" >&2; }
err()  { printf '[ERROR] %s\n' "$*" >&2; }
warn() { printf '[WARN] %s\n' "$*" >&2; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

if [ ! -d "$TARGET_DIR" ]; then
  err "target directory '$TARGET_DIR' does not exist"
  exit 2
fi

mkdir -p "$OUTPUT_DIR" || { err "cannot create output dir $OUTPUT_DIR"; exit 2; }

# Portable UUID: prefer python3 (present in both fallback branches anyway),
# fall back to /proc/sys/kernel/random/uuid on Linux, then uuidgen (macOS).
gen_uuid() {
  if command_exists python3; then
    python3 -c 'import uuid; print(uuid.uuid4())'
  elif [ -r /proc/sys/kernel/random/uuid ]; then
    cat /proc/sys/kernel/random/uuid
  elif command_exists uuidgen; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    # Last-resort pseudo-uuid; fine for a non-cryptographic document ID.
    printf '%08x-%04x-%04x-%04x-%012x\n' "$RANDOM$RANDOM" "$RANDOM" "$((RANDOM % 16384 + 16384))" "$((RANDOM % 16384 + 32768))" "$RANDOM$RANDOM$RANDOM"
  fi
}

if command_exists syft; then
  log "syft found -- generating full-fidelity SBOMs"
  if ! syft dir:"$TARGET_DIR" -o "spdx-json=${SPDX_OUT}" -o "cyclonedx-json=${CDX_OUT}"; then
    err "syft run failed"
    exit 2
  fi
  log "Wrote: $SPDX_OUT"
  log "Wrote: $CDX_OUT"
  exit 0
fi

warn "syft not found on PATH -- falling back to minimal native generator."
warn "Install syft (https://github.com/anchore/syft) for full-fidelity, CI-grade SBOMs."

if ! command_exists python3; then
  err "python3 required for the fallback generator and none was found"
  exit 2
fi

DOC_UUID="$(gen_uuid)"

# Collect JS deps (top-level + resolved tree, if a package.json + node_modules
# exist at the target root) and Python deps (if a venv is discoverable),
# reusing the same discovery convention as solomon-license-audit.sh.
JS_JSON="null"
if [ -f "${TARGET_DIR}/package.json" ] && command_exists npm; then
  if [ -d "${TARGET_DIR}/node_modules" ]; then
    JS_JSON="$(cd "$TARGET_DIR" && npm ls --all --json --long 2>/dev/null || echo null)"
  else
    warn "package.json present but node_modules missing at $TARGET_DIR -- JS components will be absent from fallback SBOM"
  fi
fi

PY_JSON="null"
for venv_name in venv .venv env .env; do
  candidate="${TARGET_DIR}/${venv_name}"
  pip_bin=""
  [ -x "${candidate}/bin/pip" ] && pip_bin="${candidate}/bin/pip"
  [ -z "$pip_bin" ] && [ -x "${candidate}/Scripts/pip.exe" ] && pip_bin="${candidate}/Scripts/pip.exe"
  if [ -n "$pip_bin" ]; then
    PY_JSON="$("$pip_bin" list --format=json 2>/dev/null || echo null)"
    break
  fi
done

# Write via temp files rather than argv/env: a large monorepo's resolved
# `npm ls` output can exceed ARG_MAX on either channel.
JS_JSON_FILE="$(mktemp)"
PY_JSON_FILE="$(mktemp)"
trap 'rm -f "$JS_JSON_FILE" "$PY_JSON_FILE"' EXIT
printf '%s' "$JS_JSON" > "$JS_JSON_FILE"
printf '%s' "$PY_JSON" > "$PY_JSON_FILE"

python3 - "$SPDX_OUT" "$CDX_OUT" "$TARGET_DIR" "$TIMESTAMP" "$DOC_UUID" "$JS_JSON_FILE" "$PY_JSON_FILE" <<'PYEOF' \
  || { echo "[ERROR] fallback SBOM generation failed" >&2; exit 2; }
import json, os, sys

spdx_out, cdx_out, target_dir, timestamp, doc_uuid, js_json_file, py_json_file = sys.argv[1:8]

with open(js_json_file) as f:
    js_raw = f.read() or "null"
with open(py_json_file) as f:
    py_raw = f.read() or "null"

def js_components():
    try:
        data = json.loads(js_raw)
    except Exception:
        return []
    out, seen = [], set()
    def walk(node):
        deps = (node or {}).get("dependencies", {}) or {}
        for name, info in deps.items():
            if not isinstance(info, dict):
                continue
            key = (name, info.get("version", "unknown"))
            if key not in seen:
                seen.add(key)
                out.append({"name": name, "version": info.get("version", "unknown"),
                            "license": info.get("license", "NOASSERTION")})
            walk(info)
    walk(data)
    return out

def py_components():
    try:
        pkgs = json.loads(py_raw)
    except Exception:
        return []
    if not isinstance(pkgs, list):
        return []
    return [{"name": p.get("name", "unknown"), "version": p.get("version", "unknown"),
             "license": "NOASSERTION"} for p in pkgs]

components = js_components() + py_components()
project_name = os.path.basename(os.path.abspath(target_dir)) or "solomon-project"

# --- SPDX 2.3 JSON ---
spdx_packages = [{
    "SPDXID": "SPDXRef-Package-root",
    "name": project_name,
    "downloadLocation": "NOASSERTION",
    "filesAnalyzed": False,
    "licenseConcluded": "NOASSERTION",
    "licenseDeclared": "NOASSERTION",
    "copyrightText": "NOASSERTION",
}]
relationships = [{
    "spdxElementId": "SPDXRef-DOCUMENT",
    "relationshipType": "DESCRIBES",
    "relatedSpdxElement": "SPDXRef-Package-root",
}]
for i, c in enumerate(components):
    pkg_id = f"SPDXRef-Package-{i}"
    spdx_packages.append({
        "SPDXID": pkg_id,
        "name": c["name"],
        "versionInfo": c["version"],
        "downloadLocation": "NOASSERTION",
        "filesAnalyzed": False,
        "licenseConcluded": c["license"] if c["license"] not in (None, "", "UNKNOWN") else "NOASSERTION",
        "licenseDeclared": c["license"] if c["license"] not in (None, "", "UNKNOWN") else "NOASSERTION",
        "copyrightText": "NOASSERTION",
    })
    relationships.append({
        "spdxElementId": "SPDXRef-Package-root",
        "relationshipType": "DEPENDS_ON",
        "relatedSpdxElement": pkg_id,
    })

spdx_doc = {
    "spdxVersion": "SPDX-2.3",
    "dataLicense": "CC0-1.0",
    "SPDXID": "SPDXRef-DOCUMENT",
    "name": f"{project_name}-sbom",
    "documentNamespace": f"https://deuerout.com/spdxdocs/{project_name}-{doc_uuid}",
    "creationInfo": {
        "created": timestamp,
        "creators": ["Tool: generate-sbom.sh-fallback-1.0"],
        "comment": "Generated by the minimal native fallback (syft not available on PATH). "
                   "Mandatory fields only; licenses are NOASSERTION unless a package manager "
                   "reported one directly. Re-run with syft installed for a full-fidelity SBOM.",
    },
    "packages": spdx_packages,
    "relationships": relationships,
}

with open(spdx_out, "w") as f:
    json.dump(spdx_doc, f, indent=2)

# --- CycloneDX 1.6 JSON ---
cdx_components = [{
    "type": "library",
    "name": c["name"],
    "version": c["version"],
    "licenses": ([{"license": {"id": c["license"]}}]
                 if c["license"] not in (None, "", "UNKNOWN", "NOASSERTION")
                 else []),
} for c in components]

cdx_doc = {
    "bomFormat": "CycloneDX",
    "specVersion": "1.6",
    "serialNumber": f"urn:uuid:{doc_uuid}",
    "version": 1,
    "metadata": {
        "timestamp": timestamp,
        "tools": {
            "components": [{
                "type": "application",
                "name": "generate-sbom.sh-fallback",
                "version": "1.0",
            }]
        },
        "component": {
            "type": "application",
            "name": project_name,
        },
    },
    "components": cdx_components,
}

with open(cdx_out, "w") as f:
    json.dump(cdx_doc, f, indent=2)

print(json.dumps({"components_captured": len(components), "spdx": spdx_out, "cdx": cdx_out}, indent=2))
PYEOF
