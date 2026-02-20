/**
 * oauth3-skill v0.3.0
 *
 * Client SDK for OAuth3 execution proxy.
 * Submit TypeScript code to run in a Deno sandbox inside a TEE.
 *
 * Quick start:
 *   const { OAuth3 } = await import('https://raw.githubusercontent.com/Account-Link/oauth3-skill/main/index.ts')
 *   const client = await OAuth3.create()  // signs up automatically, talks directly to enclave
 *   const result = await client.executeAndWait({ skill_id: 'hello', skill_code: 'console.log("hi")' })
 */

export const VERSION = '0.3.0'
export const DEFAULT_ENCLAVE_URL = 'https://tee.oauth3-stage.monerolink.com'
export const DEFAULT_ORCHESTRATOR_URL = 'https://oauth3-stage.monerolink.com'

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

const HOME = typeof Deno !== 'undefined' ? Deno.env.get('HOME') : process.env.HOME
const TOKEN_PATH = `${HOME}/.oauth3/token`
const CONFIG_PATH = `${HOME}/.oauth3/config.json`

interface StoredConfig {
  jwt: string
  tenant_id: string
  enclave_url: string
  orchestrator_url: string
}

async function loadConfig(): Promise<StoredConfig | undefined> {
  try {
    const fs = await import('node:fs')
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
  } catch { return undefined }
}

async function saveConfig(config: StoredConfig): Promise<void> {
  try {
    const fs = await import('node:fs')
    const path = await import('node:path')
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  } catch {}
}

// Legacy: read old ~/.oauth3/key if config doesn't exist
async function loadLegacyKey(): Promise<string | undefined> {
  const env = typeof Deno !== 'undefined' ? Deno.env.get('OAUTH3_API_KEY') : process.env.OAUTH3_API_KEY
  if (env) return env
  try {
    const fs = await import('node:fs')
    return fs.readFileSync(`${HOME}/.oauth3/key`, 'utf-8').trim() || undefined
  } catch { return undefined }
}

export class OAuth3 {
  constructor(public baseUrl: string, public token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  /** Create client. Checks stored config, env, then auto-signs up. */
  static async create(opts?: { token?: string, enclaveUrl?: string, orchestratorUrl?: string }): Promise<OAuth3> {
    const enclaveUrl = opts?.enclaveUrl || process.env.OAUTH3_ENCLAVE_URL || DEFAULT_ENCLAVE_URL
    const orchestratorUrl = opts?.orchestratorUrl || process.env.OAUTH3_ORCHESTRATOR_URL || DEFAULT_ORCHESTRATOR_URL

    // Explicit token
    if (opts?.token) return new OAuth3(enclaveUrl, opts.token)

    // Stored config
    const config = await loadConfig()
    if (config?.jwt) return new OAuth3(config.enclave_url || enclaveUrl, config.jwt)

    // Legacy api_key (talks to enclave with bearer token)
    const legacyKey = await loadLegacyKey()
    if (legacyKey) return new OAuth3(enclaveUrl, legacyKey)

    // Auto-signup via orchestrator
    const { jwt, tenant_id, tee_url } = await signup(orchestratorUrl, 'agent')
    const finalEnclaveUrl = tee_url || enclaveUrl
    if (jwt) {
      await saveConfig({ jwt, tenant_id, enclave_url: finalEnclaveUrl, orchestrator_url: orchestratorUrl })
      return new OAuth3(finalEnclaveUrl, jwt)
    }
    throw new Error('Signup succeeded but no JWT returned — is JWT_SECRET configured on orchestrator?')
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

  async scopeAndExecute(scopeParams: ScopeParams, executeParams: ExecuteParams, timeoutMs = 300_000): Promise<ExecutionResult> {
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
      headers: { 'Authorization': `Bearer ${this.token}`, 'X-OAuth3-SDK-Version': VERSION },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`)
    return res.json()
  }

  private async post(path: string, body: any): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json', 'X-OAuth3-SDK-Version': VERSION },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`)
    return res.json()
  }
}

export async function signup(orchestratorUrl = DEFAULT_ORCHESTRATOR_URL, name?: string, email?: string): Promise<{ tenant_id: string; api_key: string; jwt: string; tee_url: string }> {
  const res = await fetch(`${orchestratorUrl.replace(/\/$/, '')}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email }),
  })
  if (!res.ok) throw new Error(`Signup failed: ${res.status}`)
  return res.json() as any
}
