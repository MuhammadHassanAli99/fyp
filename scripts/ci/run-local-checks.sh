#!/usr/bin/env bash
# Run basic / intermediate / advanced checks locally.
# Usage: ./scripts/ci/run-local-checks.sh [basic|intermediate|advanced|all]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LEVEL="${1:-basic}"
cd "${ROOT}"

chmod +x scripts/ci/*.sh

run_basic() {
  echo "======== BASIC CHECKS ========"
  ./scripts/ci/validate-repo.sh
  ./scripts/ci/validate-languages.sh
  ./scripts/ci/validate-sql.sh
  ./scripts/ci/validate-platforms.sh

  if [[ -d backend/node_modules ]]; then
    (cd backend && npm run typecheck)
  else
    echo "Skipping backend typecheck (run npm ci in backend first)"
  fi

  if command -v flutter >/dev/null 2>&1; then
    (cd frontend && dart format --output=none --set-exit-if-changed . && flutter analyze --no-fatal-infos --fatal-warnings)
  else
    echo "Skipping Flutter basic checks (flutter not on PATH)"
  fi
}

run_intermediate_only() {
  echo "======== INTERMEDIATE CHECKS ========"
  if [[ -d backend/node_modules ]]; then
    (cd backend && npm test && npm run build)
  else
    echo "Skipping backend tests (run npm ci in backend first)"
  fi
  if command -v flutter >/dev/null 2>&1; then
    (cd frontend && flutter test)
  else
    echo "Skipping Flutter tests (flutter not on PATH)"
  fi
  echo "Debug builds for Android, iOS, macOS, Linux, Windows, and Web run in GitHub Actions."
}

run_advanced_only() {
  echo "======== ADVANCED CHECKS ========"
  if command -v flutter >/dev/null 2>&1; then
    (cd frontend && flutter test --coverage)
  fi
  if command -v docker >/dev/null 2>&1; then
    docker build -f backend/Dockerfile -t marketplace-api:local .
  else
    echo "Skipping Docker build (docker not on PATH)"
  fi
  echo "Release builds for Android, iOS, macOS, Linux, Windows, and Web run in GitHub Actions."
  echo "CodeQL, Trivy, and npm audit run in GitHub Actions."
}

case "${LEVEL}" in
  basic) run_basic ;;
  intermediate)
    run_basic
    run_intermediate_only
    ;;
  advanced)
    run_basic
    run_intermediate_only
    run_advanced_only
    ;;
  all)
    run_basic
    run_intermediate_only
    run_advanced_only
    ;;
  *)
    echo "Usage: $0 [basic|intermediate|advanced|all]"
    exit 2
    ;;
esac

echo "Local ${LEVEL} checks finished."
