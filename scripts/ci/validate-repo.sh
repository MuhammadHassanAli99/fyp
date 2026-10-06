#!/usr/bin/env bash
# Basic repository hygiene checks (secrets, large files, forbidden paths).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"
ERRORS=0

err() {
  echo "::error::$1"
  ERRORS=$((ERRORS + 1))
}

warn() {
  echo "::warning::$1"
}

echo "==> Repository hygiene checks"

# Tracked secret-like files must not be committed.
while IFS= read -r file; do
  [[ -z "${file}" ]] && continue
  case "${file}" in
    *.env.example|*.env.*.example) continue ;;
  esac
  err "Secret-like file is tracked by git: ${file}"
done < <(git ls-files | grep -E '(^|/)\.env($|\.)|credentials\.json$|serviceAccount.*\.json$|\.pem$|\.p12$|\.keystore$' || true)

# Vendor / build artifacts should not be tracked (summarized).
vendor_count="$( { git ls-files | grep -E '(^|/)node_modules/|(^|/)frontend/build/|(^|/)\.dart_tool/|(^|/)coverage/' || true; } | wc -l | tr -d ' ')"
if [[ "${vendor_count}" != "0" ]]; then
  warn "${vendor_count} vendor/build files are tracked (node_modules/.dart_tool/build). Prefer: git rm -r --cached backend/node_modules frontend/.dart_tool frontend/build"
fi

# Soft secret content scan on tracked source (exclude locks, examples, vendor).
scan_paths=(
  ':!**/node_modules/**'
  ':!**/.dart_tool/**'
  ':!**/build/**'
  ':!**/*.lock'
  ':!**/package-lock.json'
  ':!**/.env.example'
  ':!**/.env.*.example'
)

check_pattern() {
  local label="$1"
  local pattern="$2"
  local matches
  matches="$(git grep -I -n -E -e "${pattern}" -- . "${scan_paths[@]}" 2>/dev/null || true)"
  if [[ -n "${matches}" ]]; then
    err "Potential secret pattern matched (${label})"
    echo "${matches}" | head -n 20
  fi
}

check_pattern "AWS access key" 'AKIA[0-9A-Z]{16}'
check_pattern "Private key block" '-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----'
check_pattern "GitHub PAT" 'ghp_[A-Za-z0-9]{36}'
check_pattern "GitHub fine-grained PAT" 'github_pat_[A-Za-z0-9_]{20,}'
check_pattern "Slack token" 'xox[baprs]-[A-Za-z0-9-]{10,}'

require_present() {
  local rel="$1"
  if [[ ! -f "${ROOT}/${rel}" ]]; then
    err "Missing required file: ${rel}"
  fi
}

for rel in \
  .gitattributes \
  .gitignore \
  .gitleaks.toml \
  .pre-commit-config.yaml \
  .github/dependabot.yml \
  .github/workflows/basic-checks.yml \
  .github/workflows/intermediate-checks.yml \
  .github/workflows/advanced-checks.yml \
  .github/workflows/flutter-platforms.yml \
  .github/actions/setup-backend/action.yml \
  .github/actions/setup-flutter/action.yml \
  scripts/ci/validate-languages.sh \
  scripts/ci/validate_languages.py \
  scripts/ci/validate-platforms.sh \
  scripts/ci/validate-sql.sh \
  scripts/ci/validate-repo.sh \
  scripts/ci/block-secrets.sh \
  scripts/ci/run-local-checks.sh \
  backend/Dockerfile \
  backend/package.json \
  backend/package-lock.json \
  backend/tsconfig.json \
  frontend/pubspec.yaml \
  frontend/analysis_options.yaml
do
  require_present "${rel}"
done

if ! grep -q 'validate-languages.sh' "${ROOT}/.github/workflows/basic-checks.yml"; then
  err "basic-checks.yml does not run validate-languages.sh"
fi
if ! grep -q 'flutter-platforms.yml' "${ROOT}/.github/workflows/intermediate-checks.yml"; then
  err "intermediate-checks.yml does not build all platforms"
fi
if ! grep -q 'mode: debug' "${ROOT}/.github/workflows/intermediate-checks.yml"; then
  err "intermediate-checks.yml does not request debug platform builds"
fi
if ! grep -q 'flutter-platforms.yml' "${ROOT}/.github/workflows/advanced-checks.yml"; then
  err "advanced-checks.yml does not build all platforms"
fi
if ! grep -q 'mode: release' "${ROOT}/.github/workflows/advanced-checks.yml"; then
  err "advanced-checks.yml does not request release platform builds"
fi

platforms_workflow="${ROOT}/.github/workflows/flutter-platforms.yml"
if [[ -f "${platforms_workflow}" ]]; then
  for name in Android iOS macOS Linux Windows Web; do
    if ! grep -q "platform: ${name}" "${platforms_workflow}"; then
      err "flutter-platforms.yml is missing the ${name} target"
    fi
  done
  for key in debug_command release_command; do
    count="$(grep -c "${key}:" "${platforms_workflow}" || true)"
    if [[ "${count}" -ne 6 ]]; then
      err "flutter-platforms.yml has ${count} ${key} entries; expected 6 platforms"
    fi
  done
fi

# Fail on very large tracked non-vendor files (>5 MiB).
while IFS= read -r file; do
  [[ -z "${file}" ]] && continue
  [[ ! -f "${file}" ]] && continue
  case "${file}" in
    *node_modules*|*.dart_tool*|frontend/build/*|*/Pods/*) continue ;;
  esac
  size="$(wc -c < "${file}" | tr -d ' ')"
  if ((size > 5242880)); then
    err "Tracked file larger than 5 MiB (${size} bytes): ${file}"
  fi
done < <(git ls-files)

if ((ERRORS > 0)); then
  echo "::error::Repository hygiene failed with ${ERRORS} issue(s)"
  exit 1
fi

echo "Repository hygiene checks passed"
