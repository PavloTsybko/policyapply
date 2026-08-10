# Contributing to PolicyApply

PolicyApply is currently preparing its first public implementation.

## Before contributing

- Search existing issues and the roadmap.
- Open a design issue before large, security-sensitive, or public-API changes.
- Report vulnerabilities privately through `SECURITY.md`.
- Never submit credentials, customer data, private URLs, production logs, or proprietary code.
- Submit only material you have the right to license.

## Engineering rules

- Keep domain code independent from HTTP, PostgreSQL, MCP, model, and provider SDKs.
- Add allow, deny, missing-context, and cross-tenant tests for authorization changes.
- Update OpenAPI and the generated SDK for public operations.
- Add contract, timeout, abort, invalid-response, redaction, and failure-path tests for adapters.
- Add migration and rollback notes for persisted state.
- Keep examples synthetic and offline by default.

## Development setup

No source setup is documented as working yet. This section will be replaced when clean-clone CI verifies the exact commands.

## Pull requests

Use a focused branch and explain the problem, solution, security/compatibility impact, verification, migration, and rollback. Required checks and review must pass before squash merge.

Contributions will be licensed under the repository license after the license and contribution attestation are finalized.
