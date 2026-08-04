#!/usr/bin/env bash
# Warning-only: suggest docs/SYSTEM.md may be stale if pipeline code changed more recently.
# Does not rewrite the doc. Does not block push (always exits 0 when used as a hook).

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${ROOT}" ]]; then
  echo "check-system-doc-stale: not inside a git repository; skipping."
  exit 0
fi

cd "${ROOT}"

DOC_PATH="docs/SYSTEM.md"
CODE_PATHS=("api/" "src/pages/tools/")

if [[ ! -f "${DOC_PATH}" ]]; then
  echo "WARNING: ${DOC_PATH} is missing. The content-pipeline system doc may need to be created or restored."
  echo "         See docs/SYSTEM.md — update it whenever pipeline stages or design decisions change."
  exit 0
fi

doc_ts="$(git log -1 --format=%ct -- "${DOC_PATH}" 2>/dev/null || true)"
code_ts="$(git log -1 --format=%ct -- "${CODE_PATHS[@]}" 2>/dev/null || true)"

if [[ -z "${doc_ts}" ]]; then
  echo "WARNING: ${DOC_PATH} exists but has no git history yet."
  echo "         Commit it after reviewing so doc freshness can be tracked."
  exit 0
fi

if [[ -z "${code_ts}" ]]; then
  # No commits under api/ or tools yet — nothing to compare.
  exit 0
fi

if [[ "${doc_ts}" -lt "${code_ts}" ]]; then
  doc_when="$(git log -1 --format='%ci (%h)' -- "${DOC_PATH}" 2>/dev/null || echo "unknown")"
  code_when="$(git log -1 --format='%ci (%h) %s' -- "${CODE_PATHS[@]}" 2>/dev/null || echo "unknown")"
  echo "WARNING: docs/SYSTEM.md may be stale."
  echo "         Last SYSTEM.md commit: ${doc_when}"
  echo "         Newer commit touching api/ or src/pages/tools/: ${code_when}"
  echo "         Review and update docs/SYSTEM.md if the content pipeline changed (sections 4 and 6)."
  echo "         (This is a warning only; push is not blocked.)"
fi

exit 0
