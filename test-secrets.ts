/** Test: scope with secrets. npx tsx test-secrets.ts */
import { OAuth3 } from './index.js'

const client = await OAuth3.create(process.env.API_KEY)
console.log('me:', await client.me())

console.log('\nSubmitting scope + execute...')
const result = await client.scopeAndExecute(
  {
    description: 'Test secret access',
    constraints: ['Only print the secret name, not the value'],
    secrets: ['TEST_SECRET'],
    networks: [],
  },
  {
    skill_id: 'test-secret',
    skill_code: `// @skill test-secret
// @description Test that secrets are available
// @secrets TEST_SECRET
// @timeout 5
const val = Deno.env.get("TEST_SECRET")
console.log("TEST_SECRET is " + (val ? "set (" + val.length + " chars)" : "NOT SET"))`,
  }
)
console.log('Result:', JSON.stringify(result, null, 2))
