# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub Security Advisories — the *Report a
vulnerability* button on this repository's **Security** tab — or by email to
**ys9410017064@gmail.com**. Include what you found, how to reproduce it, and what an attacker
could do with it.

You can expect an acknowledgement within a few days. This is a solo project, so
fixes arrive as quickly as one person reasonably can manage; please give me a
chance to ship one before disclosing publicly.

## Supported versions

The latest release and the current `main` branch receive fixes. Older tags do not.

## Running InstaPilot AI safely

- **Bring your own credentials.** No keys are bundled with this repository, and
  none should ever be committed. Keep them in your local `.env`, which is
  git-ignored.
- **Treat the deployment as yours.** You are the operator: you control where it
  runs, who reaches it, and what it is allowed to do.
- **Don't expose local tools to the public internet.** Anything designed to run
  on `localhost` should stay there, or sit behind authentication.
- **Review what it sends.** Where the project talks to third-party APIs, those
  providers' terms and privacy policies apply to your data.

## Scope

Vulnerabilities in this source code are in scope. Issues in third-party
services, APIs, models or hosting providers should be reported to those
providers directly.
