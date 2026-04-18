import { NextRequest, NextResponse } from 'next/server'
import { getAgent, getAgentMessages } from '@/lib/agents-db'

export const dynamic = 'force-dynamic'

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

async function redis(cmd: string[]): Promise<any> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return { error: 'No Upstash credentials' }
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmd),
    cache: 'no-store',
  })
  if (!res.ok) return { error: `Redis ${res.status}` }
  return res.json()
}

/**
 * GET /api/agents/:id/debug
 * Diagnostic endpoint — shows Redis state for this agent.
 * Helps debug worker communication issues.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // 1. Agent in Vercel KV
    const agent = await getAgent(id)
    const messages = await getAgentMessages(id)

    // 2. Redis state (Upstash — shared with Railway worker)
    const [config, status, queueLen, response, memoryLen] = await Promise.all([
      redis(['GET', `config:agent:${id}`]),
      redis(['GET', `status:agent:${id}`]),
      redis(['LLEN', `queue:agent:${id}`]),
      redis(['GET', `response:agent:${id}`]),
      redis(['LLEN', `memory:agent:${id}`]),
    ])

    // 3. Peek at queue (without consuming)
    const queuePeek = await redis(['LRANGE', `queue:agent:${id}`, '0', '4'])

    // 3b. Scan ALL Redis keys containing this agent ID to find worker's actual key patterns
    const allKeys = await redis(['KEYS', `*${id}*`])
    const agentKeys = (allKeys?.result || []) as string[]

    // 3c. Also check common alternative response key patterns the worker might use
    const altPatterns = [
      `reply:agent:${id}`,
      `output:agent:${id}`,
      `result:agent:${id}`,
      `agent:${id}:response`,
      `agent:${id}:reply`,
      `agent:${id}:output`,
      `messages:agent:${id}`,
      `agent:${id}:messages`,
    ]
    const altResults: Record<string, any> = {}
    for (const key of altPatterns) {
      if (!agentKeys.includes(key)) {
        const val = await redis(['GET', key])
        if (val?.result) altResults[key] = val.result
        // Also try LIST
        const lval = await redis(['LLEN', key])
        if (lval?.result && lval.result > 0) altResults[`${key} (list, len)`] = lval.result
      }
    }

    // 3d. For each discovered key, get its type and a peek at its value
    const keyDetails: Record<string, any> = {}
    for (const key of agentKeys) {
      const type = await redis(['TYPE', key])
      const t = type?.result || 'unknown'
      if (t === 'string') {
        const val = await redis(['GET', key])
        try {
          const parsed = JSON.parse(val?.result || '""')
          keyDetails[key] = { type: t, value: typeof parsed === 'object' ? parsed : val?.result?.slice?.(0, 200) }
        } catch {
          keyDetails[key] = { type: t, value: val?.result?.slice?.(0, 200) }
        }
      } else if (t === 'list') {
        const len = await redis(['LLEN', key])
        const peek = await redis(['LRANGE', key, '0', '2'])
        keyDetails[key] = { type: t, length: len?.result, peek: (peek?.result || []).map((v: string) => { try { return JSON.parse(v) } catch { return v } }) }
      } else if (t === 'set') {
        const members = await redis(['SMEMBERS', key])
        keyDetails[key] = { type: t, members: members?.result }
      } else {
        keyDetails[key] = { type: t }
      }
    }

    // 4. Check what the worker would see from /api/agents
    let parsedConfig = null
    try { parsedConfig = config?.result ? JSON.parse(config.result) : null } catch {}

    let parsedStatus = null
    try { parsedStatus = status?.result ? JSON.parse(status.result) : null } catch {}

    let parsedResponse = null
    try { parsedResponse = response?.result ? JSON.parse(response.result) : null } catch {}

    const queueItems = (queuePeek?.result || []).map((item: string) => {
      try { return JSON.parse(item) } catch { return item }
    })

    return NextResponse.json({
      agentId: id,
      timestamp: new Date().toISOString(),

      // Vercel KV state
      vercelKV: {
        exists: !!agent,
        status: agent?.status || null,
        name: agent?.name || null,
        openclawSessionId: agent?.openclawSessionId || null,
        llmModel: agent?.llmModel || null,
        chatHistoryCount: messages.length,
      },

      // Upstash Redis state (shared with worker)
      upstash: {
        hasCredentials: !!(UPSTASH_URL && UPSTASH_TOKEN),
        config: parsedConfig ? {
          exists: true,
          provisionedAt: parsedConfig.provisionedAt,
          status: parsedConfig.status,
          name: parsedConfig.name,
        } : { exists: false },
        workerStatus: parsedStatus,
        queue: {
          length: queueLen?.result || 0,
          peek: queueItems,
        },
        pendingResponse: parsedResponse,
        memoryLength: memoryLen?.result || 0,
      },

      // All Redis keys for this agent (find what the worker actually writes)
      allRedisKeys: agentKeys,
      keyDetails,
      altPatterns: altResults,

      // Diagnosis
      diagnosis: diagnose(agent, parsedConfig, parsedStatus, queueLen?.result || 0, parsedResponse),
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

function diagnose(
  agent: any,
  config: any,
  status: any,
  queueLen: number,
  response: any
): string[] {
  const issues: string[] = []

  if (!agent) {
    issues.push('CRITICAL: Agent not found in Vercel KV')
    return issues
  }

  if (agent.status !== 'active') {
    issues.push(`Agent status is "${agent.status}" — worker only picks up "active" agents`)
  }

  if (!config) {
    issues.push('No config in Upstash Redis — agent not provisioned for worker. Click "Provision Agent" on dashboard.')
  }

  if (!status) {
    issues.push('No worker status in Redis — worker may not have picked up this agent yet. Check if worker is polling the right API URL.')
  } else if (status.status === 'error') {
    issues.push(`Worker reports error: ${status.error || 'unknown'}`)
  } else if (status.status === 'stopped') {
    issues.push('Worker shows agent as stopped')
  }

  if (queueLen > 0) {
    issues.push(`${queueLen} message(s) stuck in queue — worker is NOT consuming them. Either worker hasn't discovered this agent, or its AgentRunner crashed.`)
  }

  if (response) {
    issues.push('There is an unread response in Redis — frontend may not be polling GET /api/agents/:id/chat')
  }

  if (!agent.openclawSessionId) {
    issues.push('No openclawSessionId — spawn POST may not have been called')
  }

  if (issues.length === 0) {
    issues.push('No obvious issues detected. Agent is provisioned and worker seems healthy.')
  }

  return issues
}
