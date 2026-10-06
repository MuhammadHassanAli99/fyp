#!/usr/bin/env bash
# Ensures Flutter platform project scaffolds exist for all supported targets.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FRONTEND="${ROOT}/frontend"
ERRORS=0

err() {
  echo "::error::$1"
  ERRORS=$((ERRORS + 1))
}

require_file() {
  local path="$1"
  if [[ ! -f "${path}" ]]; then
    err "Missing required platform file: ${path#"${ROOT}"/}"
  fi
}

require_dir() {
  local path="$1"
  if [[ ! -d "${path}" ]]; then
    err "Missing required platform directory: ${path#"${ROOT}"/}"
  fi
}

echo "==> Validating Flutter multi-platform project layout"

require_file "${FRONTEND}/pubspec.yaml"
require_file "${FRONTEND}/analysis_options.yaml"
require_dir "${FRONTEND}/lib"
require_dir "${FRONTEND}/test"

# Android (Kotlin / Java / Gradle)
require_dir "${FRONTEND}/android"
require_file "${FRONTEND}/android/settings.gradle.kts"
require_file "${FRONTEND}/android/build.gradle.kts"
require_file "${FRONTEND}/android/app/build.gradle.kts"
require_file "${FRONTEND}/android/gradle.properties"
require_file "${FRONTEND}/android/gradlew"
require_file "${FRONTEND}/android/gradlew.bat"
require_file "${FRONTEND}/android/gradle/wrapper/gradle-wrapper.properties"
require_file "${FRONTEND}/android/gradle/wrapper/gradle-wrapper.jar"
require_file "${FRONTEND}/android/app/src/main/AndroidManifest.xml"
require_file "${FRONTEND}/android/app/src/debug/AndroidManifest.xml"
require_file "${FRONTEND}/android/app/src/profile/AndroidManifest.xml"
require_file "${FRONTEND}/android/app/src/main/kotlin/com/example/frontend/MainActivity.kt"

# iOS (Swift / Objective-C / Xcode / CocoaPods)
require_dir "${FRONTEND}/ios"
require_file "${FRONTEND}/ios/Podfile"
require_file "${FRONTEND}/ios/Runner.xcodeproj/project.pbxproj"
require_dir "${FRONTEND}/ios/Runner"
require_file "${FRONTEND}/ios/Runner/AppDelegate.swift"
require_file "${FRONTEND}/ios/Runner/SceneDelegate.swift"
require_file "${FRONTEND}/ios/Runner/Info.plist"
require_file "${FRONTEND}/ios/Runner/Runner-Bridging-Header.h"
require_file "${FRONTEND}/ios/RunnerTests/RunnerTests.swift"

# macOS (Swift / Xcode / CocoaPods)
require_dir "${FRONTEND}/macos"
require_file "${FRONTEND}/macos/Podfile"
require_file "${FRONTEND}/macos/Runner.xcodeproj/project.pbxproj"
require_dir "${FRONTEND}/macos/Runner"
require_file "${FRONTEND}/macos/Runner/AppDelegate.swift"
require_file "${FRONTEND}/macos/Runner/MainFlutterWindow.swift"
require_file "${FRONTEND}/macos/Runner/Info.plist"
require_file "${FRONTEND}/macos/RunnerTests/RunnerTests.swift"

# Linux (CMake / C++)
require_dir "${FRONTEND}/linux"
require_file "${FRONTEND}/linux/CMakeLists.txt"
require_file "${FRONTEND}/linux/runner/CMakeLists.txt"
require_file "${FRONTEND}/linux/runner/main.cc"
require_file "${FRONTEND}/linux/runner/my_application.cc"
require_file "${FRONTEND}/linux/runner/my_application.h"

# Windows (CMake / C++)
require_dir "${FRONTEND}/windows"
require_file "${FRONTEND}/windows/CMakeLists.txt"
require_file "${FRONTEND}/windows/runner/CMakeLists.txt"
require_file "${FRONTEND}/windows/runner/main.cpp"
require_file "${FRONTEND}/windows/runner/flutter_window.cpp"
require_file "${FRONTEND}/windows/runner/win32_window.cpp"
require_file "${FRONTEND}/windows/runner/Runner.rc"
require_file "${FRONTEND}/windows/runner/runner.exe.manifest"

# Web (HTML / JSON)
require_dir "${FRONTEND}/web"
require_file "${FRONTEND}/web/index.html"
require_file "${FRONTEND}/web/manifest.json"

# Language / tool config sanity
if ! grep -q 'sdk:' "${FRONTEND}/pubspec.yaml"; then
  err "pubspec.yaml missing Dart SDK constraint"
fi

if [[ -f "${FRONTEND}/ios/Podfile" ]]; then
  if command -v ruby >/dev/null 2>&1; then
    ruby -c "${FRONTEND}/ios/Podfile" >/dev/null
    ruby -c "${FRONTEND}/macos/Podfile" >/dev/null
  else
    echo "Ruby not available; skipping Podfile syntax check"
  fi
fi

if [[ -f "${FRONTEND}/linux/CMakeLists.txt" ]]; then
  if ! grep -q 'cmake_minimum_required' "${FRONTEND}/linux/CMakeLists.txt"; then
    err "linux/CMakeLists.txt missing cmake_minimum_required"
  fi
  if ! grep -q 'cmake_minimum_required' "${FRONTEND}/windows/CMakeLists.txt"; then
    err "windows/CMakeLists.txt missing cmake_minimum_required"
  fi
fi

if ! grep -q 'SDKROOT = iphoneos' "${FRONTEND}/ios/Runner.xcodeproj/project.pbxproj"; then
  err "iOS project is missing SDKROOT = iphoneos"
fi
if ! grep -q 'SDKROOT = macosx' "${FRONTEND}/macos/Runner.xcodeproj/project.pbxproj"; then
  err "macOS project is missing SDKROOT = macosx"
fi
if ! grep -q 'org.jetbrains.kotlin.android' "${FRONTEND}/android/settings.gradle.kts"; then
  err "Android settings are missing the Kotlin plugin"
fi
if ! grep -q 'com.android.application' "${FRONTEND}/android/settings.gradle.kts"; then
  err "Android settings are missing the Android application plugin"
fi

if ((ERRORS > 0)); then
  echo "::error::Platform validation failed with ${ERRORS} issue(s)"
  exit 1
fi

echo "Platform layout validation passed (android, ios, macos, linux, windows, web)"
