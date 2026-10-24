# Documentation

| Document                                            | For        | Content                                                                                                               |
| --------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| [Architecture blueprint](architecture/blueprint.md) | Developers | How the app is built and where to extend it                                                                           |
| [Intent, spec and plan](../intent/README.md)        | Everyone   | One folder per change: intent, spec with acceptance criteria, plan. See [AGENTS.md](../AGENTS.md#working-from-intent) |
| [User guide](user-guide/README.md)                  | Users      | What the app does and how to use it                                                                                   |
| [Operations](operations/README.md)                  | Operators  | Acceptance checklist, sessions, failures, recovery                                                                    |
| [Upgrading](operations/upgrading.md)                | Developers | Keeping Node, .NET, packages, Terraform and actions current                                                           |
| [Backend](../api/README.md)                         | Developers | Endpoints, sign-in setup, sessions                                                                                    |
| [Frontend](../web/README.md)                        | Developers | Structure and API client                                                                                              |
| [Pipelines](../.github/workflows/README.md)         | Admins     | One-time GitHub and Azure setup                                                                                       |

Update documentation in the same pull request as the change it describes. Record significant design decisions as short notes in `architecture/` (context, decision, consequences) when you make them.
