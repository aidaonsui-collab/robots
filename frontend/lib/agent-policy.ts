/**
 * Spending policy for agent wallets (v2).
 *
 * Every agent that signs its own transactions must pass through the policy
 * gate first. Prevents runaway spending if the LLM hallucinates or gets
 * prompt-injected into hiring a thousand other agents.
 *
 * Policies are stored per-agent in Redis and enforced in-process before
 * any keypair load. There is no on-chain enforcement — this is pure server
 * trust. V3 would move this into a Move module holding a capability.
 */

import { kv } from '@vercel/kv'
import { baseToUsdc } from './usdc'

export interface AgentSpendingPolicy {
  /** Hard cap on a single transfer. Default: 1 USDC. */
  maxSinglePaymentBase: string
  /** Rolling 24h cap. Default: 10 USDC. */
  maxDailyBase: string
  /** Whitelist of allowed recipients. Empty = no restriction. */
  allowedRecipients: string[]
  /** If true, any call to the policy gate is denied (kill switch). */
  frozen: boolean
  updatedAt: string
}

const POLICY_KEY = (agentId: string) => `agent:${agentId}:policy`
const SPEND_WINDOW_KEY = (agentId: string) => `agent:${agentId}:spend:24h`

const DEFAULT_POLICY: AgentSpendingPolicy = {
  maxSinglePaymentBase: '1000000',    // 1.000000 USDC
  maxDailyBase: '10000000',           // 10.000000 USDC
  allowedRecipients: [],
  frozen: false,
  updatedAt: new Date(0).toISOString(),
}

export async function getPolicy(agentId: string): Promise<AgentSpendingPolicy> {
  const stored = await kv.get<AgentSpendingPolicy>(POLICY_KEY(agentId))
  return stored || DEFAULT_POLICY
}

export async function setPolicy(
  agentId: string,
  policy: Partial<AgentSpendingPolicy>,
): Promise<AgentSpendingPolicy> {
  const current = await getPolicy(agentId)
  const updated: AgentSpendingPolicy = {
    ...current,
    ...policy,
    updatedAt: new Date().toISOString(),
  }
  await kv.set(POLICY_KEY(agentId), updated)
  return updated
}

export interface PolicyDecision {
  ok: boolean
  reason?: string
  remainingDailyBase?: string
}

/**
 * Check whether agent is allowed to spend `amountBase` to `recipient`.
 * If ok, call recordSpend() after the tx succeeds to update the window.
 */
export async function checkPolicy(
  agentId: string,
  amountBase: bigint,
  recipient: string,
): Promise<PolicyDecision> {
  const policy = await getPolicy(agentId)

  if (policy.frozen) {
    return { ok: false, reason: 'agent wallet is frozen' }
  }

  if (amountBase > BigInt(policy.maxSinglePaymentBase)) {
    return {
      ok: false,
      reason: `amount ${baseToUsdc(amountBase)} exceeds per-payment cap ${baseToUsdc(policy.maxSinglePaymentBase)}`,
    }
  }

  if (policy.allowedRecipients.length > 0 && !policy.allowedRecipients.includes(recipient)) {
    return { ok: false, reason: `recipient ${recipient} not in whitelist` }
  }

  // Rolling 24h window
  const spent = await getDailySpend(agentId)
  const daily = BigInt(policy.maxDailyBase)
  if (spent + amountBase > daily) {
    return {
      ok: false,
      reason: `would exceed 24h cap: spent ${baseToUsdc(spent)} + ${baseToUsdc(amountBase)} > ${baseToUsdc(daily)}`,
    }
  }

  return {
    ok: true,
    remainingDailyBase: (daily - spent - amountBase).toString(),
  }
}

/** Increment the agent's 24h spend window. TTL is 24h. */
export async function recordSpend(agentId: string, amountBase: bigint): Promise<void> {
  // TODO: replace naive counter with a sliding window (sorted set keyed by ms)
  // for more accurate accounting. 24h fixed-window is fine for v2.
  const key = SPEND_WINDOW_KEY(agentId)
  const current = await kv.get<string>(key)
  const next = BigInt(current || '0') + amountBase
  await kv.set(key, next.toString(), { ex: 24 * 60 * 60 })
}

async function getDailySpend(agentId: string): Promise<bigint> {
  const raw = await kv.get<string>(SPEND_WINDOW_KEY(agentId))
  return BigInt(raw || '0')
}
