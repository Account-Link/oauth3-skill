# Roadmap

## v0.2.0 — Attestation dashboard + client-side secret entry

### Tenant dashboard (orchestrator-served)
- Login with API key, stay cookied
- See pending approvals, active sessions, execution history
- Approve/deny from dashboard (not just one-off URLs)

### Client-side attestation verification
- Orchestrator serves a static JS bundle that:
  1. Fetches `/attestation` from TEE (through orchestrator)
  2. Recovers signers from `signature_chain` using secp256k1 (browser JS)
  3. Asserts chain terminates at dstack KMS root on Base (`0x2f83172A...`)
  4. Shows green/red trust indicator to user
- Bundle hash can be pinned in docker-compose for auditability

### Client-side secret encryption
- Secret entry page encrypts to TEE's public key in-browser before POST
- Orchestrator never sees plaintext secrets
- Uses same AES-256-GCM envelope as SDK `seal()`
- Human gets same MITM protection as agent

### SDK attestation
- Full signature chain verification in SDK (currently stubbed)
- Requires `@noble/curves` for secp256k1 ecrecover
- `OAuth3.create()` verifies by default, opt-out with `{ skipVerification: true }`
