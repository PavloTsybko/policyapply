# M0 source-admission audit

Status: **draft evidence for maintainer review**

Audit date: 2026-08-11

Audited stack head: `3fecaea` (`agent/m1-docker-quickstart`)

Audited range: `main..agent/m1-docker-quickstart` plus reachable Git history

This document records technical evidence. It is not legal advice, an ownership
attestation, a security certification, or approval to publish packages,
containers, releases, or deployments.

## Admission scope

The proposed M1 admission is the ordered stack below. Each pull request is
still a draft and must be reviewed and merged in order.

| Order | Pull request | Scope | Base | CI at audit time |
| --- | --- | --- | --- | --- |
| 1 | #1 | tenant contracts and exact-scope authorization | `main` | passing |
| 2 | #2 | immutable plan and independent approval | PR #1 branch | passing |
| 3 | #3 | idempotent apply and append-only audit | PR #2 branch | passing |
| 4 | #4 | PostgreSQL persistence and forced RLS | PR #3 branch | passing |
| 5 | #5 | OpenAPI-first Fastify reference API | PR #4 branch | passing |
| 6 | #6 | disposable synthetic Docker quickstart | PR #5 branch | passing |

No real provider mutation, production persistence, deployment, package/image
publication, MCP server, SDK, UI, or release is included in this admission.

## Evidence

### Repository authorship inventory

`git shortlog -sne --all` reports one contributor name, Pavlo Tsybko, using two
email identities. Git metadata alone cannot prove ownership, employment status,
or the right to relicense. The maintainer must complete the attestation below.

### Secret-history scan

Gitleaks scanned all reachable refs with redaction enabled:

```sh
gitleaks git --redact --log-opts='--all' .
```

Result at the audited head: 14 commits scanned, no leaks found. This is a
point-in-time automated scan; it does not replace manual review or future CI
secret scanning.

### Dependency-license inventory

The frozen pnpm lockfile was installed without version changes. Installed
package manifests were inventoried by package name, version, and declared
license. Declared license families observed were:

- MIT;
- ISC;
- BSD-3-Clause;
- Apache-2.0;
- MPL-2.0.

Direct runtime dependencies (`fastify` and `pg`) declare MIT. Direct developer
dependencies declare MIT or Apache-2.0. `lightningcss` and its platform
packages declare MPL-2.0 and enter transitively through the development test
chain `vitest -> vite -> lightningcss`; they are not direct runtime
dependencies. Their notice/source obligations still require maintainer or
legal review before distributing release artifacts or container images.

Nested fixture/package-boundary manifests without a license field were found
inside dependency test or subpath directories. They are not separate lockfile
packages; the containing packages declare MIT or BSD-3-Clause. This distinction
must be rechecked whenever the lockfile changes.

The native `pnpm licenses list --json` command could not complete in the local
Codex runtime because its shared package-store index is read-only/incomplete.
The manifest inventory above is therefore evidence for review, not a generated
legal notice. A clean CI-generated third-party notice remains a release gate.

## Required maintainer decisions

The following items must be completed by the repository maintainer. They may
not be inferred or approved by an automated agent.

- [x] I confirm that I own the admitted source or have authority to publish it.
- [x] I confirm that the admitted source was not copied from a private employer,
      client, contractor, or otherwise restricted repository.
- [x] I reviewed the two Git email identities and confirm they represent the
      same authorized contributor.
- [x] I reviewed dependency licenses, including the MPL-2.0 transitive tooling
      dependency and any distribution obligations.
- [x] I approve Apache-2.0 for the repository source.
- [ ] I approve generating and reviewing a third-party notices artifact before
      any package, image, or release publication.
- [x] I approve converting and merging PRs #1 through #6 in order.

The checked decisions above record the maintainer's explicit written
attestation on 2026-08-11. They do not authorize an automated merge, package or
image publication, deployment, or release.

## Merge and rollback plan

After all maintainer decisions above are recorded:

1. review PR #1 against `main`, mark it ready, and merge it;
2. retarget/rebase PR #2 onto updated `main`, rerun CI, and merge it;
3. repeat sequentially for PRs #3 through #6;
4. rerun the full test, PostgreSQL integration, Docker smoke, and secret scan on
   the combined `main` branch;
5. retain the approved Apache-2.0 license and generate/review third-party
   notices before distributing any package, image, or release.

If any slice fails review, stop at that slice. Do not merge later stacked pull
requests. Because no release or deployment exists, rollback is performed by
closing or revising the affected pull request rather than mutating production
state.

## Admission result

Technical M1 evidence and the recorded ownership/license decisions are **ready
for final review**. M0 delivery remains pending the merge sequence above. A
third-party notices artifact remains a gate for package, image, or release
distribution. No deployment or release is authorized by this document.
