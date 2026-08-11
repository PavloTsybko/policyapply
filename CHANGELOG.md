# Changelog

All notable PolicyApply changes will be documented here.

The project intends to follow Keep a Changelog and Semantic Versioning after the public API is established.

## [Unreleased]

### Added

- Public pre-release repository and safety documentation.
- First independently authored M1 slice: provider-neutral principal contracts
  and deny-by-default tenant/project authorization.
- Strict TypeScript checks, Vitest coverage, and a minimal GitHub Actions CI
  workflow.
- Immutable draft plans with canonical SHA-256 content digests and independent
  approval/rejection bound to exact revision and digest.
- Fail-closed canonical JSON validation for cycles, accessors, custom
  prototypes, symbol keys, sparse arrays, and unsafe numeric values.
- Provider-neutral idempotent apply orchestration with stable operation IDs,
  fingerprint conflict detection, completed replay, retry-safe failure, and
  uncertain-result handling.
- Payload-free append-only audit receipts plus a deliberately non-production
  in-memory repository and synthetic executor contract tests.
- Minimal PostgreSQL reference persistence for approved plans, idempotent apply
  attempts, atomic completion receipts, and append-only audit records.
- Forced Row-Level Security and negative cross-tenant integration coverage in a
  database whose name must end in `_test`.
- Migration and destructive-rollback guidance without production automation.
- OpenAPI 3.1 contract plus a thin Fastify reference API for plan creation/read,
  independent decisions, idempotent apply, and payload-free audit reads.
- Shared application control-plane orchestration with exact project scopes,
  injected authentication, bounded request validation, and secret-safe errors.
- Disposable local Docker Compose quickstart with generated file-backed
  credentials, PostgreSQL forced RLS, separate synthetic principals, a fake
  executor, health checks, cleanup, and lifecycle smoke verification.
- Durable draft/decision plan persistence and persisted idempotency lookup for
  safe replay after process restart.
- Draft M0 source-admission evidence covering the stacked M1 scope, reachable
  secret-history scan, dependency-license inventory, maintainer attestations,
  and sequential merge/rollback gates.
- Apache-2.0 repository licensing following explicit maintainer ownership and
  source-admission approval.

### Changed

### Fixed

### Security
