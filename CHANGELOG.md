# Changelog

## [1.0.1] - 2026-06-04

### Fixed
- Added `#!/usr/bin/env node` shebang to entry point for reliable `npx` execution

## [1.0.0] - 2026-06-04

### Added
- 37 MCP tools across 8 categories: projects, services, deploy, env vars, logs, domains, databases, monitoring
- Bearer token authentication (more secure than email/password)
- Context banner in every response — Claude always knows which project/service it is touching
- Confirmation guard: destructive actions require `confirm: "CONFIRMO"` to execute
- Safe env var update (read-modify-write — never wipes existing variables)
- GitHub auto-deploy toggle (`enable_github_deploy` / `disable_github_deploy`)
- Deploy action tracking (`list_actions`, `get_action`)
- Sensitive env var masking in `get_env_vars` responses
- Runtime allowlist validation for database type parameter
- URL component encoding to prevent path traversal
- Companion Claude skill `/ep` for guided deploy workflow
