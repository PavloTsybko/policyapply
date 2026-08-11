# `@policyapply/domain`

Pure domain functions for immutable change plans and independent decisions.

This pre-release slice supports only:

- creation of a secret-free, JSON-safe draft plan;
- SHA-256 integrity metadata over canonical immutable content;
- approval or rejection bound to the exact revision and digest;
- rejection of self-approval and terminal-state replay.

The digest is not a signature or an authorization mechanism. Callers must use
`@policyapply/authorization` before invoking domain operations. Apply,
persistence, HTTP, OpenAPI, MCP, and provider execution are not implemented.
