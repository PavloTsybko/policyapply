# PolicyApply roadmap

This roadmap describes outcomes, not date promises.

## M0 — Public foundation

- complete ownership, license, secret-history, and dependency review;
- establish repository rules, security reporting, governance, and CI (CI added
  with the first admitted source slice);
- approve the initial source-admission manifest (initial `contracts` and
  `authorization` slice approved and implemented on a review branch);
- add Apache-2.0 only after legal/ownership review.

## M1 — Control-plane kernel

- tenant/project principals and exact-scope authorization (first slice
  implemented with negative cross-tenant tests);
- immutable plans and separate approval (implemented on a stacked review branch
  with revision/digest binding and self-approval denial);
- idempotent apply and append-only audit;
- minimal PostgreSQL schema with forced RLS;
- Fastify/OpenAPI reference API;
- disposable Docker quickstart with synthetic data.

## M2 — Integration SDK

- versioned manifests and adapter registry;
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
