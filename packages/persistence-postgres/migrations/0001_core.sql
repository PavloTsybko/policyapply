BEGIN;

CREATE SCHEMA IF NOT EXISTS policyapply;

CREATE FUNCTION policyapply.current_tenant_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('policyapply.tenant_id', true), '')
$$;

CREATE TABLE policyapply.tenants (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT tenants_id_safe CHECK (id ~ '^[A-Za-z0-9._:-]{1,128}$')
);

CREATE TABLE policyapply.projects (
  tenant_id text NOT NULL REFERENCES policyapply.tenants(id),
  id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT projects_id_safe CHECK (id ~ '^[A-Za-z0-9._:-]{1,128}$')
);

CREATE TABLE policyapply.change_plans (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('draft', 'approved', 'rejected', 'applied')),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, id, revision, digest),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES policyapply.projects(tenant_id, id),
  CONSTRAINT change_plans_document_object CHECK (jsonb_typeof(document) = 'object'),
  CONSTRAINT change_plans_document_binding CHECK (
    document->>'tenantId' = tenant_id AND
    document->>'projectId' = project_id AND
    document->>'id' = id AND
    (document->>'revision')::integer = revision AND
    document->>'digest' = digest AND
    document->>'status' = status
  )
);

CREATE TABLE policyapply.apply_attempts (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  operation_id text NOT NULL,
  idempotency_digest text NOT NULL CHECK (idempotency_digest ~ '^[a-f0-9]{64}$'),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('claimed', 'executing', 'completed', 'failed', 'uncertain')),
  plan_id text NOT NULL,
  plan_revision integer NOT NULL CHECK (plan_revision > 0),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'agent', 'service')),
  mode text NOT NULL CHECK (mode = 'execute-v1'),
  claimed_at timestamptz NOT NULL,
  outcome jsonb,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id, operation_id),
  UNIQUE (tenant_id, project_id, operation_id),
  UNIQUE (tenant_id, project_id, idempotency_digest),
  FOREIGN KEY (tenant_id, project_id, plan_id, plan_revision, plan_digest)
    REFERENCES policyapply.change_plans(tenant_id, project_id, id, revision, digest),
  CONSTRAINT apply_attempts_operation_id_safe CHECK (operation_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT apply_attempts_actor_id_safe CHECK (actor_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT apply_attempts_outcome_object CHECK (outcome IS NULL OR jsonb_typeof(outcome) = 'object')
);

CREATE TABLE policyapply.audit_receipts (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  id text NOT NULL,
  event_type text NOT NULL CHECK (event_type = 'plan.apply.completed'),
  plan_id text NOT NULL,
  plan_revision integer NOT NULL CHECK (plan_revision > 0),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^[a-f0-9]{64}$'),
  operation_id text NOT NULL,
  actor_id text NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'agent', 'service')),
  occurred_at timestamptz NOT NULL,
  correlation_id text NOT NULL,
  result_code text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, operation_id),
  FOREIGN KEY (tenant_id, project_id, operation_id)
    REFERENCES policyapply.apply_attempts(tenant_id, project_id, operation_id),
  FOREIGN KEY (tenant_id, project_id, plan_id, plan_revision, plan_digest)
    REFERENCES policyapply.change_plans(tenant_id, project_id, id, revision, digest),
  CONSTRAINT audit_receipts_id_safe CHECK (id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT audit_receipts_correlation_safe CHECK (correlation_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT audit_receipts_result_code_safe CHECK (result_code ~ '^[a-z][a-z0-9._-]{0,63}$')
);

CREATE FUNCTION policyapply.reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit receipts are append-only' USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER audit_receipts_no_update
BEFORE UPDATE OR DELETE ON policyapply.audit_receipts
FOR EACH ROW EXECUTE FUNCTION policyapply.reject_audit_mutation();

ALTER TABLE policyapply.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE policyapply.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE policyapply.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE policyapply.projects FORCE ROW LEVEL SECURITY;
ALTER TABLE policyapply.change_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE policyapply.change_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE policyapply.apply_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE policyapply.apply_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE policyapply.audit_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE policyapply.audit_receipts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenants_tenant_isolation ON policyapply.tenants
  USING (id = policyapply.current_tenant_id())
  WITH CHECK (id = policyapply.current_tenant_id());
CREATE POLICY projects_tenant_isolation ON policyapply.projects
  USING (tenant_id = policyapply.current_tenant_id())
  WITH CHECK (tenant_id = policyapply.current_tenant_id());
CREATE POLICY change_plans_tenant_isolation ON policyapply.change_plans
  USING (tenant_id = policyapply.current_tenant_id())
  WITH CHECK (tenant_id = policyapply.current_tenant_id());
CREATE POLICY apply_attempts_tenant_isolation ON policyapply.apply_attempts
  USING (tenant_id = policyapply.current_tenant_id())
  WITH CHECK (tenant_id = policyapply.current_tenant_id());
CREATE POLICY audit_receipts_tenant_isolation ON policyapply.audit_receipts
  USING (tenant_id = policyapply.current_tenant_id())
  WITH CHECK (tenant_id = policyapply.current_tenant_id());

REVOKE UPDATE, DELETE ON policyapply.audit_receipts FROM PUBLIC;

COMMIT;
