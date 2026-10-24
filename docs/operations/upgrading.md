# Upgrading

Dependabot opens pull requests every week for npm packages, NuGet packages, the .NET SDK, Terraform providers and GitHub Actions. Minor and patch updates arrive grouped, one pull request per ecosystem. Major updates arrive one by one.

## Reviewing a Dependabot pull request

1. Read the release notes linked in the pull request, especially for major versions.
2. Let the **Pull request checks** run. They install from the lock files, run every test and smoke-test the packaged app.
3. For Terraform provider updates, run the **Infrastructure** workflow with `apply` off and check that the plan shows no unexpected changes.
4. For changes to sign-in or ASP.NET Core packages, sign in and out once in development after the release.

Security updates should be merged within days, other updates at least monthly.

## Updates Dependabot does not make

| Part            | When                                                                          | How                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js         | A new even-numbered major becomes LTS (every October); patch releases monthly | Update `.node-version` and `engines.node` in `package.json`, then run `pnpm install` and `pnpm validate`                                                             |
| pnpm            | New major                                                                     | Update `packageManager` and `engines.pnpm` in `package.json` and the install step in `.github/workflows/_build.yml`, then regenerate `pnpm-lock.yaml`                |
| Claude Code CLI | A release you have tested                                                     | Update the pinned `@anthropic-ai/claude-code` version in `claude-review.yml` and the `triage` job in `ci.yml`, then open a test pull request                         |
| Terraform CLI   | New minor                                                                     | Update `required_version` in `infrastructure/versions.tf` and `terraform_version` in `ci.yml` and `infrastructure.yml`                                               |
| .NET major      | Every November (even years are LTS)                                           | Update `TargetFramework` in both `*.csproj`, `global.json`, the App Service `dotnet_version` in `infrastructure/main.tf` and the debug path in `.vscode/launch.json` |

After each of these, update the version statements in `README.md`, `AGENTS.md` (Stack section), `docs/architecture/blueprint.md` and the affected component README.

## Package rules

- Lock files are committed and CI installs from them unchanged (`pnpm install --frozen-lockfile`, `dotnet restore --locked-mode`). After changing a package version, run `pnpm install` or `dotnet restore api/Merlin.slnx --force-evaluate` and commit the lock file.
- pnpm installs packages only once they have been published for at least a day, as protection against compromised releases. Do not add exclusions to get around this.
- Pin exact versions (`saveExact` is on). Pin GitHub Actions to a full commit SHA with the version in a comment.
