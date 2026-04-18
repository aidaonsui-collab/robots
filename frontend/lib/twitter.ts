/**
 * Twitter/X API client for Odyssey agents
 * Uses Twitter API v2 with OAuth 1.0a HMAC-SHA1 signing
 * No external dependencies — uses Node.js built-in crypto
 */

import crypto from 'crypto'

export interface TwitterConfig {
  apiKey: string           // Consumer Key (aka API Key)
  apiSecret: string        // Consumer Secret (aka API Secret)
  accessToken: string      // User Access Token
  accessTokenSecret: string // User Access Token Secret
  enabled: boolean         // Auto-tweet enabled
  intervalMinutes: number  // Auto-tweet interval (e.g. 60 = every hour)
  style?: string           // Tweet style instructions (e.g. "shitpost alpha calls with emojis")
}

interface OAuthParams {
  oauth_consumer_key: string
  oauth_nonce: string
  oauth_signature_method: string
  oauth_timestamp: string
  oauth_token: string
  oauth_version: string
  oauth_signature?: string
}

// ─── OAuth 1.0a Signing ────────────────────────────────────────────────────

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
}

function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex')
}

function buildSignatureBaseString(
  method: string,
  url: string,
  params: Record<string, string>
): string {
  // Sort params alphabetically by key
  const sorted = Object.keys(params)
    .sort()
    .map(k => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&')

  return `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(sorted)}`
}

function signRequest(
  method: string,
  url: string,
  oauthParams: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string,
  bodyParams?: Record<string, string>
): string {
  const allParams = { ...oauthParams, ...(bodyParams || {}) }
  const baseString = buildSignatureBaseString(method, url, allParams)
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`

  return crypto
    .createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64')
}

function buildAuthHeader(params: Record<string, string>): string {
  const parts = Object.keys(params)
    .sort()
    .map(k => `${percentEncode(k)}="${percentEncode(params[k])}"`)
    .join(', ')

  return `OAuth ${parts}`
}

// ─── API Methods ──────────────────────────────────────────────────────────

/**
 * Post a tweet on behalf of the agent
 */
export async function postTweet(
  config: TwitterConfig,
  text: string
): Promise<{ success: boolean; tweetId?: string; tweetUrl?: string; error?: string }> {
  if (!config.apiKey || !config.accessToken) {
    return { success: false, error: 'Twitter API keys not configured' }
  }

  // Twitter API v2 tweet endpoint
  const url = 'https://api.twitter.com/2/tweets'
  const method = 'POST'

  // Trim tweet to 280 chars
  const tweetText = text.length > 280 ? text.slice(0, 277) + '...' : text

  // Build OAuth params
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: config.apiKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: config.accessToken,
    oauth_version: '1.0',
  }

  // Sign the request (POST body is JSON, not form-encoded, so no body params in signature)
  const signature = signRequest(method, url, oauthParams, config.apiSecret, config.accessTokenSecret)
  oauthParams.oauth_signature = signature

  const authHeader = buildAuthHeader(oauthParams)

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: tweetText }),
      signal: AbortSignal.timeout(10000),
    })

    const data = await res.json() as any

    if (!res.ok) {
      const errMsg = data?.detail || data?.errors?.[0]?.message || `HTTP ${res.status}`
      console.error('[twitter] Post failed:', errMsg)
      return { success: false, error: errMsg }
    }

    const tweetId = data.data?.id
    // Get username from a separate call or just return the tweet URL pattern
    return {
      success: true,
      tweetId,
      tweetUrl: tweetId ? `https://x.com/i/status/${tweetId}` : undefined,
    }
  } catch (err: any) {
    console.error('[twitter] Post error:', err)
    return { success: false, error: err.message }
  }
}

/**
 * Get recent tweets from the authenticated user's timeline
 */
export async function getMyTweets(
  config: TwitterConfig,
  maxResults = 10
): Promise<{ success: boolean; tweets?: Array<{ id: string; text: string; created_at: string }>; error?: string }> {
  if (!config.apiKey || !config.accessToken) {
    return { success: false, error: 'Twitter API keys not configured' }
  }

  // First get the authenticated user's ID
  const meUrl = 'https://api.twitter.com/2/users/me'
  const meOauth: Record<string, string> = {
    oauth_consumer_key: config.apiKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: config.accessToken,
    oauth_version: '1.0',
  }
  meOauth.oauth_signature = signRequest('GET', meUrl, meOauth, config.apiSecret, config.accessTokenSecret)

  try {
    const meRes = await fetch(meUrl, {
      headers: { 'Authorization': buildAuthHeader(meOauth) },
      signal: AbortSignal.timeout(8000),
    })
    if (!meRes.ok) return { success: false, error: 'Failed to get user info' }
    const meData = await meRes.json() as any
    const userId = meData.data?.id
    if (!userId) return { success: false, error: 'Could not get user ID' }

    // Now get recent tweets
    const tweetsUrl = `https://api.twitter.com/2/users/${userId}/tweets`
    const queryParams: Record<string, string> = {
      'max_results': String(Math.min(maxResults, 100)),
      'tweet.fields': 'created_at,public_metrics',
    }

    const tweetsOauth: Record<string, string> = {
      oauth_consumer_key: config.apiKey,
      oauth_nonce: generateNonce(),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_token: config.accessToken,
      oauth_version: '1.0',
    }

    // Include query params in signature
    const fullUrl = `${tweetsUrl}?${Object.entries(queryParams).map(([k, v]) => `${k}=${v}`).join('&')}`
    tweetsOauth.oauth_signature = signRequest(
      'GET', tweetsUrl, { ...tweetsOauth, ...queryParams },
      config.apiSecret, config.accessTokenSecret
    )

    const tweetsRes = await fetch(fullUrl, {
      headers: { 'Authorization': buildAuthHeader(tweetsOauth) },
      signal: AbortSignal.timeout(8000),
    })

    if (!tweetsRes.ok) {
      const err = await tweetsRes.text()
      return { success: false, error: `Failed to get tweets: ${err.slice(0, 200)}` }
    }

    const tweetsData = await tweetsRes.json() as any
    const tweets = (tweetsData.data || []).map((t: any) => ({
      id: t.id,
      text: t.text,
      created_at: t.created_at,
    }))

    return { success: true, tweets }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/**
 * Verify Twitter credentials are valid
 */
export async function verifyCredentials(
  config: TwitterConfig
): Promise<{ valid: boolean; username?: string; error?: string }> {
  const url = 'https://api.twitter.com/2/users/me'
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: config.apiKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: config.accessToken,
    oauth_version: '1.0',
  }
  oauthParams.oauth_signature = signRequest('GET', url, oauthParams, config.apiSecret, config.accessTokenSecret)

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': buildAuthHeader(oauthParams) },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      return { valid: false, error: `Twitter API returned ${res.status}` }
    }
    const data = await res.json() as any
    return { valid: true, username: data.data?.username }
  } catch (err: any) {
    return { valid: false, error: err.message }
  }
}
