#!/usr/bin/env python3
"""
Static Security Analysis
Runs static security checks on the codebase.
"""

import pytest
import os
import json
import subprocess

# Get project root
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.mark.security
def test_no_unsafe_inline_in_html():
    """Verify no 'unsafe-inline' in HTML inline scripts."""
    index_path = os.path.join(PROJECT_ROOT, 'index.html')
    
    with open(index_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Check for dangerous patterns
    dangerous_patterns = [
        'style="',  # Inline styles
        'onclick=',  # Inline event handlers
        'onerror=',
        'onload=',
        'onchange=',
    ]
    
    issues = []
    for pattern in dangerous_patterns:
        if pattern in content:
            issues.append(f"Found inline pattern: {pattern}")
    
    assert len(issues) == 0, f"HTML security issues found: {issues}"


@pytest.mark.security
def test_csp_in_html():
    """Verify CSP meta tag is present in HTML."""
    index_path = os.path.join(PROJECT_ROOT, 'index.html')
    
    with open(index_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    assert 'Content-Security-Policy' in content, "CSP meta tag not found in HTML"
    assert "script-src 'self'" in content, "CSP missing strict script-src"
    assert "unsafe-inline" not in content, "CSP contains unsafe-inline directive"


@pytest.mark.security
def test_security_headers_in_html():
    """Verify security headers are in HTML."""
    index_path = os.path.join(PROJECT_ROOT, 'index.html')
    
    with open(index_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    required_headers = [
        'X-Content-Type-Options',
        'X-Frame-Options',
    ]
    
    for header in required_headers:
        assert header in content, f"Security header {header} not found in HTML"


@pytest.mark.security
def test_no_hardcoded_secrets():
    """Verify no hardcoded API keys or secrets in source files."""
    src_dir = os.path.join(PROJECT_ROOT, 'src')
    
    suspicious_patterns = [
        'api_key',
        'api-key',
        'apikey',
        'secret_key',
        'secret-key',
        'password',
        'token',
    ]
    
    issues = []

    for filename in os.listdir(src_dir):
        if not filename.endswith('.js'):
            continue
        filepath = os.path.join(src_dir, filename)
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        for i, line in enumerate(lines):
            stripped = line.strip()
            # Skip full-line comments
            if stripped.startswith('//') or stripped.startswith('*'):
                continue
            lower = stripped.lower()
            for pattern in suspicious_patterns:
                # Only flag when the pattern appears as a string literal value
                if f'"{pattern}"' in lower or f"'{pattern}'" in lower:
                    # Skip known-safe usages: sanitize helpers, localStorage key names
                    if any(safe in lower for safe in ['sanitize', 'localstorage', 'storagekey']):
                        continue
                    issues.append(f"{filename}:{i+1}: {stripped}")

    assert len(issues) == 0, f"Potential hardcoded secrets found: {issues}"


@pytest.mark.security
def test_local_storage_usage():
    """Verify localStorage is used safely (client-side only)."""
    src_dir = os.path.join(PROJECT_ROOT, 'src')
    
    for filename in os.listdir(src_dir):
        if filename.endswith('.js'):
            filepath = os.path.join(src_dir, filename)
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Check that localStorage is used, but no sensitive data is exposed in logs
            if 'localStorage' in content:
                assert 'console.log(localStorage' not in content, \
                    f"localStorage data logged in {filename}"
                assert 'console.log(app.data' not in content, \
                    f"Application data logged in {filename}"


@pytest.mark.security
def test_fetch_requests_use_https():
    """Verify all fetch requests would use HTTPS in production."""
    src_dir = os.path.join(PROJECT_ROOT, 'src')
    
    issues = []
    
    for filename in os.listdir(src_dir):
        if filename.endswith('.js'):
            filepath = os.path.join(src_dir, filename)
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Check for hardcoded HTTP URLs (non-localhost)
            if 'fetch(' in content or 'http://' in content:
                lines = content.split('\n')
                for i, line in enumerate(lines):
                    if 'http://' in line and 'localhost' not in line and 'fetch' in content:
                        issues.append(f"{filename}:{i+1} - hardcoded HTTP URL")
    
    assert len(issues) == 0, f"Insecure HTTP URLs found: {issues}"


@pytest.mark.security
def test_dependency_check():
    """Verify no obviously vulnerable dependency patterns."""
    # This is a simple check - in production use snyk or similar
    
    # Check package files if they exist
    package_files = ['package.json', 'requirements.txt', 'Pipfile']
    
    for pkg_file in package_files:
        path = os.path.join(PROJECT_ROOT, pkg_file)
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Check for known vulnerable versions
            # This is a very basic check
            assert 'express' not in content or '4.' in content, \
                "Express version may be vulnerable"


@pytest.mark.security
def test_form_submission_security():
    """Verify forms use proper security attributes."""
    index_path = os.path.join(PROJECT_ROOT, 'index.html')
    
    with open(index_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Check for forms
    if '<form' in content:
        # CSP should prevent dangerous form actions
        assert 'Content-Security-Policy' in content, "Forms present but no CSP found"


@pytest.mark.security
def test_no_debug_statements():
    """Verify no debug statements remain in production source code."""
    src_dir = os.path.join(PROJECT_ROOT, 'src')

    debugger_hits = []
    console_log_hits = []

    for filename in os.listdir(src_dir):
        if not filename.endswith('.js'):
            continue
        filepath = os.path.join(src_dir, filename)
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped.startswith('//'):
                continue
            if 'debugger;' in line:
                debugger_hits.append(f"{filename}:{i+1}: {stripped}")
            elif 'console.log(' in line:
                console_log_hits.append(f"{filename}:{i+1}: {stripped}")

    assert len(debugger_hits) == 0, \
        f"debugger statements found in production code: {debugger_hits}"
    assert len(console_log_hits) == 0, (
        f"console.log statements found in production source — "
        f"use console.warn/error for intentional messages: {console_log_hits}"
    )


def main():
    """Run all static security checks."""
    print("\n" + "="*60)
    print("STATIC SECURITY ANALYSIS")
    print("="*60 + "\n")
    
    pytest.main([__file__, '-v', '-m', 'security'])


if __name__ == '__main__':
    main()
