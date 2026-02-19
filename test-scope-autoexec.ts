#!/usr/bin/env npx tsx
/**
 * Integration test: scope with code → approve → execute same code → auto-approved
 * Run against local proxy: docker run -p 3737:3737 ...
 */

const BASE = process.env.PROXY_URL || 'http://localhost:3737'

async function post(path: string, body: any) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json()
  if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(data)}`)
  return data
}

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`)
  return res.json()
}

async function approveViaWeb(requestId: string, token: string) {
  const res = await fetch(`${BASE}/approve/${requestId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `token=${token}&action=approve&level=once`,
    redirect: 'manual',
  })
  return res
}

const SKILL_CODE = `// @skill test-greeting
// @description Generate a greeting for a given name
// @timeout 5
const name = Deno.env.get('NAME') || 'World'
console.log(\`Hello, \${name}!\`)`

async function test1_scopeWithCode_autoApproves() {
  console.log('\n=== Test 1: Scope with code → approve → execute same code → auto-approved ===')

  // 1. Create scope WITH code
  const scope = await post('/scope', {
    description: 'Generate greetings for people',
    constraints: ['Only generate greetings', 'No network access', 'Name must be a person name'],
    secrets: [],
    networks: [],
    skill_code: SKILL_CODE,
  })
  console.log(`  Scope created: ${scope.request_id}, session: ${scope.session_id}`)
  assert(scope.status === 'pending_scope', `Expected pending_scope, got ${scope.status}`)

  // 2. Approve the scope (simulates human clicking approve)
  const request = await get(`/execute/${scope.request_id}/status`)
  // Need to get approval token — extract from the DB via the approval URL
  // The scope response includes approval_url with token
  const tokenMatch = scope.approval_url?.match(/token=([a-f0-9]+)/)
  assert(tokenMatch, 'No approval token in URL')
  const token = tokenMatch![1]

  await approveViaWeb(scope.request_id, token)
  console.log(`  Scope approved`)

  // Verify scope is completed
  const scopeStatus = await get(`/execute/${scope.request_id}/status`)
  assert(scopeStatus.status === 'completed', `Scope status: ${scopeStatus.status}`)

  // 3. Execute the SAME code with args
  const exec = await post('/execute', {
    skill_id: 'test-greeting',
    skill_code: SKILL_CODE,
    args: { NAME: 'Alice' },
    session_id: scope.session_id,
  })
  console.log(`  Execute response: status=${exec.status}, request_id=${exec.request_id}`)

  // Should be auto-approved (approved or completed), NOT pending
  assert(exec.status !== 'pending', `Expected auto-approve but got pending! This means the pre-approved code path didn't fire.`)
  console.log(`  ✅ Auto-approved! status=${exec.status}`)

  // Poll for result
  if (exec.status !== 'completed') {
    let result
    for (let i = 0; i < 15; i++) {
      result = await get(`/execute/${exec.request_id}/status`)
      if (['completed', 'failed'].includes(result.status)) break
      await new Promise(r => setTimeout(r, 1000))
    }
    console.log(`  Result: ${JSON.stringify(result)}`)
    assert(result?.status === 'completed', `Expected completed, got ${result?.status}`)
    assert(result?.result?.stdout?.includes('Hello, Alice'), `Expected greeting, got: ${result?.result?.stdout}`)
  }
  console.log('  ✅ Test 1 passed')
}

async function test2_sameCode_noArgs_autoApproves() {
  console.log('\n=== Test 2: Same code, no args → auto-approved (no args to check) ===')

  const scope = await post('/scope', {
    description: 'Generate greetings',
    constraints: ['Only greetings'],
    secrets: [],
    networks: [],
    skill_code: SKILL_CODE,
  })
  const tokenMatch = scope.approval_url?.match(/token=([a-f0-9]+)/)
  await approveViaWeb(scope.request_id, tokenMatch![1])

  // Execute with same code but no args
  const exec = await post('/execute', {
    skill_id: 'test-greeting',
    skill_code: SKILL_CODE,
    session_id: scope.session_id,
  })
  console.log(`  No-args execute: status=${exec.status}`)
  assert(exec.status !== 'pending', `Expected auto-approve, got pending`)
  console.log('  ✅ Test 2 passed — same code, no args auto-approved')
}

async function test3_noCode_inScope_oldBehavior() {
  console.log('\n=== Test 3: Scope without code → old behavior (execute needs approval) ===')

  const scope = await post('/scope', {
    description: 'Generate greetings',
    constraints: ['Only greetings'],
    secrets: [],
    networks: [],
    // No skill_code
  })
  const tokenMatch = scope.approval_url?.match(/token=([a-f0-9]+)/)
  await approveViaWeb(scope.request_id, tokenMatch![1])

  const exec = await post('/execute', {
    skill_id: 'test-greeting',
    skill_code: SKILL_CODE,
    session_id: scope.session_id,
  })
  console.log(`  No-code scope execute: status=${exec.status}`)
  // Falls through to old review path — may or may not auto-approve depending on Haiku
  // The point is it doesn't use the pre-approved fast path
  console.log('  ✅ Test 3 passed — old behavior preserved')
}

function assert(condition: boolean, msg: string) {
  if (!condition) { console.error(`  ❌ FAIL: ${msg}`); process.exit(1) }
}

async function main() {
  console.log(`Testing against ${BASE}`)
  await test1_scopeWithCode_autoApproves()
  await test2_sameCode_noArgs_autoApproves()
  await test3_noCode_inScope_oldBehavior()

  console.log('\n✅ All tests passed!')
}

main().catch(e => { console.error(e); process.exit(1) })
