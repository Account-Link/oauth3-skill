/**
 * oauth3-skill v0.2.0
 *
 * Client SDK for OAuth3 execution proxy.
 * Submit TypeScript code to run in a Deno sandbox inside a TEE.
 *
 * Compatibility: orchestrator >= 0.1.x, enclave >= 0.1.x
 *
 * Quick start:
 *   const { OAuth3 } = await import('https://raw.githubusercontent.com/Account-Link/oauth3-skill/main/index.ts')
 *   const client = await OAuth3.create()  // signs up automatically
 *   const result = await client.executeAndWait({ skill_id: 'hello', skill_code: 'console.log("hi")' })
 *
 * Scope flow (pre-approve a session for auto-execution):
 *   const result = await client.scopeAndExecute(
 *     { description: 'Read GitHub issues', constraints: ['Only GET requests'], secrets: ['GITHUB_TOKEN'], networks: ['api.github.com'] },
 *     { skill_id: 'list-issues', skill_code: '...' }
 *   )
 */

export const VERSION = '0.2.0'
export const DEFAULT_URL = 'https://oauth3-for-agents.vercel.app'

export interface ExecuteParams {
  skill_id: string
  skill_code?: string
  skill_url?: string
  secrets?: string[]
  args?: Record<string, any>
  session_id?: string
  dry_run?: boolean
}

export interface ScopeParams {
  description: string
  constraints: string[]
  secrets: string[]
  networks: string[]
  session_id?: string
  skill_code?: string
}

export interface ExecutionResult {
  request_id: string
  tracking_id?: string
  status: string
  result?: { stdout: string; stderr: string; exitCode: number; duration: number }
  error?: string
  approval_url?: string
  status_url?: string
  session_id?: string
  policy_violations?: string[]
}

const KEY_PATH = `${typeof Deno !== 'undefined' ? Deno.env.get('HOME') : process.env.HOME}/.oauth3/key`

async function loadKey(): Promise<string | undefined> {
  const env = typeof Deno !== 'undefined' ? Deno.env.get('OAUTH3_API_KEY') : process.env.OAUTH3_API_KEY
  if (env) return env
  try {
    const fs = await import('node:fs')
    return fs.readFileSync(KEY_PATH, 'utf-8').trim() || undefined
  } catch { return undefined }
}

async function saveKey(key: string): Promise<void> {
  try {
    const fs = await import('node:fs')
    const path = await import('node:path')
    fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true })
    fs.writeFileSync(KEY_PATH, key + '\n', { mode: 0o600 })
  } catch {}
}

export class OAuth3 {
  constructor(public baseUrl: string, public apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  /** Create client. Checks $OAUTH3_API_KEY, then ~/.oauth3/key, then auto-signs up and saves. */
  static async create(apiKey?: string, baseUrl = DEFAULT_URL): Promise<OAuth3> {
    const key = apiKey || await loadKey()
    if (key) return new OAuth3(baseUrl, key)
    const { api_key } = await signup(baseUrl, 'agent')
    await saveKey(api_key)
    return new OAuth3(baseUrl, api_key)
  }

  async execute(params: ExecuteParams): Promise<ExecutionResult> {
    const data = await this.post('/execute', params)
    if (data.status === 'pending' || data.status === 'pending_scope') return data
    if (['approved', 'executing'].includes(data.status)) return this.poll(data.request_id)
    return data
  }

  async scope(params: ScopeParams): Promise<ExecutionResult> {
    return this.post('/scope', params)
  }

  async dryRun(params: ExecuteParams): Promise<any> {
    return this.post('/execute', { ...params, dry_run: true })
  }

  /** Submit code and wait for result. Prints approval URL if human approval needed. */
  async executeAndWait(params: ExecuteParams, timeoutMs = 300_000): Promise<ExecutionResult> {
    const data = await this.post('/execute', params)
    if (['completed', 'failed', 'denied'].includes(data.status)) return data
    if (data.approval_url) console.log(`\n👉 Approve: ${data.approval_url}\n`)
    return this.poll(data.request_id, timeoutMs)
  }

  /** Request a scope (session), wait for approval, then execute with that session.
   *  Automatically includes skill_code in the scope request so human approves code+scope together. */
  async scopeAndExecute(scopeParams: ScopeParams, executeParams: ExecuteParams, timeoutMs = 300_000): Promise<ExecutionResult> {
    // Include code in scope request so human reviews code+scope as one package
    const scopeWithCode = executeParams.skill_code ? { ...scopeParams, skill_code: executeParams.skill_code } : scopeParams
    const scope = await this.scope(scopeWithCode)
    if (scope.approval_url) console.log(`\n👉 Approve scope: ${scope.approval_url}\n`)
    const approved = await this.poll(scope.request_id, timeoutMs)
    if (approved.status !== 'completed') return approved
    return this.executeAndWait({ ...executeParams, session_id: scope.session_id }, timeoutMs)
  }

  async poll(requestId: string, timeoutMs = 300_000): Promise<ExecutionResult> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const data = await this.get(`/execute/${requestId}/status?wait=true`)
      if (['completed', 'failed', 'denied'].includes(data.status)) return data
      if (data.status === 'awaiting_secrets') return data
      await new Promise(r => setTimeout(r, 2000))
    }
    return { request_id: requestId, status: 'timeout', error: `No result after ${timeoutMs}ms` }
  }

  async sessions(): Promise<any> { return this.get('/sessions') }
  async me(): Promise<any> { return this.get('/me') }
  async history(limit = 50): Promise<any> { return this.get(`/history?limit=${limit}`) }

  private async get(path: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'X-OAuth3-SDK-Version': VERSION },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`)
    return res.json()
  }

  private async post(path: string, body: any): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', 'X-OAuth3-SDK-Version': VERSION },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`)
    return res.json()
  }
}

export async function signup(baseUrl = DEFAULT_URL, name?: string, email?: string): Promise<{ tenant_id: string; api_key: string }> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email }),
  })
  if (!res.ok) throw new Error(`Signup failed: ${res.status}`)
  return res.json() as any
}
