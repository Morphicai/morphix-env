# Security Policy

`mxenv` composes secrets into short-lived processes; reports about secret leakage, unauthorized value disclosure, or bypass of the value-safety guarantees are handled with priority.

## Supported Versions

| Version | Supported |
|---|---|
| 0.12.x | ✅ |
| 0.11.x | ✅ (security fixes during the 0.12.x migration window) |
| < 0.11 | ❌ |

## Reporting a Vulnerability

Report privately via **GitHub Security Advisories → Private Vulnerability Reporting** on this repository ("Report a vulnerability"). Do not open a public issue for anything that involves secret exposure, redaction bypass, audit leaks, or local API/token handling.

Include: affected version, reproduction steps (value-free — never attach real secrets), and impact. You will get an acknowledgement within 72 hours and a status update within 7 days. Fixes land in a patch release; disclosure is coordinated with the reporter.

## Scope notes

- The tool's value-safety model is **leakage minimization, not a cryptographic boundary** — see "Value safety" in the README. Reports that only restate this documented boundary (e.g. same-uid process reads a child's environment) are expected behavior, not vulnerabilities.
- Issues in upstream providers (Infisical, Doppler, dotenvx, macOS Keychain) belong to those projects.
