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

## Adding a New Tool

1. Create `src/tools/your-tool.ts` following the pattern of existing tools
2. Add it to `src/tools/index.ts`
3. Add the entry to README.md tool table and `llms.txt`
4. Update `CHANGELOG.md`

## Security

If you find a security vulnerability, do NOT open a public issue. Email: contato@helbertparanhos.com.br

## Questions

Open an issue or contact: contato@helbertparanhos.com.br
