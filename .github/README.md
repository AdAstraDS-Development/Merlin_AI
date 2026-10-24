# GitHub configuration

| File                                                 | Purpose                                                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [workflows/](workflows/README.md)                    | Pull-request checks, release, infrastructure and optional Claude review pipelines, with setup guide            |
| [../REVIEW.md](../REVIEW.md)                         | What every pull request review checks: bugs, security, compliance with the intent, spec and plan               |
| [dependabot.yml](dependabot.yml)                     | Weekly updates for npm, NuGet, the .NET SDK, Terraform and GitHub Actions; minor and patch updates are grouped |
| [pull_request_template.md](pull_request_template.md) | Description and checklist for every pull request                                                               |

## Repository settings

Files cannot enforce these; an admin sets them once:

- **Branch protection on `main`:** require pull requests, at least one approving review, resolved conversations and the **Pull request checks** status checks; block force pushes and deletion; do not allow admins to bypass.
- **Merging:** use squash merges, with the pull request title in Conventional Commits form (`feat: …`).
- **Security:** turn on Dependabot alerts and security updates, secret scanning and push protection.
- **Environments:** see [pipeline setup](workflows/README.md#5-create-github-environments).
- **Code owners:** no CODEOWNERS ships with the template; add one before relying on review of the files the hooks ask about (authentication, infrastructure, workflows, `AGENTS.md`, `CLAUDE.md`, `REVIEW.md` and `.claude`).

## Coding agents

- Agent instructions live in [AGENTS.md](../AGENTS.md) at the repository root. GitHub Copilot, Claude Code (via `CLAUDE.md`) and most other agents read it. Claude Code also gets skills, a verifier subagent and guard hooks from `.claude/`. Keep it short and accurate, and update it when commands, structure or rules change.
- Instructions guide agents but do not enforce anything; branch protection, CI and reviews do. [REVIEW.md](../REVIEW.md) tells reviewers, human or automated, what to check; the optional [Claude review](workflows/README.md#8-optional-turn-on-claude-review) applies it to every pull request and only comments.
- Agents work through pull requests: do not give them rights to push to `main`.
