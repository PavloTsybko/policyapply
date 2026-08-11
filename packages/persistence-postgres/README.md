# `@policyapply/persistence-postgres`

Reference PostgreSQL persistence for the PolicyApply apply protocol.

This package is pre-release reference code, not a production database service.
It provides:

- tenant-bound transactions using `SET LOCAL policyapply.tenant_id`;
- forced Row-Level Security on every tenant-owned table;
- exact draft creation and draft-to-decision compare-and-swap transitions;
- SHA-256 digests instead of raw idempotency keys;
- atomic completion of an apply attempt, its plan state, and audit receipt;
- database-enforced append-only audit rows.

The application role must be a non-superuser, must not have `BYPASSRLS`, and
should not own the tables. Deployers remain responsible for role provisioning,
TLS, credentials, backups, monitoring, and migration execution.

## Migrations

Run `migrations/0001_core.sql` with a migration owner. The migration is
transactional and may be rolled back before application traffic is admitted.
After traffic exists, roll forward instead of dropping tables. See
`migrations/ROLLBACK.md`.

The repository constructor binds one trusted tenant ID. Client input never
changes that binding. Every query runs in a transaction that sets the tenant
context locally before touching an RLS-protected table.
