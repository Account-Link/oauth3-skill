/**
 * Live test: npx tsx test-live.ts
 * Env: ORCHESTRATOR_URL, API_KEY
 */
import { OAuth3, signup } from './index.js'

const url = process.env.ORCHESTRATOR_URL || 'http://localhost:3838'
let key = process.env.API_KEY || ''

if (!key) {
  console.log('No API_KEY — signing up...')
  const { api_key, tenant_id } = await signup(url, 'test-live')
  console.log(`tenant_id: ${tenant_id}\napi_key: ${api_key}`)
  console.log(`\nRe-run: API_KEY=${api_key} npx tsx test-live.ts\n`)
  key = api_key
}

const client = new OAuth3(url, key)
console.log('me:', await client.me())

const code = `// @skill test-live
// @description Hello from live test
// @timeout 5

console.log("hello from TEE at " + new Date().toISOString())`

console.log('\nSubmitting...')
const result = await client.executeAndWait({ skill_id: 'test-live', skill_code: code })
console.log('Result:', JSON.stringify(result, null, 2))
