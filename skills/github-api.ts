// @skill github-api
// @description Make a GitHub API request
// @secrets GITHUB_TOKEN
// @network api.github.com

const token = Deno.env.get('GITHUB_TOKEN')!
const method = Deno.env.get('METHOD') || 'GET'
const path = Deno.env.get('API_PATH')!
const body = Deno.env.get('BODY')

const res = await fetch(`https://api.github.com/${path}`, {
  method,
  headers: {
    'Authorization': `Bearer ${token}`,
    'Accept': Deno.env.get('ACCEPT') || 'application/vnd.github+json',
    'User-Agent': 'oauth3-gateway',
  },
  body: body || undefined,
})

const responseBody = await res.text()
console.log(JSON.stringify({
  status: res.status,
  headers: Object.fromEntries(res.headers.entries()),
  body: responseBody,
}))
