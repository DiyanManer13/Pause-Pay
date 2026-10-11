# Security Policy

## Supported version

Security fixes are applied to the current main branch.

## Reporting a vulnerability

Please do not post vulnerabilities, credentials, or proof-of-concept exploits in public issues.

Use GitHub's private security-advisory reporting feature for this repository. If it is unavailable, open a minimal public issue asking a maintainer for a private contact channel; do not include exploit details.

## Local development

- Do not commit .env files, private keys, AWS credentials, database dumps, or tokens.
- Keep AWS credentials outside the frontend. The backend uses the AWS SDK credential provider chain.
- PostgreSQL and Redis in the development Compose file bind to 127.0.0.1 only.
