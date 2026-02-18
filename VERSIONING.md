# OAuth3 Versioning Convention

Three components share a version contract: **SDK**, **orchestrator**, and **enclave** (proxy).

## Version format

`MAJOR.MINOR.PATCH` (semver)

- **MAJOR.MINOR** must match across all three components for compatibility
- **PATCH** can differ — bug fixes and internal changes that don't affect the wire protocol

Example: SDK 0.1.3 is compatible with orchestrator 0.1.7 and enclave 0.1.0.
SDK 0.2.0 is NOT compatible with orchestrator 0.1.x.

## What triggers each bump

| Bump  | When |
|-------|------|
| PATCH | Bug fix, internal refactor, docs. No API change. |
| MINOR | New endpoint, new field in response, new optional parameter. Backward-compatible. |
| MAJOR | Breaking change: removed endpoint, renamed field, changed auth flow, envelope format change. |

## Current versions

| Component | Repo | Version |
|-----------|------|---------|
| SDK | `Account-Link/oauth3-skill` | 0.1.0 |
| Orchestrator | `Account-Link/oauth3-proxy-orchestrator` | 0.1.0 |
| Enclave (proxy) | `amiller/oauth3-openclaw` (proxy/) | 0.1.0 |

## Checking compatibility

The SDK sends `X-OAuth3-SDK-Version: 0.1.0` on every request.
The orchestrator can reject requests from incompatible SDK versions with:
```json
{"error": "sdk_version_mismatch", "required": "0.2.x", "got": "0.1.3"}
```

## Release process

1. Make changes in the component repo
2. If MAJOR or MINOR bumped: update all three `package.json` files to match
3. Tag: `git tag v0.1.0`
4. Deploy enclave → orchestrator → publish SDK (in that order, so the backend is ready first)
