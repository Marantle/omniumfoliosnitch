const OAUTH_URL = 'https://www.warcraftlogs.com/oauth/token'
const API_URL = 'https://www.warcraftlogs.com/api/v2/client'

let token: string | null = null
let tokenExpiry = 0

async function getToken(): Promise<string> {
  if (token && Date.now() < tokenExpiry) return token

  const id = process.env.WCL_CLIENT_ID
  const secret = process.env.WCL_CLIENT_SECRET
  if (!id || !secret) {
    throw new Error('WCL_CLIENT_ID and WCL_CLIENT_SECRET must be set, see .env.example')
  }

  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) {
    throw new Error(`WCL token request failed: ${res.status} ${await res.text()}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }
  token = data.access_token
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
  return token
}

export async function wclQuery<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const accessToken = await getToken()
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    })
    // the points budget refills over the hour, so wait it out
    if (res.status === 429 && attempt < 30) {
      const wait = Number(res.headers.get('retry-after')) || 60
      console.log(`WCL rate limit hit, waiting ${wait}s`)
      await new Promise(r => setTimeout(r, wait * 1000))
      continue
    }
    if (!res.ok) {
      throw new Error(`WCL request failed: ${res.status} ${await res.text()}`)
    }
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] }
    if (body.errors?.length) {
      throw new Error(`WCL query error: ${body.errors[0].message}`)
    }
    if (!body.data) {
      throw new Error('WCL query returned no data')
    }
    return body.data
  }
}
