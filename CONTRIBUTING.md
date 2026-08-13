# Contributing to easypanel-mcp-server

Thank you for your interest in contributing!

## How to Contribute

1. Fork the repository
2. Create your branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Commit using Conventional Commits: `git commit -m 'feat: add my feature'`
5. Push: `git push origin feature/my-feature`
6. Open a Pull Request

## Commit Convention

| Prefix | When to use |
|--------|-------------|
| `feat:` | New tool or feature |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `chore:` | Build, dependencies, config |
| `security:` | Security fix |

## Local development

```bash
npm ci
npm run build     # tsc
npm test          # 51 tests, no network
```

CI runs build + tests on Node 18/20/22 for every push and PR.

## Adding a New Tool

1. Create `src/tools/your-tool.ts` following the pattern of existing tools
2. Add it to `src/tools/index.ts`
3. If it calls a procedure not yet used, map it in `src/procedures.ts` — the
   contract test will fail if the public name doesn't exist in the panel spec
4. Add the entry to README.md tool table and `llms.txt`
5. Update `CHANGELOG.md`

## When Easypanel changes its API

This project has been broken three times by the panel changing the API underneath
it (2.31 swapped tRPC for RPC, 2.32 reorganised the OpenAPI, 2.33 published the
flat public API) — every time, a user found out first. Two things guard against it:

- **Contract tests** (`test/procedures.test.ts`) check every mapped procedure
  against a committed snapshot of a real panel spec
  (`test/fixtures/easypanel-2.33-ops.json`). These catch *our* regressions, and
  run in CI on every push with no credentials.
- **Drift check** (`npm run check:api`) compares that snapshot against a **live**
  panel. This catches *their* changes.

The drift check runs automatically as part of `prepublishOnly`, so **publishing a
release verifies the API for real first** — on the publisher's machine the panel
credentials are already there (same config the MCP uses), and a mapped procedure
that vanished or changed HTTP method **aborts the publish**. Anywhere without
credentials (a fresh clone, a fork's CI) the step prints a notice and passes; an
unreachable panel never blocks a release either. Override with `SKIP_API_CHECK=1`.

```bash
npm run check:api            # uses EASYPANEL_URL / EASYPANEL_TOKEN from the environment
npm run check:api -- --update  # rewrite the snapshot with the current spec, then review the diff
```

### About the weekly CI drift job

`.github/workflows/api-drift.yml` can run the same check on a schedule and open
an issue on divergence. **It is off by default and that is deliberate.**

An Easypanel API token carries the permissions of its user, and an admin token
controls the whole server — every project's databases and environment secrets.
Storing one in a public repository's Actions secrets, for a convenience check, is
a bad trade: the blast radius of a leak is the entire production server, while the
prepublish gate above already catches drift at the moment it matters, with the
credential never leaving the maintainer's machine.

If you still want the scheduled job, create a **dedicated non-admin user** in the
panel and use its token — never the admin one — and set `EASYPANEL_URL` /
`EASYPANEL_TOKEN` as repo secrets. The job only issues `GET /api/openapi.json`.
It is not triggered by `pull_request`, so fork PRs cannot read the secrets.

## Security

If you find a security vulnerability, do NOT open a public issue. Email: contato@helbertparanhos.com.br

## Questions

Open an issue or contact: contato@helbertparanhos.com.br
