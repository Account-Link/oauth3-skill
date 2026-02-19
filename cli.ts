#!/usr/bin/env npx tsx
/**
 * CLI for oauth3-skill. Designed for AI agents using shell exec tools.
 *
 * Usage:
 *   npx tsx cli.ts scope-and-execute --scope scope.json --code skill.ts [--timeout 300]
 *   npx tsx cli.ts execute --code skill.ts [--session SESSION_ID] [--timeout 300]
 *   npx tsx cli.ts poll REQUEST_ID [--timeout 300]
 *   npx tsx cli.ts status REQUEST_ID
 *
 * scope.json: { "description": "...", "constraints": [...], "secrets": [...], "networks": [...] }
 *
 * The command blocks until completion, printing approval URLs to stderr
 * and the final JSON result to stdout. Safe to run with long timeouts.
 */

import { OAuth3 } from './index.ts'
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const cmd = args[0]

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const timeout = parseInt(flag('timeout') || '300') * 1000

async function main() {
  const client = await OAuth3.create(flag('key'))

  if (cmd === 'scope-and-execute') {
    const scopeFile = flag('scope')
    const codeFile = flag('code')
    if (!scopeFile || !codeFile) { console.error('Usage: scope-and-execute --scope FILE --code FILE'); process.exit(1) }
    const scope = JSON.parse(readFileSync(scopeFile, 'utf-8'))
    const code = readFileSync(codeFile, 'utf-8')
    const skillId = flag('skill-id') || codeFile.replace(/\.ts$/, '').replace(/.*\//, '')

    // Submit scope
    const scopeRes = await client.scope(scope)
    if (scopeRes.approval_url) console.error(`👉 Approve scope: ${scopeRes.approval_url}`)
    console.error(`⏳ Polling scope ${scopeRes.request_id}...`)
    const approved = await client.poll(scopeRes.request_id, timeout)
    if (approved.status !== 'completed') {
      console.log(JSON.stringify(approved))
      process.exit(1)
    }
    console.error(`✅ Scope approved, session: ${scopeRes.session_id}`)

    // Execute with session
    const execRes = await client.execute({ skill_id: skillId, skill_code: code, session_id: scopeRes.session_id })
    if (execRes.approval_url) console.error(`👉 Approve execution: ${execRes.approval_url}`)
    if (['completed', 'failed', 'denied'].includes(execRes.status)) {
      console.log(JSON.stringify(execRes))
      process.exit(execRes.status === 'completed' ? 0 : 1)
    }
    console.error(`⏳ Polling execution ${execRes.request_id}...`)
    const result = await client.poll(execRes.request_id, timeout)
    console.log(JSON.stringify(result))
    process.exit(result.status === 'completed' ? 0 : 1)

  } else if (cmd === 'execute') {
    const codeFile = flag('code')
    if (!codeFile) { console.error('Usage: execute --code FILE'); process.exit(1) }
    const code = readFileSync(codeFile, 'utf-8')
    const skillId = flag('skill-id') || codeFile.replace(/\.ts$/, '').replace(/.*\//, '')
    const sessionId = flag('session')
    const result = await client.executeAndWait({ skill_id: skillId, skill_code: code, session_id: sessionId }, timeout)
    console.log(JSON.stringify(result))
    process.exit(result.status === 'completed' ? 0 : 1)

  } else if (cmd === 'poll') {
    const reqId = args[1]
    if (!reqId) { console.error('Usage: poll REQUEST_ID'); process.exit(1) }
    const result = await client.poll(reqId, timeout)
    console.log(JSON.stringify(result))
    process.exit(result.status === 'completed' ? 0 : 1)

  } else if (cmd === 'status') {
    const reqId = args[1]
    if (!reqId) { console.error('Usage: status REQUEST_ID'); process.exit(1) }
    const data = await client['get'](`/execute/${reqId}/status`)
    console.log(JSON.stringify(data))

  } else {
    console.error('Commands: scope-and-execute, execute, poll, status')
    process.exit(1)
  }
}

main().catch(e => { console.error(e.message); process.exit(1) })
