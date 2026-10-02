# Spec Delta

## Purpose

Provide a user-owned visual editing route for composed secret profiles and local sources while keeping value display and provider-native secret mutation outside Agent-facing command output and repository configuration.

## ADDED Requirements

### Requirement: One-shot visual editor entry point
The system SHALL provide `edit --profile <name>` and `edit --source <name>` commands through both supported CLI names. An edit command SHALL create a one-shot local editing session and direct the interactive user to it; it SHALL not require a long-running management service.

The command result SHALL contain session status and access guidance only, and SHALL NOT print resolved secret values or value prefixes.

#### Scenario: User opens a profile editor
- **WHEN** a user runs `mx-env edit --profile api-dev` from a configured project
- **THEN** the system opens or directs the user to a one-shot local editor for `api-dev` and prints no secret value

#### Scenario: Unknown profile is requested for editing
- **WHEN** a user runs `edit --profile` with a profile that is not declared or available through legacy compatibility
- **THEN** the system declines to open an editor and identifies the missing profile without printing provider values

### Requirement: Merged profile status view
The profile editor SHALL show each discovered key's name, winning source, source precedence, configured status, and unresolved collision state. It SHALL distinguish a missing source from a configured-but-unavailable source. It SHALL NOT display resolved secret values or partial value prefixes in the merged status view.

#### Scenario: Editor displays an overridden key
- **WHEN** a later source explicitly overrides a key supplied by an earlier source
- **THEN** the profile editor shows the winner and the overridden source without showing either value

#### Scenario: Editor displays an unresolved collision
- **WHEN** two selected sources contain a duplicate key without explicit override authority
- **THEN** the profile editor marks the conflict and prevents the profile from being presented as runnable

### Requirement: Provider-aware editing routes
The editor SHALL route edits according to the selected source. For provider-managed sources, it SHALL direct the user to the provider-native edit experience or provider-authorized flow. For approved local dotenv, dotenvx, and macOS Keychain sources, it SHALL allow an interactive user to edit that source and SHALL write only to the selected source.

The system SHALL not offer a generic cross-provider write operation that silently copies or synchronizes a value between providers.

#### Scenario: User edits a Doppler-backed source
- **WHEN** the user selects a Doppler-backed source in the editor
- **THEN** the editor directs the user to the corresponding Doppler project/config editing flow and does not copy the source's values into another provider

#### Scenario: User edits a local Keychain source
- **WHEN** the user selects an available macOS Keychain source and completes an intentional local edit
- **THEN** the change is written to that Keychain namespace only and command output reports completion without the value

### Requirement: Safe Agent workflow instructions
The system SHALL provide generated or maintained project Skill instructions that direct an Agent to open `edit` for an operator when a secret must be changed. Those instructions SHALL prohibit requesting a value through chat and SHALL NOT contain secret values or partial value prefixes.

#### Scenario: Generated instructions guide a secret update
- **WHEN** project secret workflow instructions are generated for a profile with multiple sources
- **THEN** they tell the Agent to invoke the profile editor and let the user complete the visual edit without embedding resolved values
