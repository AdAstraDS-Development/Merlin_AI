## What and why

<!-- What changes, and why. Reference the use case (UC-xx) or issue. -->

## How it was tested

<!-- Commands you ran and their result. Mention anything you could not test, such as real Entra sign-in. -->

- [ ] `pnpm validate` passes
- [ ] Each new acceptance criterion has a test named after its use case

## Checklist

- [ ] New private endpoints use `RequireAuthorization()`; state-changing ones also use `RequireCsrf()`
- [ ] Input is validated on the server; errors are returned as problem details
- [ ] No secrets, tokens or personal data in code, config, logs or test data
- [ ] Docs updated: endpoints table in `api/README.md`, user guide, spec status
- [ ] Infrastructure, workflow or sign-in changes are called out for reviewers

## Screenshots

<!-- For UI changes. -->
