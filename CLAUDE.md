@AGENTS.md

# Claude Code

Skills, subagents and hooks live in `.claude/`. Hooks block edits to lock files, `.env` files and secrets, and ask before you change workflows, infrastructure, authentication code, the agent configuration or build and test configuration. Skills advise; hooks and permissions enforce (`.claude/hooks/guard.mjs`, `.claude/settings.json`).

- Start in plan mode (the default here). For a feature, use the `intent` skill, then the `spec` skill; commit the plan you and the engineer agree on as `intent/NNN-*/plan.md` before writing code.
- Apply the `secure-endpoints` skill to every endpoint you specify, plan or write.
- Before you report a task as done, run the `verifier` subagent and report what it found.
- Agents work through pull requests. Do not push to `main`, apply infrastructure or start production releases. Enforced by hooks and branch protection, not only by this text.

## Verifying your work

- `pnpm validate` must pass. Paste its final output in your report, or say exactly what you could not run.
- When a test fails, fix the code, not the test. Change a test only if the requirement changed, and say so. For fix tasks the person can set `CLAUDE_PROTECT_TESTS=1`, which makes the hook refuse edits to tests.
- Check each acceptance criterion in `spec.md` against a test named with its use-case ID.

## Corrections

When you make the same mistake twice, the person adds the correction here so it does not happen a third time.

<!-- Add corrections below, one line each, with the date. -->
