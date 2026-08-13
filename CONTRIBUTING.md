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
  (`test/fixtures/easypanel-2.33-ops.json`). These catch *our* regressions.
- **Drift check** (`npm run check:api`) compares that snapshot against a **live**
  panel. This catches *their* changes. It runs weekly in CI and opens an issue on
  divergence; the `EASYPANEL_URL` / `EASYPANEL_TOKEN` repo secrets enable it
  (the job skips cleanly without them — forks need no setup).

```bash
EASYPANEL_URL=https://panel.example.com EASYPANEL_TOKEN=... npm run check:api
# add --update to rewrite the snapshot with the current spec, then review the diff
```

## Security

If you find a security vulnerability, do NOT open a public issue. Email: contato@helbertparanhos.com.br

## Questions

Open an issue or contact: contato@helbertparanhos.com.br
