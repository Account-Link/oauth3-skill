# oauth3-skill

Run code in a TEE sandbox with human approval. Your agent submits TypeScript, a human approves, the code executes with access to secrets the agent never sees.

## Quick start

```typescript
import { OAuth3 } from 'https://raw.githubusercontent.com/Account-Link/oauth3-skill/main/index.ts'

// Auto-signup, no config needed
const client = await OAuth3.create()

// Submit code — returns immediately with approval URL
const result = await client.execute({
  skill_id: 'my-task',
  skill_code: `// @skill my-task
// @description Fetch something
// @secrets API_KEY
// @network api.example.com
// @timeout 30
const r = await fetch('https://api.example.com', {
  headers: { Authorization: Deno.env.get('API_KEY')! }
})
console.log(await r.text())`
})

// Show the human the approval link
console.log(result.approval_url)

// Wait for approval + execution (long-polls, up to 5 min)
const final = await client.poll(result.request_id)
console.log(final.result?.stdout)
```

Or use `executeAndWait` which prints the approval URL and polls automatically:

```typescript
const result = await client.executeAndWait({
  skill_id: 'hello',
  skill_code: '// @skill hello\n// @description Hello\nconsole.log("hi")'
})
// prints: 👉 Approve: https://...
// then blocks until result
```

## API key persistence

`OAuth3.create()` automatically saves your API key to `~/.oauth3/key` on first signup and reloads it on subsequent calls. You can also set `$OAUTH3_API_KEY` env var, or pass a key directly:

```typescript
const client = await OAuth3.create('oauth3_abc_...')
```

## Code format

Code runs in a Deno sandbox. Metadata comments control permissions:

```typescript
// @skill name          — identifier
// @description What    — shown to human approver
// @secrets KEY1        — one per line, available via Deno.env.get('KEY1')
// @network host.com    — one per line, allowed outbound hosts
// @timeout 30          — seconds (default 30)
```

Output goes to stdout. Use `console.log()` for text, `JSON.stringify()` for structured data.

## Sessions & scopes

Group related executions with `session_id`. First approval creates a session policy — subsequent calls that fit the policy auto-approve:

```typescript
const session_id = 'my-session'

// Request a scope upfront (human approves once)
await client.scope({
  description: 'GitHub access for my-org',
  constraints: ['Only read repositories', 'No destructive actions'],
  secrets: ['GH_TOKEN'],
  networks: ['api.github.com'],
  session_id,
})

// Now executions auto-approve if they fit the scope
const result = await client.executeAndWait({
  skill_id: 'list-repos',
  skill_code: '...',
  session_id,
})
```

## CLI (for AI agents)

The CLI is designed for agents that use shell exec tools. It blocks until completion, printing approval URLs to stderr and the final result to stdout.

```bash
# Scope + execute in one blocking call (recommended)
npx tsx cli.ts scope-and-execute --scope scope.json --code skill.ts --timeout 300

# Execute only (with existing session)
npx tsx cli.ts execute --code skill.ts --session SESSION_ID

# Poll a pending request
npx tsx cli.ts poll REQUEST_ID

# One-shot status check
npx tsx cli.ts status REQUEST_ID
```

`scope.json`:
```json
{ "description": "GitHub access", "constraints": ["Read only"], "secrets": ["GITHUB_TOKEN"], "networks": ["api.github.com"] }
```

The command will:
1. Print `👉 Approve scope: URL` to stderr — show this to the human
2. Block polling until approved (up to --timeout seconds)
3. Auto-chain to execute after scope approval
4. Print `👉 Approve execution: URL` if code review requires it
5. Print final JSON result to stdout when done

## API

| Method | Description |
|--------|-------------|
| `OAuth3.create(apiKey?, baseUrl?)` | Create client (auto-signup if no key) |
| `client.execute(params)` | Submit code, returns immediately |
| `client.executeAndWait(params)` | Submit + print approval URL + poll |
| `client.poll(requestId, timeoutMs?)` | Long-poll for result |
| `client.scope(params)` | Request a session scope |
| `client.dryRun(params)` | Check if code would auto-approve |
| `client.sessions()` | List active sessions |
| `client.me()` | Tenant info |
| `client.history(limit?)` | Past executions |
| `signup(baseUrl?, name?, email?)` | Get a new API key |

## Version

v0.2.0 — compatible with orchestrator 0.1.x and enclave 0.1.x.
See [VERSIONING.md](VERSIONING.md) for the compatibility convention.
