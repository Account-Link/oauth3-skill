/** Live test: npx tsx test-live.ts */
import { OAuth3 } from './index.js'

const client = await OAuth3.create(process.env.API_KEY)
console.log('me:', await client.me())

console.log('\nSubmitting...')
const result = await client.executeAndWait({
  skill_id: 'test-live',
  skill_code: `// @skill test-live
// @description Hello from live test
// @timeout 5
console.log("hello from TEE at " + new Date().toISOString())`,
})
console.log('Result:', JSON.stringify(result, null, 2))
