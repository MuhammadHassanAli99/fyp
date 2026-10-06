#!/usr/bin/env bash
# Basic + intermediate static checks for database SQL assets.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS_DIR="${ROOT}/database/migrations"
SEEDS_DIR="${ROOT}/database/seeds"
ERRORS=0

err() {
  echo "::error::$1"
  ERRORS=$((ERRORS + 1))
}

count_matches() {
  local pattern="$1"
  local file="$2"
  { grep -o "${pattern}" "${file}" || true; } | wc -l | tr -d ' '
}

echo "==> Validating SQL migrations and seeds"

if [[ ! -d "${MIGRATIONS_DIR}" ]]; then
  err "Missing migrations directory: ${MIGRATIONS_DIR}"
  exit 1
fi

shopt -s nullglob
migrations=("${MIGRATIONS_DIR}"/*.sql)
seeds=("${SEEDS_DIR}"/*.sql)
shopt -u nullglob

if ((${#migrations[@]} == 0)); then
  err "No migration SQL files found in database/migrations"
fi

prev=""
crlf_count=0
for file in "${migrations[@]}"; do
  base="$(basename "${file}")"

  if [[ ! "${base}" =~ ^[0-9]{3}_[a-z0-9_]+\.sql$ ]]; then
    err "Migration name must match NNN_snake_case.sql: ${base}"
  fi

  if [[ -n "${prev}" && ! "${base}" > "${prev}" ]]; then
    err "Migrations are not strictly ordered: ${prev} then ${base}"
  fi
  prev="${base}"

  if [[ ! -s "${file}" ]]; then
    err "Empty migration file: ${base}"
    continue
  fi

  if grep -q $'\r' "${file}"; then
    crlf_count=$((crlf_count + 1))
  fi

  if file "${file}" | grep -qi 'UTF-16\|UTF-32'; then
    err "Non-UTF8 encoding detected: ${base}"
  fi

  if grep -Eiq '(^|[[:space:]])DROP[[:space:]]+DATABASE[[:space:]]' "${file}"; then
    err "DROP DATABASE is forbidden in migrations: ${base}"
  fi

  opens="$(count_matches '/\*' "${file}")"
  closes="$(count_matches '\*/' "${file}")"
  if [[ "${opens}" != "${closes}" ]]; then
    err "Unbalanced block comments in ${base} (/*=${opens} */=${closes})"
  fi
done

for file in "${seeds[@]}"; do
  base="$(basename "${file}")"
  if [[ ! -s "${file}" ]]; then
    err "Empty seed file: ${base}"
  fi
  if grep -q $'\r' "${file}"; then
    crlf_count=$((crlf_count + 1))
  fi
done

if ((crlf_count > 0)); then
  echo "::warning::${crlf_count} SQL file(s) use CRLF line endings (prefer LF; see .gitattributes)"
fi

echo "Checked ${#migrations[@]} migrations and ${#seeds[@]} seeds"

if ((ERRORS > 0)); then
  echo "::error::SQL validation failed with ${ERRORS} issue(s)"
  exit 1
fi

echo "SQL validation passed"
