# `Merlin`

Web application with a React frontend and a .NET 10 backend that serves the frontend, handles Microsoft Entra ID sign-in and keeps sessions on the server. Application identifier: `merlin`.

The public home page works immediately, with no Entra or Azure setup. The protected workspace (`/app`) and private APIs need real sign-in; there is no mock login.

## Prerequisites

| Tool      | Version                                                |
| --------- | ------------------------------------------------------ |
| Node.js   | 26.12 or newer 26.x (see `.node-version`)              |
| pnpm      | 12.14 or newer 12.x                                    |
| .NET SDK  | 10.0.402 or a newer 10.0.4xx patch (see `global.json`) |
| Terraform | 1.16.x (only for infrastructure work)                  |

On Windows, keep the project in a short path such as `C:\dev\merlin`. Deep paths can exceed the 260-character limit inside `node_modules`.

## Run locally

```powershell
pnpm install --frozen-lockfile
dotnet dev-certs https --trust   # once per machine
pnpm start
```

Open https://localhost:7243. The page shows whether the API is online. Sign-in stays unavailable until you [configure Entra](api/README.md#enable-sign-in). No database, container or cloud account is needed.

| Command                       | What it does                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm start`                  | Builds the frontend and runs the .NET host with HTTPS                                                                                                                           |
| `pnpm --dir web dev`          | Vite dev server with hot reload (start the backend first; sign-in only works on the HTTPS .NET address)                                                                         |
| `pnpm test` / `pnpm test:api` | Frontend / backend tests                                                                                                                                                        |
| `pnpm test:hooks`             | Tests for the Claude Code hooks                                                                                                                                                 |
| `pnpm format`                 | Formats all files with Prettier                                                                                                                                                 |
| `pnpm validate`               | Runs the application checks: lint, typecheck, formatting (web and API), frontend, hook and backend tests, and the build. CI also packages, smoke-tests and validates Terraform. |
| `pnpm package:app`            | Writes the deployable app to `artifacts/app`                                                                                                                                    |

VS Code users get tasks and a debug configuration ("Debug BFF + SPA"); see [.vscode](.vscode/README.md).

## Build features

Every feature or behaviour change follows the chain intent, spec, plan, build, prove, document. The first three are reviewed files in [intent/](intent/README.md); coding agents follow [AGENTS.md](AGENTS.md). People should follow the same steps. Small fixes and dependency updates go straight to a pull request.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat: …`, `fix: …`); a Git hook checks this.

## AI-assisted development

The project follows the AI-native SDLC playbook: `intent/NNN-name/intent.md`, then `spec.md`, then `plan.md`, each written with an agent, reviewed by a person and committed before the next starts.

- [AGENTS.md](AGENTS.md) holds the rules for any coding agent. [CLAUDE.md](CLAUDE.md) imports it and adds instructions for Claude Code.
- `.claude/` holds the Claude Code setup: permissions that start in plan mode, skills (`intent`, `spec`, `secure-endpoints`, `data-access`), a report-only `verifier` subagent and hooks that block edits to lock files, `.env` files and secrets and ask before changes to workflows, infrastructure, authentication, the agent configuration (`CLAUDE.md`, `AGENTS.md`, `REVIEW.md`, `.claude`) and build or test configuration. Run `pnpm test:hooks` to test the hooks. Personal overrides go in `.claude/settings.local.json` (not committed).
- [REVIEW.md](REVIEW.md) says what a pull request review checks.
- An optional Claude review comments on pull requests and diagnoses failed checks. It is off until you set it up ([pipeline setup](.github/workflows/README.md#8-optional-turn-on-claude-review)) and never blocks a merge.

## Deploy

1. Do the one-time [pipeline setup](.github/workflows/README.md): Terraform state, resource groups, Azure identities, GitHub environments and variables. A project created by the project factory has this done already, except the optional Claude review.
2. Run the **Infrastructure** workflow to create the Azure resources ([details](infrastructure/README.md)).
3. Push to `main`. The **Release** workflow tests, packages and deploys to development. To promote the same package to production, run **Release** manually with `production` ticked and approve the deployment.

Until the repository variable `DEPLOY_ENABLED` is `true`, release runs build and test and skip the deployment.

## Project layout

| Folder                                               | Content                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| [web](web/README.md)                                 | React frontend                                                    |
| [api](api/README.md)                                 | .NET backend: endpoints, sign-in, sessions, tests                 |
| [infrastructure](infrastructure/README.md)           | Terraform for Azure App Service                                   |
| [.github](.github/README.md)                         | Workflows, Dependabot, pull-request template, repository settings |
| [docs](docs/README.md)                               | Architecture, operations and user guide                           |
| [intent](intent/README.md)                           | Intent, spec and plan for every change                            |
| `.claude`                                            | Claude Code settings, hooks, skills and subagents                 |
| [.husky](.husky/README.md)                           | Git hooks                                                         |
| [.vscode](.vscode/README.md), [.mcp](.mcp/README.md) | Editor settings and MCP policy                                    |
| `tools`                                              | Small build and test scripts                                      |

## Not included yet

Add these when a use case needs them, not before:

- A database and migrations, roles and record-level authorization.
- Monitoring with Application Insights and alerts, private networking, custom domains.
- More than one app instance. Sessions are stored on the instance's disk; scaling out needs a shared session store first (see [operations](docs/operations/README.md)).

Before going to production, work through the [operations checklist](docs/operations/README.md#acceptance-checklist).
