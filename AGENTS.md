# PolicyApply agent instructions

## Read first

Before changing behavior, read `README.md`, `ROADMAP.md`, `SECURITY.md`, and relevant ADRs.

## Non-negotiable rules

- Preserve one control plane: UI, API, SDK, CLI, model clients, and MCP share server-side domain rules.
- Never commit, print, or place credential values in plans, fixtures, logs, issues, or documentation.
- Enforce tenant isolation in every query and add negative cross-tenant tests.
- Make external mutations idempotent and auditable.
- Use plan -> explicit approval -> apply for high-impact or destructive changes.
- Add or update OpenAPI before exposing a public operation.
- Keep MCP adapters thin; they may not bypass API policy or call providers/databases directly.
- Add contract and failure-path tests for every integration adapter.
- Use synthetic data and `.example` domains in all public examples.
- Do not claim production readiness, adoption, benchmarks, or security review without evidence.
- Do not publish packages, images, releases, credentials, or deployments without maintainer approval.

## Delivery checks

Every change needs proportionate tests, documentation, migration and rollback notes, and a roadmap or ADR update when scope or an invariant changes.
