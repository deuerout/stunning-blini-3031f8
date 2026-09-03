#!/usr/bin/env bash
#
# make-fixtures.sh
#
# Reproducibly builds the mock test directory structure used to prove
# solomon-license-audit.sh and generate-sbom.sh work correctly:
#
#   monorepo/packages/api  - JS workspace with a GPL-3.0 resolved dependency
#                             (must be flagged) and a vendored AGPL copy
#                             pasted directly into source, not via a package
#                             manager (must ALSO be flagged -- the bypass
#                             case called out in the Phase 1 audit).
#   monorepo/packages/web  - JS workspace, MIT only (must come back clean).
#   uninstalled-service    - package.json with no node_modules installed
#                             (must be reported SKIPPED, never silently clean).
#   py-service              - Python project with a real venv containing one
#                             MIT and one AGPL-3.0 package (installed via
#                             hand-crafted dist-info metadata so this runs
#                             offline, with no PyPI network dependency).
#
# The generated node_modules/, venv/, and .solomon-audit/ directories are
# build output, not source -- see ../.gitignore. Re-run this script any time
# you need the fixtures back (e.g. after a fresh checkout).
#
# Usage: ./make-fixtures.sh

set -euo pipefail
cd "$(dirname "$0")"

rm -rf monorepo uninstalled-service py-service

# --- JS monorepo: api (GPL dep + vendored AGPL bypass), web (clean) ---
mkdir -p monorepo/packages/api/node_modules/left-pad-clone
mkdir -p monorepo/packages/api/node_modules/gpl-lib-mock
mkdir -p monorepo/packages/web/node_modules/react-clone
mkdir -p monorepo/packages/api/vendor/some-agpl-tool

cat > monorepo/packages/api/package.json <<'EOF'
{
  "name": "solomon-api",
  "version": "1.0.0",
  "dependencies": {
    "left-pad-clone": "^1.0.0",
    "gpl-lib-mock": "^2.0.0"
  }
}
EOF
cat > monorepo/packages/api/node_modules/left-pad-clone/package.json <<'EOF'
{ "name": "left-pad-clone", "version": "1.0.0", "license": "MIT" }
EOF
cat > monorepo/packages/api/node_modules/gpl-lib-mock/package.json <<'EOF'
{ "name": "gpl-lib-mock", "version": "2.0.0", "license": "GPL-3.0-only" }
EOF
cat > monorepo/packages/api/vendor/some-agpl-tool/LICENSE <<'EOF'
GNU AFFERO GENERAL PUBLIC LICENSE
Version 3, 19 November 2007
... (full AGPL-3.0 text would go here) ...
EOF

cat > monorepo/packages/web/package.json <<'EOF'
{
  "name": "solomon-web",
  "version": "1.0.0",
  "dependencies": {
    "react-clone": "^18.0.0"
  }
}
EOF
cat > monorepo/packages/web/node_modules/react-clone/package.json <<'EOF'
{ "name": "react-clone", "version": "18.0.0", "license": "MIT" }
EOF

# --- JS root with deps declared but never installed ---
mkdir -p uninstalled-service
cat > uninstalled-service/package.json <<'EOF'
{ "name": "solomon-uninstalled", "version": "0.1.0", "dependencies": { "some-dep": "^1.0.0" } }
EOF

# --- Python project: real venv, hand-crafted dist-info (no PyPI needed) ---
mkdir -p py-service
cat > py-service/requirements.txt <<'EOF'
friendly-pkg==1.0.0
copyleft-pkg==2.0.0
EOF

python3 -m venv py-service/venv
VENVSITE="$(py-service/venv/bin/python -c 'import site; print(site.getsitepackages()[0])')"

mkdir -p "$VENVSITE/friendly_pkg-1.0.0.dist-info"
cat > "$VENVSITE/friendly_pkg-1.0.0.dist-info/METADATA" <<'EOF'
Metadata-Version: 2.1
Name: friendly-pkg
Version: 1.0.0
License: MIT
Summary: A friendly MIT-licensed test package.
EOF
echo "friendly_pkg-1.0.0.dist-info/METADATA,," > "$VENVSITE/friendly_pkg-1.0.0.dist-info/RECORD"
: > "$VENVSITE/friendly_pkg.py"

mkdir -p "$VENVSITE/copyleft_pkg-2.0.0.dist-info"
cat > "$VENVSITE/copyleft_pkg-2.0.0.dist-info/METADATA" <<'EOF'
Metadata-Version: 2.1
Name: copyleft-pkg
Version: 2.0.0
License: GNU Affero General Public License v3 (AGPL-3.0)
Summary: A copyleft test package that should be flagged.
EOF
echo "copyleft_pkg-2.0.0.dist-info/METADATA,," > "$VENVSITE/copyleft_pkg-2.0.0.dist-info/RECORD"
: > "$VENVSITE/copyleft_pkg.py"

echo "Fixtures built under $(pwd)"
