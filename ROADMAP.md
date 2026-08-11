# PolicyApply roadmap

This roadmap describes outcomes, not date promises.

## M0 — Public foundation

- complete ownership, license, secret-history, and dependency review
  (technical evidence and the maintainer's ownership, dependency, and
  Apache-2.0 decisions are recorded in `docs/M0_ADMISSION_AUDIT.md`;
  third-party notices remain a distribution gate);
- establish repository rules, security reporting, governance, and CI (CI added
  with the first admitted source slice);
- approve the initial source-admission manifest (initial `contracts` and
  `authorization` slice approved and merged);
- add Apache-2.0 only after legal/ownership review (completed and merged).

## M1 — Control-plane kernel

- tenant/project principals and exact-scope authorization (merged with negative
  cross-tenant tests);
- immutable plans and separate approval (merged with revision/digest binding
  and self-approval denial);
- idempotent apply and append-only audit (merged pure protocol, contract tests,
  and a non-production in-memory reference adapter);
- minimal PostgreSQL schema with forced RLS (reference repository, atomic
  apply/audit finalization, migration notes, and disposable integration tests
  merged; production role provisioning, operations, and deployment remain out
  of scope);
- Fastify/OpenAPI reference API (contract-first routes for plan creation/read,
  independent decisions, idempotent apply, and payload-free audit reads are
  merged; production composition and listener remain out of scope);
- disposable Docker quickstart with synthetic data (local-only Compose,
  generated file-backed credentials, non-superuser RLS runtime, fake executor,
  health checks, cleanup, and lifecycle smoke verification are merged; image
  publication and deployment remain out of scope).

## M2 — Integration SDK

- versioned manifests and adapter registry (closed v1 manifest validation and
  exact-version, no-fallback registry implemented on an M2 review branch;
  execution remains out of scope);
- secret-reference execution context;
- read and mutation conformance suites;
- fake adapters, including deliberately broken fixtures;
- timeout, abort, retry, version-drift, and redaction tests.

## M3 — Agent-facing clients

- generated TypeScript SDK;
- fixed-tenant read-only MCP server;
- optional OpenAI Responses API example;
- safety evals for tenancy, self-approval, duplicate apply, and secret injection.

## Deferred

- mutable MCP tools;
- remote MCP transport;
- hosted cloud service;
- web approval dashboard;
- provider marketplace;
- production secret-manager and live provider adapters.
