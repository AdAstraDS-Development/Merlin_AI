# Intent

Every change starts here as a chain of committed files, following the AI-native SDLC playbook. Each file is written with an agent, reviewed by a person and committed before the next step starts. Together they are the audit trail: who asked for what, what was decided, and how it was built.

| File        | Written by                                               | Approved by                                              | Content                                                                                                   |
| ----------- | -------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `intent.md` | The person with the idea, together with an agent         | Product owner (merge of the pull request)                | Problem, proposed outcome, affected users and systems, constraints, open questions                        |
| `spec.md`   | Agent, from the accepted intent and the project's skills | Product owner; tech lead for higher-risk changes         | Use cases with acceptance criteria (Given/When/Then), API and UI design, data, security, flagged concerns |
| `plan.md`   | Agent in plan mode, iterated with the engineer           | Engineer; tech lead or architect for higher-risk changes | Files that change, order of work, risks, how each acceptance criterion is proven                          |

## Layout

```text
intent/
  001-initial/          created by the initializer or the factory when intake was given
    intent.md           it starts with intent.md only
    spec.md             written later, from the accepted intent
    plan.md             written later, from the approved spec
    source/             original documents, kept unchanged (excluded from formatting)
  002-<short-name>/
    ...
```

Number folders in order and never reuse a number. Use-case IDs (`UC-01`, …) are unique across the project; reference them in tests, commits and pull requests.

## Working with an agent

- **Capture:** "Write an intent for: …" — the `intent` skill asks the questions an analyst would ask and writes `intent.md`.
- **Specify:** "Write the spec for intent 002" — the `spec` skill applies the project's standards (for example `secure-endpoints`) and flags concerns it cannot resolve.
- **Plan and build:** start in plan mode, let the agent produce `plan.md`, correct it, commit it, then let the agent implement. If the implementation departs from the plan, update `plan.md` in the same commit.

See [AGENTS.md](../AGENTS.md) for the rules every step follows. Changes without an intent (small fixes, dependency updates) go straight to a pull request.
