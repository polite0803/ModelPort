# Security Policy

## Supported versions

Security fixes are applied to the latest released version. Older versions may be updated only when
the fix can be backported safely; please upgrade to the latest release before reporting an issue
that also reproduces there.

## Reporting a vulnerability

Please do **not** open a public issue for a suspected vulnerability.

1. Use GitHub's private vulnerability reporting:
   <https://github.com/polite0803/ModelPort/security/advisories/new>
2. If private reporting is unavailable, email `polite0803@outlook.com` with `SECURITY` in the
   subject line.

Include as much of the following as you can:

- affected ModelPort version and operating system;
- whether the proxy was running with API-key authentication enabled;
- the smallest reproduction (request shape, provider/account configuration, relevant settings);
- the impact you believe is possible;
- logs or a diagnostic bundle with credentials, API keys and tokens redacted.

Do not include live credentials, private keys or other users' data in a report.

## Scope

The following parts of the application are in scope:

- API-key authentication and the fail-closed `/v1/*` listener behavior;
- credential storage and OS keystore / `safeStorage` handling;
- the HTTPS listener, certificate management and certificate-trust helpers;
- request forwarding, header handling, model mapping and management API authorization;
- Electron IPC boundaries between the renderer, preload and main process.

The following are generally out of scope:

- vulnerabilities in a third-party upstream provider or in the models it serves;
- a client choosing to trust a self-signed certificate it fetched itself;
- local-only attacks that require an attacker to already have the user's OS account or `data.json`.

This is a single-maintainer project: response times are best-effort, and there is no guaranteed
service-level agreement. A report will be acknowledged, triaged and coordinated before any public
disclosure.
