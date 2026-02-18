/**
 * oauth3-skill v0.1.0
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
 */

export const VERSION = '0.1.0'
export const DEFAULT_URL = 'https://orchestrator-oauth3-proxy.vercel.app'

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

export class OAuth3 {
  constructor(public baseUrl: string, public apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  /** Create a client, signing up for a key if none provided */
  static async create(apiKey?: string, baseUrl = DEFAULT_URL): Promise<OAuth3> {
    if (apiKey) return new OAuth3(baseUrl, apiKey)
    const { api_key } = await signup(baseUrl, 'agent')
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

  async executeAndWait(params: ExecuteParams, timeoutMs = 300_000): Promise<ExecutionResult> {
    const data = await this.post('/execute', params)
    if (['completed', 'failed', 'denied'].includes(data.status)) return data
    if (data.approval_url) console.log(`\n👉 Approve: ${data.approval_url}\n`)
    return this.poll(data.request_id, timeoutMs)
  }

  async poll(requestId: string, timeoutMs = 300_000): Promise<ExecutionResult> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const data = await this.get(`/execute/${requestId}/status?wait=true`)
      if (['completed', 'failed', 'denied'].includes(data.status)) return data
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

/** Sign up for a new API key */
export async function signup(baseUrl = DEFAULT_URL, name?: string, email?: string): Promise<{ tenant_id: string; api_key: string }> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email }),
  })
  if (!res.ok) throw new Error(`Signup failed: ${res.status}`)
  return res.json() as any
}
