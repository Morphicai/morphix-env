# Spec Delta

## Purpose

Minimize accidental propagation of runtime-injected secret values into terminal output, Agent context, generated instructions, and local audit records while clearly preserving the limits of environment-variable delivery.

## ADDED Requirements

### Requirement: Value-free diagnostic and audit surfaces
The system SHALL make ordinary inspection, status, configuration errors, and audit records value-free. They MAY identify key names, source names, profile names, configured state, and command outcome, but SHALL NOT contain a resolved value or a partial value prefix.

The system SHALL not persist resolved secret values in its profile configuration, provenance index, generated Skill instructions, or audit storage.

#### Scenario: User inspects a profile
- **WHEN** a user runs `mx-env inspect --profile api-dev`
- **THEN** the output reports key status and provenance without printing any full or partial secret value

#### Scenario: A source fails while loading
- **WHEN** a provider rejects a source request
- **THEN** the error identifies the provider and remediation category without including a credential, resolved value, or raw provider response containing one

### Requirement: Captured child output is redacted before forwarding
For commands whose stdout or stderr is captured or forwarded by `morphix-env`, the system SHALL redact exact resolved values from that output before forwarding it to a terminal capture, Agent tool result, or audit record. Redaction SHALL preserve command exit status and ordinary non-secret diagnostic output.

The system SHALL document that this is leakage minimization only: a child process that has a value in its environment can still intentionally transform or exfiltrate that value, and that possibility is outside the guarantee of output redaction.

#### Scenario: Child prints an injected value
- **WHEN** a child command writes a resolved injected value to stdout or stderr
- **THEN** forwarded output replaces the value with a redaction marker and the value is absent from the captured result

#### Scenario: Child exits with a non-zero status after redaction
- **WHEN** a child command prints a resolved value and exits non-zero
- **THEN** the caller receives the non-zero outcome and redacted diagnostics without the resolved value

### Requirement: Public browser values remain an explicit exception
The system SHALL continue to generate configured public client environment variables for supported public prefixes. Such generated values SHALL be treated as intentionally public configuration and SHALL not be represented as protected secrets by inspection, auditing, or Skill guidance.

#### Scenario: Public runtime configuration is generated
- **WHEN** a profile resolves a configured `NEXT_PUBLIC_` value and runs client-env generation
- **THEN** the generated browser file contains that public value while secret-hygiene diagnostics continue to omit non-public resolved values

### Requirement: Interactive editing does not create Agent-facing value output
The system SHALL keep values entered or viewed during an interactive editor session out of its CLI response, generated Skill text, and audit record. It SHALL instruct Agents to ask the user to operate the editor rather than paste a secret into chat.

#### Scenario: User saves a value through the visual editor
- **WHEN** a user completes an approved local source edit
- **THEN** the CLI reports a value-free success result and the resulting Skill/audit surfaces do not contain the entered value
