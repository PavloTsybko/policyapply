# M0 source-admission audit

Status: **admitted evidence**

Audit date: 2026-08-11

Audited stack head: `3fecaea` (`agent/m1-docker-quickstart`)

Audited range: `main..agent/m1-docker-quickstart` plus reachable Git history

This document records technical evidence. It is not legal advice, an ownership
attestation, a security certification, or approval to publish packages,
containers, releases, or deployments.

## Admission scope

The completed M1 admission used the ordered stack below. Each pull request was
reviewed, retargeted to the current `main`, CI-verified, and merged in order.

| Order | Pull request | Scope | Base | Admission result |
| --- | --- | --- | --- | --- |
| 1 | #1 | tenant contracts and exact-scope authorization | `main` | merged |
| 2 | #2 | immutable plan and independent approval | PR #1 branch | merged |
| 3 | #3 | idempotent apply and append-only audit | PR #2 branch | merged |
| 4 | #4 | PostgreSQL persistence and forced RLS | PR #3 branch | merged |
| 5 | #5 | OpenAPI-first Fastify reference API | PR #4 branch | merged |
| 6 | #6 | disposable synthetic Docker quickstart | PR #5 branch | merged |

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

## Completed merge sequence and rollback policy

The approved stack was merged in order as merge commits:

1. PR #1: `0d2eaf9`;
2. PR #2: `8ed18e0`;
3. PR #3: `4d63bdb`;
4. PR #4: `7cb19b6`;
5. PR #5: `4495e8f`;
6. PR #6: `0fdc62c`;
7. M0 audit and Apache-2.0 PR #7: `c82eef8`.

Each stacked branch was retargeted to updated `main` and passed CI before its
merge. The final `main` push passed unit tests, PostgreSQL integration, Docker
smoke, and disposable-volume cleanup.

Because no release or deployment exists, any future rollback must use a
reviewed Git revert and rerun the complete CI suite. Production rollback is not
applicable.

## Admission result

M0 and M1 source admission are **complete on `main`**. A third-party notices
artifact remains a gate for package, image, or release distribution. No
deployment or release is authorized by this document.
