#!/usr/bin/env python3
"""Static checks for every language in this repository.

Compile, test, and release builds stay in the GitHub Actions workflows.
This script is the fast gate: file shape, encoding, and language entrypoints.
"""

from __future__ import annotations

import json
import os
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]

SKIP_DIRS = {
    "node_modules",
    ".dart_tool",
    "build",
    "Pods",
    "ephemeral",
    ".gradle",
    "coverage",
    ".pub",
    ".pub-cache",
    ".idea",
}

TEXT_SUFFIXES = {
    ".ts",
    ".dart",
    ".sql",
    ".kt",
    ".kts",
    ".java",
    ".swift",
    ".m",
    ".mm",
    ".h",
    ".cc",
    ".cpp",
    ".hpp",
    ".c",
    ".xml",
    ".yml",
    ".yaml",
    ".json",
    ".arb",
    ".sh",
    ".plist",
    ".html",
    ".properties",
    ".gradle",
    ".cmake",
    ".rc",
    ".manifest",
}

SPECIAL_NAMES = {"Dockerfile", "Podfile", "CMakeLists.txt", "gradlew"}


class Section:
    def __init__(self, name: str) -> None:
        self.name = name
        self.errors: list[str] = []
        self.checked = 0

    def err(self, message: str) -> None:
        self.errors.append(message)
        print(f"::error::{message}")

    def finish(self) -> None:
        if self.errors:
            print(f"FAIL {self.name} ({len(self.errors)} issue(s), {self.checked} file(s))")
        else:
            print(f"PASS {self.name} ({self.checked} file(s))")


def rel(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def read_text(section: Section, path: Path) -> str | None:
    section.checked += 1
    if not path.is_file():
        section.err(f"missing file: {rel(path)}")
        return None
    try:
        data = path.read_bytes()
    except OSError as exc:
        section.err(f"cannot read {rel(path)}: {exc}")
        return None
    if b"\0" in data:
        section.err(f"binary content in text file: {rel(path)}")
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        section.err(f"file is not UTF-8: {rel(path)}")
        return None


def require_contains(section: Section, path: Path, needles: tuple[str, ...]) -> str | None:
    text = read_text(section, path)
    if text is None:
        return None
    for needle in needles:
        if needle not in text:
            section.err(f"{rel(path)} is missing {needle!r}")
    return text


def iter_files(root: Path):
    if not root.exists():
        return
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name not in SKIP_DIRS]
        for name in filenames:
            yield Path(dirpath) / name


def skipped(path: Path) -> bool:
    return any(part in SKIP_DIRS for part in path.parts)


def parse_xml(section: Section, path: Path) -> None:
    text = read_text(section, path)
    if text is None:
        return
    stripped = re.sub(r"<!DOCTYPE[^>]*>", "", text)
    try:
        ET.fromstring(stripped)
    except ET.ParseError as exc:
        section.err(f"invalid XML in {rel(path)}: {exc}")


def check_jvm_package(section: Section, base: Path, suffix: str, marker: str) -> int:
    found = 0
    if not base.is_dir():
        section.err(f"missing directory: {rel(base)}")
        return 0
    for path in base.rglob(f"*{suffix}"):
        if skipped(path):
            continue
        found += 1
        text = read_text(section, path)
        if text is None:
            continue
        match = re.search(
            r"(?m)^package\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*;?\s*$",
            text,
        )
        if match is None:
            section.err(f"{rel(path)} is missing a package declaration")
            continue
        parts = path.parts
        try:
            index = parts.index(marker)
        except ValueError:
            section.err(f"{rel(path)} is not under a {marker}/ source root")
            continue
        expected = ".".join(parts[index + 1 : -1])
        actual = match.group(1)
        if actual != expected:
            section.err(
                f"{rel(path)} package {actual} does not match directory {expected}"
            )
    return found


def consider(section: Section, path: Path) -> None:
    if path.suffix.lower() not in TEXT_SUFFIXES and path.name not in SPECIAL_NAMES:
        return
    text = read_text(section, path)
    if text is None:
        return
    for line_number, line in enumerate(text.splitlines(), 1):
        if line.startswith("<<<<<<<") or line.startswith(">>>>>>>"):
            section.err(f"merge conflict marker in {rel(path)}:{line_number}")


def check_source_hygiene(section: Section) -> None:
    roots = [
        ROOT / "backend" / "src",
        ROOT / "frontend",
        ROOT / "database",
        ROOT / "scripts",
        ROOT / ".github",
    ]
    extras = [
        ROOT / "backend" / "Dockerfile",
        ROOT / "backend" / "package.json",
        ROOT / "backend" / "tsconfig.json",
    ]
    seen: set[Path] = set()
    for root in roots:
        if not root.exists():
            section.err(f"missing source tree: {rel(root)}")
            continue
        for path in iter_files(root):
            seen.add(path)
            consider(section, path)
    for path in extras:
        if path not in seen:
            consider(section, path)


def check_typescript(section: Section) -> None:
    package_path = ROOT / "backend" / "package.json"
    tsconfig_path = ROOT / "backend" / "tsconfig.json"
    package_text = read_text(section, package_path)
    tsconfig_text = read_text(section, tsconfig_path)
    if package_text is not None:
        try:
            package = json.loads(package_text)
        except json.JSONDecodeError as exc:
            section.err(f"invalid package.json: {exc}")
            package = None
        if isinstance(package, dict):
            engines = package.get("engines") or {}
            if not engines.get("node"):
                section.err("backend/package.json is missing engines.node")
            scripts = package.get("scripts") or {}
            for name in ("typecheck", "test", "build"):
                if name not in scripts:
                    section.err(f"backend/package.json is missing scripts.{name}")
    if tsconfig_text is not None:
        try:
            tsconfig = json.loads(tsconfig_text)
        except json.JSONDecodeError as exc:
            section.err(f"invalid tsconfig.json: {exc}")
            tsconfig = None
        if isinstance(tsconfig, dict):
            options = tsconfig.get("compilerOptions") or {}
            if options.get("strict") is not True:
                section.err("backend/tsconfig.json must set compilerOptions.strict to true")
    sources = [
        path
        for path in (ROOT / "backend" / "src").rglob("*.ts")
        if not skipped(path)
    ]
    tests = [path for path in sources if path.name.endswith(".test.ts")]
    section.checked += len(sources)
    if not sources:
        section.err("backend/src has no TypeScript files")
    if not tests:
        section.err("backend/src has no *.test.ts files")


def check_dart(section: Section) -> None:
    require_contains(
        section,
        ROOT / "frontend" / "pubspec.yaml",
        ("name:", "sdk:", "flutter:"),
    )
    require_contains(
        section,
        ROOT / "frontend" / "analysis_options.yaml",
        ("flutter_lints",),
    )
    lib_files = [
        path
        for path in (ROOT / "frontend" / "lib").rglob("*.dart")
        if not skipped(path)
    ]
    test_files = [
        path
        for path in (ROOT / "frontend" / "test").rglob("*_test.dart")
        if not skipped(path)
    ]
    section.checked += len(lib_files) + len(test_files)
    if not lib_files:
        section.err("frontend/lib has no Dart files")
    if not test_files:
        section.err("frontend/test has no *_test.dart files")
    arb_dir = ROOT / "frontend" / "lib" / "l10n"
    arb_files = sorted(arb_dir.glob("*.arb")) if arb_dir.is_dir() else []
    if not arb_files:
        section.err("frontend/lib/l10n has no ARB localization files")
    for path in arb_files:
        text = read_text(section, path)
        if text is None:
            continue
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            section.err(f"invalid ARB JSON in {rel(path)}: {exc}")
            continue
        if not isinstance(data, dict) or "@@locale" not in data:
            section.err(f"{rel(path)} is missing @@locale")


def check_kotlin(section: Section) -> None:
    base = ROOT / "frontend" / "android"
    found = check_jvm_package(section, base, ".kt", "kotlin")
    if found == 0:
        section.err("Android project has no Kotlin sources")
    require_contains(
        section,
        base / "app" / "src" / "main" / "kotlin" / "com" / "example" / "frontend" / "MainActivity.kt",
        ("FlutterActivity",),
    )


def check_java(section: Section) -> None:
    base = ROOT / "frontend" / "android"
    found = check_jvm_package(section, base, ".java", "java")
    if found == 0:
        section.err("Android project has no Java sources")


def check_swift(section: Section) -> None:
    roots = {
        "iOS": ROOT / "frontend" / "ios",
        "macOS": ROOT / "frontend" / "macos",
    }
    markers = ("import ", "class ", "struct ", "enum ", "func ", "@main", "@objc")
    for label, base in roots.items():
        files = [path for path in base.rglob("*.swift") if not skipped(path)]
        if not files:
            section.err(f"{label} project has no Swift sources")
        for path in files:
            text = read_text(section, path)
            if text is None:
                continue
            if not any(marker in text for marker in markers):
                section.err(f"{rel(path)} does not look like Swift source")
            if path.name.endswith("Tests.swift") and "XCTest" not in text:
                section.err(f"{rel(path)} is missing XCTest")
    require_contains(
        section,
        ROOT / "frontend" / "ios" / "Runner" / "AppDelegate.swift",
        ("import Flutter", "class AppDelegate"),
    )
    require_contains(
        section,
        ROOT / "frontend" / "macos" / "Runner" / "AppDelegate.swift",
        ("import FlutterMacOS", "class AppDelegate"),
    )
    require_contains(
        section,
        ROOT / "frontend" / "macos" / "Runner" / "MainFlutterWindow.swift",
        ("class MainFlutterWindow",),
    )


def check_objective_c(section: Section) -> None:
    base = ROOT / "frontend" / "ios"
    sources = [path for path in base.rglob("*.m") if not skipped(path)]
    headers = [path for path in base.rglob("*.h") if not skipped(path)]
    if not sources:
        section.err("iOS project has no Objective-C sources")
    for path in sources:
        require_contains(section, path, ("#import",))
    for path in headers:
        text = read_text(section, path)
        if text is not None and "#" not in text and "@" not in text:
            section.err(f"{rel(path)} does not look like an Objective-C header")
    require_contains(
        section,
        base / "Runner" / "Runner-Bridging-Header.h",
        ("#import",),
    )


def check_cpp(section: Section) -> None:
    groups = {
        "Linux": ROOT / "frontend" / "linux",
        "Windows": ROOT / "frontend" / "windows",
    }
    for label, base in groups.items():
        files = [
            path
            for path in base.rglob("*")
            if path.suffix in {".cc", ".cpp", ".h", ".hpp", ".c"} and not skipped(path)
        ]
        if not files:
            section.err(f"{label} project has no C/C++ sources")
        for path in files:
            text = read_text(section, path)
            if text is not None and "#" not in text and "int " not in text:
                section.err(f"{rel(path)} does not look like C/C++ source")
    require_contains(section, ROOT / "frontend" / "linux" / "runner" / "main.cc", ("int main",))
    require_contains(
        section,
        ROOT / "frontend" / "windows" / "runner" / "main.cpp",
        ("wWinMain",),
    )
    require_contains(
        section,
        ROOT / "frontend" / "windows" / "runner" / "Runner.rc",
        ("#include",),
    )


def check_cmake(section: Section) -> None:
    require_contains(
        section,
        ROOT / "frontend" / "linux" / "CMakeLists.txt",
        ("cmake_minimum_required", "project("),
    )
    require_contains(
        section,
        ROOT / "frontend" / "windows" / "CMakeLists.txt",
        ("cmake_minimum_required", "project("),
    )
    require_contains(
        section,
        ROOT / "frontend" / "linux" / "runner" / "CMakeLists.txt",
        ("add_executable",),
    )
    require_contains(
        section,
        ROOT / "frontend" / "windows" / "runner" / "CMakeLists.txt",
        ("add_executable",),
    )


def check_gradle(section: Section) -> None:
    android = ROOT / "frontend" / "android"
    require_contains(
        section,
        android / "settings.gradle.kts",
        ("org.jetbrains.kotlin.android", "com.android.application"),
    )
    require_contains(
        section,
        android / "app" / "build.gradle.kts",
        ("com.android.application", "applicationId"),
    )
    require_contains(section, android / "build.gradle.kts", ("repositories",))
    properties = require_contains(
        section,
        android / "gradle" / "wrapper" / "gradle-wrapper.properties",
        ("distributionUrl=",),
    )
    if properties is not None and not re.search(r"gradle-[0-9.]+-(all|bin)\.zip", properties):
        section.err("gradle-wrapper.properties is missing a Gradle distributionUrl")
    require_contains(section, android / "gradle.properties", ("android.useAndroidX=true",))
    require_contains(section, android / "gradlew", ("#!/usr/bin/env bash", "gradle-wrapper.jar"))
    require_contains(section, android / "gradlew.bat", ("gradle-wrapper.jar",))
    jar = android / "gradle" / "wrapper" / "gradle-wrapper.jar"
    section.checked += 1
    if not jar.is_file():
        section.err("missing Android Gradle wrapper jar")
        return
    try:
        with zipfile.ZipFile(jar) as archive:
            names = archive.namelist()
    except zipfile.BadZipFile:
        section.err("gradle-wrapper.jar is not a valid zip archive")
        return
    if not any(name.endswith("GradleWrapperMain.class") for name in names):
        section.err("gradle-wrapper.jar does not contain GradleWrapperMain")


def check_xml(section: Section) -> None:
    xml_files: list[Path] = []
    android = ROOT / "frontend" / "android"
    if android.is_dir():
        xml_files.extend(path for path in android.rglob("*.xml") if not skipped(path))
    for platform in ("ios", "macos"):
        base = ROOT / "frontend" / platform
        xml_files.extend(path for path in base.rglob("*.plist") if not skipped(path))
    manifest = ROOT / "frontend" / "windows" / "runner" / "runner.exe.manifest"
    xml_files.append(manifest)
    if not xml_files:
        section.err("no XML or plist files found")
    for path in xml_files:
        parse_xml(section, path)
    require_contains(
        section,
        android / "app" / "src" / "main" / "AndroidManifest.xml",
        ("<manifest",),
    )
    for platform in ("ios", "macos"):
        require_contains(
            section,
            ROOT / "frontend" / platform / "Runner" / "Info.plist",
            ("CFBundleIdentifier",),
        )


def check_json(section: Section) -> None:
    files = [
        ROOT / "backend" / "package.json",
        ROOT / "backend" / "package-lock.json",
        ROOT / "backend" / "tsconfig.json",
        ROOT / "frontend" / "web" / "manifest.json",
    ]
    for base in (ROOT / "frontend" / "ios", ROOT / "frontend" / "macos"):
        files.extend(path for path in base.rglob("Contents.json") if not skipped(path))
    for path in files:
        text = read_text(section, path)
        if text is None:
            continue
        try:
            json.loads(text)
        except json.JSONDecodeError as exc:
            section.err(f"invalid JSON in {rel(path)}: {exc}")
    manifest_text = read_text(section, ROOT / "frontend" / "web" / "manifest.json")
    if manifest_text is not None:
        try:
            manifest = json.loads(manifest_text)
        except json.JSONDecodeError:
            manifest = None
        if isinstance(manifest, dict) and not manifest.get("name"):
            section.err("frontend/web/manifest.json is missing name")


def check_html(section: Section) -> None:
    web = ROOT / "frontend" / "web"
    pages = [path for path in web.glob("*.html") if path.is_file()] if web.is_dir() else []
    if not pages:
        section.err("frontend/web has no HTML entrypoint")
    for path in pages:
        require_contains(section, path, ("<html", "</html>"))


def check_docker(section: Section) -> None:
    text = require_contains(
        section,
        ROOT / "backend" / "Dockerfile",
        ("FROM ", "USER ", "HEALTHCHECK", "CMD "),
    )
    if text is None:
        return
    if re.search(r"(?m)^USER\s+root\b", text):
        section.err("backend/Dockerfile must not run as root")
    if "USER node" not in text:
        section.err("backend/Dockerfile must drop privileges with USER node")
    if re.search(r"(?m)^FROM\s+\S+:latest\b", text):
        section.err("backend/Dockerfile uses an unpinned :latest base image")


def main() -> int:
    checks = [
        ("Source hygiene", check_source_hygiene),
        ("TypeScript", check_typescript),
        ("Dart", check_dart),
        ("Kotlin", check_kotlin),
        ("Java", check_java),
        ("Swift", check_swift),
        ("Objective-C", check_objective_c),
        ("C/C++", check_cpp),
        ("CMake", check_cmake),
        ("Gradle", check_gradle),
        ("XML and plist", check_xml),
        ("JSON", check_json),
        ("HTML", check_html),
        ("Dockerfile", check_docker),
    ]
    failed = 0
    print("==> Language static checks")
    for name, func in checks:
        section = Section(name)
        print(f"\n==> {name}")
        func(section)
        section.finish()
        if section.errors:
            failed += 1
    if failed:
        print(f"::error::Language checks failed in {failed} section(s)")
        return 1
    print("\nLanguage static checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
