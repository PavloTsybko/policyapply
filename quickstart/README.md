# Disposable Docker quickstart

This quickstart is a local, synthetic demonstration. It is not a production
deployment template and must not be exposed to an untrusted network.

## Requirements

- Docker Engine with Docker Compose v2;
- OpenSSL;
- curl and jq for the smoke test.

## Start and verify

```bash
pnpm quickstart:up
pnpm quickstart:smoke
```

The API binds only to `127.0.0.1:3000`. PostgreSQL has no host port. The first
command generates local random credentials under ignored `.quickstart/`,
builds the unpublished image locally, applies the reference migration, creates
a non-superuser/non-`BYPASSRLS` runtime role, and seeds only:

- tenant `tenant_quickstart`;
- project `project_quickstart`;
- separate synthetic creator and approver principals.

The smoke test demonstrates:

1. an authenticated principal creates a draft plan;
2. creator self-approval is denied;
3. a separate principal approves the exact revision and digest;
4. the fake executor returns a synthetic result without network/provider I/O;
5. the same apply request is replayed with the same operation receipt;
6. exactly one payload-free audit receipt is visible.

Generated bearer and database credentials are read from Docker secret files;
they are not committed, passed as Compose environment values, or printed by
the scripts. Request/response evidence remains under ignored `.quickstart/`.

## Stop and remove disposable data

```bash
pnpm quickstart:down
```

This removes only the `policyapply-quickstart` containers, network, and named
database volume. Generated local secret files remain ignored for repeatable
restarts. Remove the `.quickstart` directory manually only when you intend to
rotate that disposable local state.

## Explicit limitations

- the image is not published and has no release support;
- the API contains only the fixed synthetic quickstart authenticator;
- the fake executor performs no external mutation;
- there is no TLS, ingress, backup, monitoring, secret manager, scaling,
  production role provisioning, or upgrade automation;
- this Compose file must not be reused for staging or production.
