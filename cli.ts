#!/usr/bin/env npx tsx
/**
 * CLI for oauth3-skill. Designed for AI agents using shell exec tools.
 *
 * Two modes:
 *
 * FOREGROUND (blocks until done — use if your exec tool has long/no timeout):
 *   npx tsx cli.ts scope-and-execute --scope scope.json --code skill.ts [--timeout 300]
 *   npx tsx cli.ts execute --code skill.ts [--session ID] [--timeout 300]
 *   npx tsx cli.ts poll REQUEST_ID [--timeout 300]
 *   npx tsx cli.ts status REQUEST_ID
 *
 * BACKGROUND (for agents with short exec timeouts):
 *   npx tsx cli.ts scope-and-execute --bg --scope scope.json --code skill.ts
 *   → prints approval URLs + job file path, exits immediately
 *   → background process polls until completion, writes result to job file
 *
 *   npx tsx cli.ts result JOB_FILE
 *   → reads job file, prints current status/result. Run after human approves.
 *
 * scope.json: { "description": "...", "constraints": [...], "secrets": [...], "networks": [...] }
 */

import { OAuth3 } from './index.ts'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

const args = process.argv.slice(2)
const cmd = args[0]
const hasFlag = (name: string) => args.includes(`--${name}`)

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const timeout = parseInt(flag('timeout') || '300') * 1000
const HOME = process.env.HOME || '/tmp'
const JOBS_DIR = `${HOME}/.oauth3/jobs`

function writeJob(jobFile: string, data: any) {
  mkdirSync(dirname(jobFile), { recursive: true })
  writeFileSync(jobFile, JSON.stringify(data, null, 2) + '\n')
}

// --- Background launcher ---
if (hasFlag('bg') && cmd !== '__bg-worker') {
  // Re-spawn ourselves as a detached background process
  const jobId = randomBytes(4).toString('hex')
  const jobFile = `${JOBS_DIR}/${jobId}.json`
  writeJob(jobFile, { status: 'starting', job_id: jobId, created: new Date().toISOString() })

  const worker = spawn(process.execPath, [...process.execArgv, resolve(import.meta.filename!), '__bg-worker', '--job', jobFile, ...args.filter(a => a !== '--bg')], {
    detached: true, stdio: 'ignore',
  })
  worker.unref()

  // Quick: submit the scope/execute to get approval URLs before exiting
  const client = await OAuth3.create({ token: flag('key'), enclaveUrl: flag('enclave-url'), orchestratorUrl: flag('orchestrator-url') })

  if (cmd === 'scope-and-execute') {
    const scopeFile = flag('scope')
    const codeFile = flag('code')
    if (!scopeFile || !codeFile) { console.error('Usage: scope-and-execute --bg --scope FILE --code FILE'); process.exit(1) }
    const scope = JSON.parse(readFileSync(scopeFile, 'utf-8'))
    const code = readFileSync(codeFile, 'utf-8')
    const scopeRes = await client.scope({ ...scope, skill_code: code })

    const info = {
      status: 'polling_scope', job_id: jobId, job_file: jobFile,
      scope_request_id: scopeRes.request_id, session_id: scopeRes.session_id,
      scope_approval_url: scopeRes.approval_url,
      created: new Date().toISOString(),
    }
    writeJob(jobFile, info)
    // Print for agent to capture
    if (scopeRes.approval_url) console.log(`👉 Approve scope: ${scopeRes.approval_url}`)
    console.log(`📁 Job file: ${jobFile}`)
    console.log(`Run \`npx tsx cli.ts result ${jobFile}\` after approving to get the result.`)
    process.exit(0)

  } else if (cmd === 'execute') {
    const codeFile = flag('code')
    if (!codeFile) { console.error('Usage: execute --bg --code FILE'); process.exit(1) }
    const code = readFileSync(codeFile, 'utf-8')
    const skillId = flag('skill-id') || codeFile.replace(/\.ts$/, '').replace(/.*\//, '')
    const sessionId = flag('session')
    const execRes = await client.execute({ skill_id: skillId, skill_code: code, session_id: sessionId })

    const info = {
      status: execRes.status === 'completed' ? 'completed' : 'polling_exec',
      job_id: jobId, job_file: jobFile,
      exec_request_id: execRes.request_id,
      exec_approval_url: execRes.approval_url,
      result: execRes.status === 'completed' ? execRes : undefined,
      created: new Date().toISOString(),
    }
    writeJob(jobFile, info)
    if (execRes.approval_url) console.log(`👉 Approve: ${execRes.approval_url}`)
    if (execRes.status === 'completed') console.log(JSON.stringify(execRes))
    console.log(`📁 Job file: ${jobFile}`)
    process.exit(execRes.status === 'completed' ? 0 : 0)
  }
  process.exit(0)
}

// --- Background worker (detached process) ---
if (cmd === '__bg-worker') {
  const jobFile = flag('job')!
  const innerCmd = args.find(a => a === 'scope-and-execute' || a === 'execute')!

  try {
    const client = await OAuth3.create({ token: flag('key'), enclaveUrl: flag('enclave-url'), orchestratorUrl: flag('orchestrator-url') })
    const job = JSON.parse(readFileSync(jobFile, 'utf-8'))

    if (innerCmd === 'scope-and-execute') {
      // Poll scope
      if (job.scope_request_id) {
        const approved = await client.poll(job.scope_request_id, timeout)
        if (approved.status !== 'completed') {
          writeJob(jobFile, { ...job, status: 'scope_failed', result: approved })
          process.exit(1)
        }
        writeJob(jobFile, { ...job, status: 'scope_approved' })
      }

      // Execute
      const codeFile = flag('code')!
      const code = readFileSync(codeFile, 'utf-8')
      const skillId = flag('skill-id') || codeFile.replace(/\.ts$/, '').replace(/.*\//, '')
      const execRes = await client.execute({ skill_id: skillId, skill_code: code, session_id: job.session_id })

      writeJob(jobFile, {
        ...job, status: 'polling_exec',
        exec_request_id: execRes.request_id,
        exec_approval_url: execRes.approval_url,
      })

      if (['completed', 'failed', 'denied'].includes(execRes.status)) {
        writeJob(jobFile, { ...job, status: execRes.status, result: execRes })
        process.exit(0)
      }

      const result = await client.poll(execRes.request_id, timeout)
      writeJob(jobFile, { ...job, status: result.status, exec_request_id: execRes.request_id, result })
      process.exit(0)

    } else if (innerCmd === 'execute') {
      if (!job.exec_request_id) process.exit(1)
      const result = await client.poll(job.exec_request_id, timeout)
      writeJob(jobFile, { ...job, status: result.status, result })
      process.exit(0)
    }
  } catch (e: any) {
    const job = JSON.parse(readFileSync(jobFile, 'utf-8').toString())
    writeJob(jobFile, { ...job, status: 'error', error: e.message })
    process.exit(1)
  }
  process.exit(0)
}

// --- Foreground commands ---
async function main() {
  const client = await OAuth3.create({ token: flag('key'), enclaveUrl: flag('enclave-url'), orchestratorUrl: flag('orchestrator-url') })

  if (cmd === 'result') {
    const jobFile = args[1]
    if (!jobFile) { console.error('Usage: result JOB_FILE'); process.exit(1) }
    const job = JSON.parse(readFileSync(jobFile, 'utf-8'))
    console.log(JSON.stringify(job, null, 2))
    process.exit(job.status === 'completed' ? 0 : 1)

  } else if (cmd === 'scope-and-execute') {
    const scopeFile = flag('scope')
    const codeFile = flag('code')
    if (!scopeFile || !codeFile) { console.error('Usage: scope-and-execute --scope FILE --code FILE'); process.exit(1) }
    const scope = JSON.parse(readFileSync(scopeFile, 'utf-8'))
    const code = readFileSync(codeFile, 'utf-8')
    const skillId = flag('skill-id') || codeFile.replace(/\.ts$/, '').replace(/.*\//, '')

    const scopeRes = await client.scope({ ...scope, skill_code: code })
    if (scopeRes.approval_url) console.error(`👉 Approve scope: ${scopeRes.approval_url}`)
    console.error(`⏳ Polling scope ${scopeRes.request_id}...`)
    const approved = await client.poll(scopeRes.request_id, timeout)
    if (approved.status !== 'completed') {
      console.log(JSON.stringify(approved))
      process.exit(1)
    }
    console.error(`✅ Scope approved, session: ${scopeRes.session_id}`)

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
    console.error(`Commands: scope-and-execute, execute, poll, status, result
Add --bg to scope-and-execute or execute for background mode.`)
    process.exit(1)
  }
}

main().catch(e => { console.error(e.message); process.exit(1) })
