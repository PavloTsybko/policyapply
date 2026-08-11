\getenv runtime_password POLICYAPPLY_RUNTIME_DB_PASSWORD

CREATE ROLE policyapply_runtime
  LOGIN
  PASSWORD :'runtime_password'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOBYPASSRLS;

REVOKE ALL ON SCHEMA policyapply FROM PUBLIC;
GRANT USAGE ON SCHEMA policyapply TO policyapply_runtime;
GRANT EXECUTE ON FUNCTION policyapply.current_tenant_id() TO policyapply_runtime;
GRANT SELECT ON policyapply.tenants, policyapply.projects TO policyapply_runtime;
GRANT SELECT, INSERT, UPDATE ON policyapply.change_plans,
  policyapply.apply_attempts TO policyapply_runtime;
GRANT SELECT, INSERT ON policyapply.audit_receipts TO policyapply_runtime;

INSERT INTO policyapply.tenants (id) VALUES ('tenant_quickstart');
INSERT INTO policyapply.projects (tenant_id, id)
VALUES ('tenant_quickstart', 'project_quickstart');
