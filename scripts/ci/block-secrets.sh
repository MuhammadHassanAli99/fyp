#!/usr/bin/env bash
# Block only:
#   1) paths that match .gitignore
#   2) env-related files (.env, .env.*, *.env)
# Example templates (.env.example, .env.*.example) are allowed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"
ERRORS=0

err() {
  echo "::error::$1"
  ERRORS=$((ERRORS + 1))
}

is_example_env() {
  case "$1" in
    *.env.example|*.env.*.example) return 0 ;;
    *) return 1 ;;
  esac
}

is_env_file() {
  local base
  base="$(basename "$1")"
  case "${base}" in
    .env|.env.*|*.env) return 0 ;;
    *) return 1 ;;
  esac
}

while IFS= read -r file; do
  [[ -z "${file}" ]] && continue
  if is_example_env "${file}"; then
    continue
  fi
  if is_env_file "${file}"; then
    err "Refusing to commit env file: ${file}"
    continue
  fi
  if git check-ignore --no-index -q -- "${file}"; then
    err "Refusing to commit gitignored file: ${file}"
  fi
done < <(git diff --cached --name-only --diff-filter=ACMR || true)

if ((ERRORS > 0)); then
  echo "::error::Git check failed with ${ERRORS} issue(s)"
  exit 1
fi

echo "Git check passed (gitignore + env only)"
