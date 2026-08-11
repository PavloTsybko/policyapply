# ADR-0001: closed manifests and exact-version adapter selection

Status: accepted for M2 review

Date: 2026-08-11

## Context

PolicyApply needs provider-neutral adapter discovery without creating a second
execution path around the shared application control plane. Silent version
fallback, manifest-supplied configuration values, or registry-driven execution
would make plan digests harder to bind, increase secret exposure risk, and
permit clients to bypass authorization, approval, idempotency, or audit rules.

## Decision

- Integration manifests use the explicit
  `policyapply.dev/integration-manifest/v1` API version.
- The v1 schema is closed. Unknown top-level and operation fields are rejected.
- Manifests contain identity, version, operation kind, required scopes, and
  safety declarations only. They cannot contain endpoints, credentials,
  configuration, secret values, or execution payloads.
- Mutation operations must declare approval and idempotency as required.
- Registry identity is the exact pair `(integrationId, adapterVersion)`.
  Duplicate registrations and unregistered versions fail closed; there is no
  implicit latest/compatible fallback.
- The registry selects metadata-bound adapters but cannot execute them.
  Authentication, tenant/project authorization, planning, approval, apply,
  retry, secret resolution, and audit remain application-control-plane duties.
- Parsed manifests are copied and frozen so caller mutation cannot change the
  registered contract.

## Consequences

- Version drift becomes visible instead of silently selecting another adapter.
- Adding a manifest field requires a new reviewed schema version or an explicit
  compatible schema decision.
- Adapter execution needs later M2 contracts for secret references,
  cancellation, outcomes, and conformance tests.
- This slice contains no tenant data. Any future registry persistence or
  tenant-specific enablement must introduce tenant isolation explicitly and
  test negative cross-tenant paths.

## Rollback

Before publication, rollback is removal of the private package and this ADR.
After a manifest version is published, its meaning must not be changed in
place; correction requires a new API version.
