# Security Policy

## Supported Versions

Security fixes are handled on a best-effort basis for:

- the current default branch
- the latest tagged release

Older releases may not receive security updates.

## Reporting A Vulnerability

Please do not open a public issue for suspected security vulnerabilities.

Use the repository host's private vulnerability reporting feature if it is
enabled. If private reporting is unavailable, contact the maintainers through a
non-public contact path listed on the repository or owner profile.

When reporting a vulnerability, include:

- a concise description of the issue
- affected area or feature
- reproduction steps or proof of concept
- impact assessment
- any suggested mitigation if you have one

## What To Expect

Maintainers will review reports as quickly as practical and aim to:

- confirm whether the report is in scope
- reproduce the issue when possible
- decide on a remediation path
- coordinate disclosure timing when a fix is needed

Please avoid public disclosure until the maintainers have had a reasonable
opportunity to investigate and mitigate the issue.

## Scope

Security reports are especially helpful for issues involving:

- secret handling
- credential storage
- provider authentication flows
- MCP connectivity and authorization
- SSH, browser, or workspace execution surfaces
- unsafe file access or SSRF
- code execution or sandbox escapes
- privacy-impacting data exposure

## Out Of Scope

The following are usually out of scope unless they create a direct security impact:

- general feature requests
- crashes without a security angle
- cosmetic or UX bugs
- unsupported local modifications
- theoretical concerns without a reproducible path

## Safe Handling Expectations For Contributors

- Never commit secrets, tokens, private keys, or production credentials.
- Use local test credentials and mock services where possible.
- Avoid sharing sensitive logs or payloads in public issues and pull requests.
- Prefer minimal proof-of-concept material over broad dumps of personal or
  production data.
