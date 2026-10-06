#!/usr/bin/env bash
# Light check: block real secrets from being committed. Does not scan all source.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"
ERRORS=0

err() {
  echo "::error::$1"
  ERRORS=$((ERRORS + 1))
}

# Staged secret-like paths (examples allowed).
while IFS= read -r file; do
  [[ -z "${file}" ]] && continue
  case "${file}" in
    *.env.example|*.env.*.example) continue ;;
  esac
  err "Refusing to commit secret-like file: ${file}"
done < <(
  git diff --cached --name-only --diff-filter=ACMR \
    | grep -E '(^|/)\.env($|\.)|credentials\.json$|serviceAccount.*\.json$|google-services\.json$|GoogleService-Info\.plist$|\.pem$|\.p12$|\.p8$|\.keystore$|\.jks$' \
    || true
)

# Staged private-key content (detect-private-key also covers common filenames).
if git diff --cached --diff-filter=ACMR | grep -qE -e '-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----'; then
  err "Staged diff contains a private key block"
fi

if ((ERRORS > 0)); then
  echo "::error::Secret check failed with ${ERRORS} issue(s)"
  exit 1
fi

echo "Secret check passed"
