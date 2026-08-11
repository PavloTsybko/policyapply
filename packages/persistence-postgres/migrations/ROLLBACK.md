# Migration and rollback notes

`0001_core.sql` creates a new, isolated `policyapply` schema. Before any
application traffic or retained data exists, rollback consists of dropping the
schema with `DROP SCHEMA policyapply CASCADE` using the migration owner.

That command is intentionally not automated because it is destructive. Once
data exists, do not use it: stop writers, preserve a verified backup, diagnose
the migration, and roll forward with a reviewed corrective migration.

The migration does not create login roles, databases, credentials, extensions,
or production infrastructure. Operators must provision a non-owner runtime
role without `SUPERUSER` or `BYPASSRLS`, grant only the required schema/table
privileges, and test forced RLS under that exact role before deployment.
