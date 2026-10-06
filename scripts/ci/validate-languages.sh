#!/usr/bin/env bash
# Static checks for every language used in this repo:
# TypeScript, Dart, Kotlin, Java, Swift, Objective-C, C/C++, CMake,
# Gradle, SQL (via validate-sql.sh), Ruby, YAML, JSON, XML, Shell, Docker, HTML.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"
export PYTHONDONTWRITEBYTECODE=1

status=0

if command -v python3 >/dev/null 2>&1; then
  PY=(python3)
elif command -v python >/dev/null 2>&1; then
  PY=(python)
else
  echo "::error::python3 is required for language checks"
  exit 1
fi

echo "==> Language file checks"
"${PY[@]}" "${ROOT}/scripts/ci/validate_languages.py" || status=1

echo "==> YAML"
yaml_files=(
  "${ROOT}/frontend/pubspec.yaml"
  "${ROOT}/frontend/analysis_options.yaml"
  "${ROOT}/frontend/pubspec.lock"
  "${ROOT}/.pre-commit-config.yaml"
  "${ROOT}/.github/dependabot.yml"
)
shopt -s nullglob
for file in "${ROOT}/.github/workflows/"*.yml "${ROOT}/.github/actions/"*/*.yml; do
  yaml_files+=("${file}")
done
shopt -u nullglob

if [[ ${#yaml_files[@]} -eq 0 ]]; then
  echo "::error::no project YAML files found"
  status=1
else
  ruby -ryaml - "${yaml_files[@]}" <<'RUBY' || status=1
def load_yaml(path)
  content = File.read(path, encoding: "UTF-8")
  begin
    YAML.safe_load(content, aliases: true)
  rescue ArgumentError
    YAML.safe_load(content, [], [], true)
  end
end

failed = 0
ARGV.each do |path|
  begin
    load_yaml(path)
    puts "yaml ok: #{path}"
  rescue StandardError => e
    warn "YAML parse failed: #{path}: #{e.message}"
    failed += 1
  end
end
if failed.positive?
  abort "::error::YAML checks failed with #{failed} file(s)"
end
puts "PASS YAML (#{ARGV.length} file(s))"
RUBY
fi

echo "==> Ruby Podfiles"
ruby -c "${ROOT}/frontend/ios/Podfile" || status=1
ruby -c "${ROOT}/frontend/macos/Podfile" || status=1

echo "==> Shell syntax"
shopt -s nullglob
shell_scripts=("${ROOT}/scripts/ci/"*.sh)
shopt -u nullglob
if [[ ${#shell_scripts[@]} -eq 0 ]]; then
  echo "::error::no CI shell scripts found"
  status=1
else
  for script in "${shell_scripts[@]}"; do
    bash -n "${script}" || status=1
  done
fi

if command -v shellcheck >/dev/null 2>&1; then
  echo "==> ShellCheck"
  shellcheck "${shell_scripts[@]}" || status=1
elif [[ "${REQUIRE_SHELLCHECK:-0}" == "1" ]]; then
  echo "::error::shellcheck is required in CI but was not found"
  status=1
else
  echo "ShellCheck not installed; bash -n syntax check only"
fi

if [[ "${status}" -ne 0 ]]; then
  echo "::error::Language checks failed"
  exit 1
fi

echo "Language checks passed (TypeScript, Dart, Kotlin, Java, Swift, Objective-C, C/C++, CMake, Gradle, Ruby, YAML, JSON, XML, Shell, Docker, HTML)"
