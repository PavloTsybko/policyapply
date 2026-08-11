# `@policyapply/authorization`

Deterministic, provider-neutral project authorization for PolicyApply.

`authorizeProjectAction` requires a valid principal, exact tenant equality, an
explicit project grant, every requested scope, and a principal that is neither
revoked nor expired. Scope strings are exact; wildcard-looking values receive
no special authority.

The package performs no I/O and remains private and unpublished while its API
is unstable.
