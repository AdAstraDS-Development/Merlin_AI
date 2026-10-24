# Git hooks

[Husky](https://typicode.github.io/husky/) runs these checks on your machine. CI runs the full checks again, so a hook that is skipped (`git commit --no-verify`) cannot let broken code into `main`.

| Hook         | Runs                          | Purpose                                                                               |
| ------------ | ----------------------------- | ------------------------------------------------------------------------------------- |
| `pre-commit` | `lint-staged`                 | Formats staged files with Prettier and lints staged TypeScript with ESLint            |
| `commit-msg` | `commitlint`                  | Rejects messages that do not follow Conventional Commits (`feat: …`, `fix(scope): …`) |
| `pre-push`   | `pnpm typecheck && pnpm test` | Stops a push when types or frontend tests fail                                        |

Hooks are installed by `pnpm install` (through the `prepare` script) when the folder is a Git repository. If you ran `git init` after installing, run `pnpm prepare` once. CI sets `HUSKY=0`, so no hooks are installed there.

Backend tests are not part of the hooks because they take longer; run `pnpm test:api` or `pnpm validate` before you push backend changes.

Hook files are POSIX shell scripts with LF line endings (enforced by `.gitattributes`). On Windows, Git runs them with its bundled shell.
