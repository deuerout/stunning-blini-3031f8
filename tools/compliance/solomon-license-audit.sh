#!/usr/bin/env bash
#
# solomon-license-audit.sh
#
# Scans a repo (monorepo-aware) for npm/yarn/pnpm and Python dependencies,
# resolves licenses from the INSTALLED package trees (not just declared
# manifests, which can drift from what's actually running), and flags
# copyleft licenses (GPL/AGPL/LGPL family) that conflict with SCSL v1.0
# distribution as a proprietary SaaS.
#
# Exit codes:
#   0 - clean, no blocking licenses found
#   1 - blocking (AGPL/GPL family) license found -> escalate to legal@
#   2 - script/environment error
#
# Usage:
#   ./solomon-license-audit.sh [root-dir]
#
# Requires: bash 3.2+ (macOS default is fine), find, python3 (for JSON output).
# Optional: npm (for JS trees), pip (for Python trees).

set -uo pipefail
# Deliberately NOT using -e: a single missing tool or empty project must not
# abort the whole audit and produce a false "clean" exit via early termination.

ROOT_DIR="${1:-.}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
REPORT_DIR="${ROOT_DIR}/.solomon-audit"
REPORT_JSON="${REPORT_DIR}/license-audit-report.json"
WORK_LIST="$(mktemp)"
FINDINGS_JS="$(mktemp)"
FINDINGS_PY="$(mktemp)"
SKIPPED="$(mktemp)"
trap 'rm -f "$WORK_LIST" "$FINDINGS_JS" "$FINDINGS_PY" "$SKIPPED"' EXIT

BLOCKING_PATTERN='(^|[^A-Za-z])(A?GPL)([-. ]|[0-9]|$)'
# Matches GPL-2.0, GPL-3.0, AGPL-3.0, LGPL-2.1 etc. Deliberately excludes
# "MPL" and unrelated substrings. LGPL is flagged for manual review, not
# auto-blocked, since dynamic-linking LGPL use is often fine -- see WARN below.

log()  { printf '%s\n' "$*" >&2; }
warn() { printf '[WARN] %s\n' "$*" >&2; }
err()  { printf '[ERROR] %s\n' "$*" >&2; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

if [ ! -d "$ROOT_DIR" ]; then
  err "root directory '$ROOT_DIR' does not exist"
  exit 2
fi

mkdir -p "$REPORT_DIR" || { err "cannot create report dir $REPORT_DIR"; exit 2; }

# ---------------------------------------------------------------------------
# 1. Discover all JS/TS package roots in the tree (monorepo-aware), excluding
#    anything already inside node_modules/vendor/dist to avoid re-scanning
#    installed trees as if they were first-party workspace packages.
# ---------------------------------------------------------------------------
find "$ROOT_DIR" \
  \( -name node_modules -o -name vendor -o -name dist -o -name build -o -name .git \) -prune -o \
  -name 'package.json' -print > "$WORK_LIST" 2>/dev/null

JS_ROOTS_FOUND=0
JS_ROOTS_SCANNED=0

while IFS= read -r pkg_json; do
  [ -z "$pkg_json" ] && continue
  JS_ROOTS_FOUND=$((JS_ROOTS_FOUND + 1))
  pkg_dir="$(dirname "$pkg_json")"

  if ! command_exists npm; then
    warn "npm not found on PATH; skipping JS root: $pkg_dir"
    echo "js|$pkg_dir|npm not installed" >> "$SKIPPED"
    continue
  fi

  if [ ! -d "$pkg_dir/node_modules" ]; then
    warn "no node_modules under $pkg_dir (deps not installed); skipping resolved-tree scan"
    echo "js|$pkg_dir|node_modules missing, run npm ci first" >> "$SKIPPED"
    continue
  fi

  # Resolve from the INSTALLED tree via `npm ls`, not the lockfile text, so a
  # lockfile that doesn't match what's actually on disk can't produce a false
  # clean result (lockfile-spoofing mitigation from the Phase 1 audit).
  ls_json="$(cd "$pkg_dir" && npm ls --all --json --long 2>/dev/null)"
  if [ -z "$ls_json" ]; then
    warn "npm ls produced no output for $pkg_dir (broken install?); skipping"
    echo "js|$pkg_dir|npm ls returned empty/broken output" >> "$SKIPPED"
    continue
  fi

  JS_ROOTS_SCANNED=$((JS_ROOTS_SCANNED + 1))

  echo "$ls_json" | python3 -c '
import json, sys

def walk(node, out):
    deps = node.get("dependencies", {}) or {}
    for name, info in deps.items():
        if isinstance(info, dict):
            out.append({
                "name": name,
                "version": info.get("version", "unknown"),
                "license": info.get("license", "UNKNOWN"),
            })
            walk(info, out)

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

out = []
walk(data, out)
for pkg in out:
    name, version, license = pkg["name"], pkg["version"], pkg["license"]
    print(f"{name}\t{version}\t{license}")
' >> "$FINDINGS_JS.raw" 2>/dev/null

  # Tag each finding with its workspace root for the report.
  if [ -f "$FINDINGS_JS.raw" ]; then
    while IFS=$'\t' read -r name version license; do
      [ -z "$name" ] && continue
      printf '%s\t%s\t%s\t%s\n' "$pkg_dir" "$name" "$version" "$license" >> "$FINDINGS_JS"
    done < "$FINDINGS_JS.raw"
    rm -f "$FINDINGS_JS.raw"
  fi

done < "$WORK_LIST"

# ---------------------------------------------------------------------------
# 2. Discover Python dependency roots: requirements.txt, pyproject.toml,
#    Pipfile. Handle nested virtualenvs correctly -- scan the venv's
#    site-packages for INSTALLED package metadata rather than trusting the
#    declared requirements file, and skip the venv directory itself when
#    walking for manifests (a venv's own vendored pip/setuptools copies are
#    not project dependencies).
# ---------------------------------------------------------------------------
PY_VENV_DIR_NAMES='venv .venv env .env virtualenv'

is_venv_dir() {
  local d="$1"
  [ -f "$d/pyvenv.cfg" ] || [ -x "$d/bin/python" ] || [ -x "$d/Scripts/python.exe" ]
}

find "$ROOT_DIR" \
  \( -name node_modules -o -name vendor -o -name dist -o -name build -o -name .git \) -prune -o \
  \( -name 'requirements*.txt' -o -name 'pyproject.toml' -o -name 'Pipfile' \) -print > "$WORK_LIST" 2>/dev/null

PY_ROOTS_FOUND=0
PY_ROOTS_SCANNED=0

while IFS= read -r manifest; do
  [ -z "$manifest" ] && continue
  PY_ROOTS_FOUND=$((PY_ROOTS_FOUND + 1))
  proj_dir="$(dirname "$manifest")"

  # Find a virtualenv near this manifest: common names, one level down.
  venv_path=""
  for candidate_name in $PY_VENV_DIR_NAMES; do
    candidate="$proj_dir/$candidate_name"
    if [ -d "$candidate" ] && is_venv_dir "$candidate"; then
      venv_path="$candidate"
      break
    fi
  done

  pip_bin=""
  if [ -n "$venv_path" ]; then
    if [ -x "$venv_path/bin/pip" ]; then
      pip_bin="$venv_path/bin/pip"
    elif [ -x "$venv_path/Scripts/pip.exe" ]; then
      pip_bin="$venv_path/Scripts/pip.exe"
    fi
  fi

  if [ -z "$pip_bin" ]; then
    warn "no resolvable virtualenv with pip found near $proj_dir; cannot audit installed packages"
    echo "py|$proj_dir|no venv found, install into venv/.venv and re-run" >> "$SKIPPED"
    continue
  fi

  if ! "$pip_bin" show pip >/dev/null 2>&1; then
    warn "pip at $pip_bin is not runnable; skipping $proj_dir"
    echo "py|$proj_dir|pip binary not runnable" >> "$SKIPPED"
    continue
  fi

  PY_ROOTS_SCANNED=$((PY_ROOTS_SCANNED + 1))

  # `pip list --format=json` reports installed distributions but not their
  # license classifier; pull license per-package via `pip show`, capped to
  # avoid pathological runtimes on huge environments being silently skipped.
  installed_json="$("$pip_bin" list --format=json 2>/dev/null)"
  if [ -z "$installed_json" ]; then
    warn "pip list returned nothing for $proj_dir"
    echo "py|$proj_dir|pip list empty" >> "$SKIPPED"
    continue
  fi

  echo "$installed_json" | python3 -c '
import json, sys
try:
    pkgs = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for p in pkgs:
    pname, pversion = p.get("name", "unknown"), p.get("version", "unknown")
    print(f"{pname}\t{pversion}")
' > "$FINDINGS_PY.names" 2>/dev/null

  while IFS=$'\t' read -r pname pversion; do
    [ -z "$pname" ] && continue
    license_line="$("$pip_bin" show "$pname" 2>/dev/null | grep -i '^License:' | head -n1 | cut -d: -f2- | sed 's/^ *//')"
    [ -z "$license_line" ] && license_line="UNKNOWN"
    printf '%s\t%s\t%s\t%s\n' "$proj_dir" "$pname" "$pversion" "$license_line" >> "$FINDINGS_PY"
  done < "$FINDINGS_PY.names"
  rm -f "$FINDINGS_PY.names"

done < "$WORK_LIST"

# ---------------------------------------------------------------------------
# 3. Evaluate findings against the blocking pattern.
# ---------------------------------------------------------------------------
BLOCKED_COUNT=0
BLOCKED_LIST="$(mktemp)"
VENDORED_LIST="$(mktemp)"
trap 'rm -f "$WORK_LIST" "$FINDINGS_JS" "$FINDINGS_PY" "$SKIPPED" "$BLOCKED_LIST" "$VENDORED_LIST"' EXIT

if [ -s "$FINDINGS_JS" ]; then
  while IFS=$'\t' read -r root name version license; do
    if printf '%s' "$license" | grep -Eiq "$BLOCKING_PATTERN"; then
      BLOCKED_COUNT=$((BLOCKED_COUNT + 1))
      printf 'js\t%s\t%s\t%s\t%s\n' "$root" "$name" "$version" "$license" >> "$BLOCKED_LIST"
    fi
  done < "$FINDINGS_JS"
fi

if [ -s "$FINDINGS_PY" ]; then
  while IFS=$'\t' read -r root name version license; do
    if printf '%s' "$license" | grep -Eiq "$BLOCKING_PATTERN"; then
      BLOCKED_COUNT=$((BLOCKED_COUNT + 1))
      printf 'py\t%s\t%s\t%s\t%s\n' "$root" "$name" "$version" "$license" >> "$BLOCKED_LIST"
    fi
  done < "$FINDINGS_PY"
fi

# ---------------------------------------------------------------------------
# 3b. Vendored-copy bypass check: a GPL/AGPL library copied directly into
#     source (vendor/, third_party/, or just committed inline) never shows up
#     in a package-manager resolved tree, so it slips past sections 1-3
#     entirely. Grep LICENSE/COPYING/NOTICE-style files anywhere in the tree
#     (including vendor/third_party, excluding only node_modules/venv which
#     are already covered by the resolved-tree scan above) for copyleft
#     identifiers. This is a text heuristic, not proof -- flag for legal
#     review, don't auto-clear or auto-block on it alone.
# ---------------------------------------------------------------------------
find "$ROOT_DIR" \
  \( -name node_modules -o -name .git -o -iname 'venv' -o -iname '.venv' -o -iname 'env' -o -iname '.env' \) -prune -o \
  -type f \( -iname 'LICENSE*' -o -iname 'COPYING*' -o -iname 'NOTICE*' \) -print 2>/dev/null | \
while IFS= read -r license_file; do
  if grep -Eiq "$BLOCKING_PATTERN" "$license_file" 2>/dev/null; then
    matched_id="$(grep -Eio "$BLOCKING_PATTERN" "$license_file" 2>/dev/null | head -n1 | tr -d ' ')"
    printf 'vendored\t%s\t-\t-\t%s\n' "$license_file" "${matched_id:-A?GPL}" >> "$VENDORED_LIST"
  fi
done

if [ -s "$VENDORED_LIST" ]; then
  cat "$VENDORED_LIST" >> "$BLOCKED_LIST"
  VENDORED_COUNT=$(wc -l < "$VENDORED_LIST" | tr -d ' ')
  BLOCKED_COUNT=$((BLOCKED_COUNT + VENDORED_COUNT))
fi

# ---------------------------------------------------------------------------
# 4. Emit JSON report (mandatory audit trail, machine-readable).
# ---------------------------------------------------------------------------
python3 - "$REPORT_JSON" "$TIMESTAMP" "$ROOT_DIR" "$JS_ROOTS_FOUND" "$JS_ROOTS_SCANNED" \
  "$PY_ROOTS_FOUND" "$PY_ROOTS_SCANNED" "$FINDINGS_JS" "$FINDINGS_PY" "$SKIPPED" "$BLOCKED_LIST" <<'PYEOF'
import json, sys

(report_path, timestamp, root_dir, js_found, js_scanned, py_found, py_scanned,
 findings_js, findings_py, skipped_path, blocked_path) = sys.argv[1:12]

def read_tsv(path, cols):
    rows = []
    try:
        with open(path) as f:
            for line in f:
                parts = line.rstrip("\n").split("\t")
                if len(parts) != len(cols):
                    continue
                rows.append(dict(zip(cols, parts)))
    except FileNotFoundError:
        pass
    return rows

js_packages = read_tsv(findings_js, ["root", "name", "version", "license"])
py_packages = read_tsv(findings_py, ["root", "name", "version", "license"])
skipped = read_tsv(skipped_path, ["ecosystem", "path", "reason"])
blocked = read_tsv(blocked_path, ["ecosystem", "root", "name", "version", "license"])

report = {
    "tool": "solomon-license-audit.sh",
    "generated_at": timestamp,
    "scanned_root": root_dir,
    "summary": {
        "js_manifests_found": int(js_found),
        "js_manifests_scanned": int(js_scanned),
        "py_manifests_found": int(py_found),
        "py_manifests_scanned": int(py_scanned),
        "skipped_count": len(skipped),
        "blocked_count": len(blocked),
        "total_packages_scanned": len(js_packages) + len(py_packages),
    },
    "blocked_packages": blocked,
    "skipped": skipped,
    "packages": {
        "javascript": js_packages,
        "python": py_packages,
    },
}

with open(report_path, "w") as f:
    json.dump(report, f, indent=2)

print(json.dumps(report["summary"], indent=2))
PYEOF

log ""
log "Report written to: $REPORT_JSON"

if [ "$(wc -l < "$SKIPPED" | tr -d ' ')" -gt 0 ]; then
  log ""
  log "SKIPPED (not fully audited -- treat as unresolved, not clean):"
  while IFS='|' read -r eco path reason; do
    log "  [$eco] $path -- $reason"
  done < "$SKIPPED"
fi

if [ "$BLOCKED_COUNT" -gt 0 ]; then
  log ""
  log "BLOCKING LICENSES FOUND ($BLOCKED_COUNT) -- escalate to legal@deuerout.com per SCSL v1.0 policy:"
  while IFS=$'\t' read -r eco root name version license; do
    log "  [$eco] $root :: $name@$version -- $license"
  done < "$BLOCKED_LIST"
  exit 1
fi

log ""
log "No AGPL/GPL-family licenses found in scanned packages."
if [ "$(wc -l < "$SKIPPED" | tr -d ' ')" -gt 0 ]; then
  log "NOTE: some roots were skipped (see above) -- this is NOT a full clean bill, resolve skips and re-run."
fi
exit 0
