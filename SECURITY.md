# Security policy

PolicyApply is security-sensitive infrastructure. Do not disclose suspected vulnerabilities in public issues, pull requests, discussions, or social posts.

## Report privately

Use GitHub Private Vulnerability Reporting:

https://github.com/PavloTsybko/policyapply/security/advisories/new

Include the affected version or commit, impact, prerequisites, a minimal reproduction, and suggested mitigation if available. Remove credentials, personal data, customer information, private URLs, database dumps, and production logs.

## Supported versions

PolicyApply has no release yet. Until the first release, security reports apply only to the latest commit on `main`. A supported-version table will be added before `1.0.0`.

## Priority areas

- cross-tenant access or missing tenant enforcement;
- authentication, scope, approval, or apply bypass;
- replay/idempotency failures causing duplicate mutation;
- secret exposure in logs, errors, plans, responses, or audit records;
- RLS or security-definer privilege escalation;
- webhook SSRF, DNS rebinding, signature, or replay weaknesses;
- MCP tenant selection or policy bypass;
- adapter version substitution or conformance bypass;
- package, CI, or container supply-chain compromise.

PolicyApply is not a secret manager, network sandbox, identity provider, or guarantee that an adapter/provider is safe. Deployers remain responsible for infrastructure, credentials, backups, monitoring, and incident response.
