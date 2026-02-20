#!/usr/bin/env npx tsx
/**
 * GitHub API Gateway — local HTTP server that proxies gh CLI requests through OAuth3 TEE.
 *
 * Usage:
 *   npx tsx gateway.ts [--scope skills/github-api-scope.json] [--port 9999] [--key API_KEY] [--url http://localhost:3838]
 *
 * Then:
 *   export GH_HOST=localhost:9999 GH_TOKEN=dummy
 *   gh repo view octocat/Hello-World
 */

import { OAuth3 } from './index.ts'
import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }

const port = parseInt(flag('port') || '9999')
const baseUrl = flag('url') || process.env.OAUTH3_URL
const scopeFile = flag('scope')
const skillPath = resolve(import.meta.dirname!, 'skills/github-api.ts')
const skillCode = readFileSync(skillPath, 'utf-8')

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString()
}

async function main() {
  const client = await OAuth3.create(flag('key'), baseUrl || undefined)
  let sessionId: string | undefined

  // If scope file provided, create scope+session upfront
  if (scopeFile) {
    const scope = JSON.parse(readFileSync(scopeFile, 'utf-8'))
    const scopeRes = await client.scope({ ...scope, skill_code: skillCode })
    if (scopeRes.approval_url) console.error(`👉 Approve scope: ${scopeRes.approval_url}`)
    console.error(`⏳ Waiting for scope approval...`)
    const approved = await client.poll(scopeRes.request_id)
    if (approved.status !== 'completed') {
      console.error(`Scope not approved: ${approved.status}`)
      process.exit(1)
    }
    sessionId = scopeRes.session_id
    console.error(`✅ Scope approved, session: ${sessionId}`)
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Strip leading slash for GitHub API path
    const path = (req.url || '/').replace(/^\//, '')
    const method = req.method || 'GET'
    const body = await readBody(req)
    const accept = req.headers['accept'] as string | undefined

    console.error(`→ ${method} /${path}`)

    try {
      const execArgs: Record<string, string> = { METHOD: method, API_PATH: path }
      if (body) execArgs.BODY = body
      if (accept) execArgs.ACCEPT = accept

      const result = await client.executeAndWait({
        skill_id: 'github-api',
        skill_code: skillCode,
        session_id: sessionId,
        args: execArgs,
      })

      if (result.status !== 'completed' || !result.result) {
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'execution_failed', detail: result }))
        return
      }

      const upstream = JSON.parse(result.result.stdout)
      // Forward upstream headers, skip transfer-encoding
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      for (const [k, v] of Object.entries(upstream.headers as Record<string, string>)) {
        if (!['transfer-encoding', 'content-encoding', 'content-length'].includes(k.toLowerCase())) {
          headers[k] = v
        }
      }
      res.writeHead(upstream.status, headers)
      res.end(upstream.body)
    } catch (e: any) {
      console.error(`  ✗ ${e.message}`)
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
  })

  server.listen(port, () => {
    console.log(`\nGateway listening on http://localhost:${port}`)
    console.log(`\nexport GH_HOST=localhost:${port} GH_TOKEN=dummy GH_PROTOCOL=http\n`)
  })
}

main().catch(e => { console.error(e.message); process.exit(1) })
