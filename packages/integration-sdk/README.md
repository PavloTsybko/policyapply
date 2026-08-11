# `@policyapply/integration-sdk`

Private, pre-release contracts for versioned integration manifests and exact
adapter selection.

The registry is metadata and selection infrastructure only. It does not
authenticate principals, authorize projects, approve plans, execute adapters,
resolve secrets, retry operations, or write audit records. Adapter execution
must remain behind the shared PolicyApply application control plane.

The v1 manifest schema is intentionally closed: unknown fields are rejected,
secret/configuration values have no representation, and mutation operations
must declare approval and idempotency as required. Registry lookup is exact by
integration ID and adapter version; there is no latest-version fallback.

No package is published and no real provider adapter is included.
