# `@policyapply/application`

Application orchestration ports and a reference idempotent apply service.

The included in-memory repository and fake executors are for contract tests and
local examples only. They provide no crash durability, cross-process locking,
or production exactly-once guarantee.

Real adapters must reuse the stable operation ID, support provider-side
idempotency or reconciliation, and persist completed state plus its audit
receipt atomically. An uncertain outcome must be verified before retry.
