# `@policyapply/application`

Application orchestration ports and a reference idempotent apply service.

`PolicyApplyControlPlane` centralizes project authorization, plan creation/read,
independent decisions, idempotent apply, and bounded audit reads so transport
adapters do not duplicate policy.

The included in-memory repository and fake executors are for contract tests and
local examples only. They provide no crash durability, cross-process locking,
or production exactly-once guarantee.

Real adapters must reuse the stable operation ID, support provider-side
idempotency or reconciliation, and persist completed state plus its audit
receipt atomically. An uncertain outcome must be verified before retry.
