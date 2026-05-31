#!/usr/bin/env python3
"""Static security scan for MyFinances repository.

This is a lightweight, dependency-free scan that checks for common client-side
security risks and summarizes findings.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from datetime import datetime, UTC

ROOT = Path(__file__).resolve().parents[1]

SEVERITY_ORDER = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}


class Finding:
    def __init__(self, severity: str, check: str, file_path: str, detail: str) -> None:
        self.severity = severity
        self.check = check
        self.file_path = file_path
        self.detail = detail

    def as_dict(self) -> dict:
        return {
            "severity": self.severity,
            "check": self.check,
            "file": self.file_path,
            "detail": self.detail,
        }


def add_finding(findings: list[Finding], severity: str, check: str, file_path: Path, detail: str) -> None:
    findings.append(Finding(severity, check, str(file_path.relative_to(ROOT)), detail))


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def scan_csp(findings: list[Finding]) -> None:
    index_path = ROOT / "index.html"
    content = read_text(index_path)

    meta_match = re.search(r"<meta\s+http-equiv=\"Content-Security-Policy\"\s+content=\"([^\"]+)\"", content)
    if not meta_match:
        add_finding(findings, "HIGH", "csp", index_path, "Missing CSP meta tag")
        return

    csp = meta_match.group(1)
    required_parts = [
        "default-src 'self'",
        "script-src 'self' https://cdn.jsdelivr.net",
        "style-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
    ]
    for part in required_parts:
        if part not in csp:
            add_finding(findings, "MEDIUM", "csp", index_path, f"CSP missing directive: {part}")


def scan_inline_handlers(findings: list[Finding]) -> None:
    html_files = list(ROOT.glob("*.html"))
    handler_pattern = re.compile(r"\son[a-z]+\s*=\s*\"", re.IGNORECASE)

    for path in html_files:
        content = read_text(path)
        if handler_pattern.search(content):
            add_finding(findings, "MEDIUM", "inline-handler", path, "Inline HTML event handler found")


def scan_js_sinks(findings: list[Finding]) -> None:
    js_files = list((ROOT / "src").glob("*.js"))
    for path in js_files:
        content = read_text(path)

        eval_hits = len(re.findall(r"\beval\s*\(", content))
        if eval_hits:
            add_finding(findings, "HIGH", "eval-usage", path, f"Found {eval_hits} eval() usage(s)")

        fn_hits = len(re.findall(r"\bnew\s+Function\s*\(", content))
        if fn_hits:
            add_finding(findings, "HIGH", "function-constructor", path, f"Found {fn_hits} new Function() usage(s)")

        inner_html_hits = len(re.findall(r"\.innerHTML\s*=", content))
        if inner_html_hits > 0:
            # Informational risk marker. This app uses controlled template rendering.
            add_finding(
                findings,
                "LOW",
                "innerhtml-review",
                path,
                f"Found {inner_html_hits} innerHTML assignment(s); ensure values are escaped/sanitized",
            )


def scan_http_urls(findings: list[Finding]) -> None:
    for path in list(ROOT.glob("*.html")) + list((ROOT / "src").glob("*.js")) + list((ROOT / "tests").glob("*.py")):
        if path.name == "security_scan.py":
            continue
        content = read_text(path)
        for match in re.finditer(r"http://[^\s'\"]+", content):
            url = match.group(0)
            # localhost is acceptable for test tooling.
            if "localhost" in url or "127.0.0.1" in url:
                continue
            # XML namespaces are identifiers, not network requests.
            if url.startswith("http://www.w3.org/"):
                continue
            add_finding(findings, "MEDIUM", "insecure-http-url", path, f"Non-localhost http URL found: {url}")


def scan_localstorage_usage(findings: list[Finding]) -> None:
    js_files = list((ROOT / "src").glob("*.js"))
    key_pattern = re.compile(r"localStorage\.(?:getItem|setItem)\(([^)]+)\)")

    for path in js_files:
        content = read_text(path)
        for match in key_pattern.finditer(content):
            raw = match.group(1)
            if "debtTrackerData" in raw or "debtTrackerTheme" in raw:
                continue
            add_finding(findings, "LOW", "localstorage-key-review", path, f"Review localStorage key expression: {raw}")


def print_report(findings: list[Finding]) -> None:
    findings_sorted = sorted(findings, key=lambda f: SEVERITY_ORDER[f.severity], reverse=True)

    print("=" * 72)
    print("MYFINANCES STATIC SECURITY SCAN REPORT")
    print("=" * 72)
    print(f"Scanned at: {datetime.now(UTC).isoformat()}")
    print(f"Project root: {ROOT}")
    print()

    counts = {"HIGH": 0, "MEDIUM": 0, "LOW": 0}
    for f in findings_sorted:
        counts[f.severity] += 1

    print("Summary:")
    print(f"  HIGH:   {counts['HIGH']}")
    print(f"  MEDIUM: {counts['MEDIUM']}")
    print(f"  LOW:    {counts['LOW']}")
    print()

    if findings_sorted:
        print("Findings:")
        for idx, f in enumerate(findings_sorted, start=1):
            print(f"{idx:02d}. [{f.severity}] {f.check} | {f.file_path}")
            print(f"    {f.detail}")
    else:
        print("No findings. Scan checks passed.")

    report = {
        "scannedAt": datetime.now(UTC).isoformat(),
        "root": str(ROOT),
        "summary": counts,
        "findings": [f.as_dict() for f in findings_sorted],
    }

    out_path = ROOT / "SECURITY_SCAN_REPORT.json"
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print()
    print(f"JSON report written: {out_path}")


def main() -> None:
    findings: list[Finding] = []

    scan_csp(findings)
    scan_inline_handlers(findings)
    scan_js_sinks(findings)
    scan_http_urls(findings)
    scan_localstorage_usage(findings)

    print_report(findings)


if __name__ == "__main__":
    main()
