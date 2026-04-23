import { NextRequest, NextResponse } from 'next/server'
import { getAgent, appendAgentMessage, getAgentMessages } from '@/lib/agents-db'
import {
  queueMessage,
  pollResponse,
  storeMemory,
  storeResponse,
} from '@/lib/agent-worker'
import { getAgentWallet, loadAgentKeypair, getAgentSuiBalance, getAgentNaviPosition } from '@/lib/agent-wallet'
import { MOONBAGS_AIDA_CONTRACT, AIDA_COIN_TYPE } from '@/lib/contracts_aida'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'

// Disable Next.js route caching — GET must hit Redis fresh every poll
export const dynamic = 'force-dynamic'

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY
const SERPER_API_KEY = process.env.SERPER_API_KEY
const MAX_MESSAGES = 10

// OpenAI-compatible endpoint — supports tool use / function calling
const MINIMAX_API_URL = 'https://api.minimax.io/v1/chat/completions'

// ─── Tool Definitions (OpenAI format) ────────────────────────────────────────

const AGENT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description: 'Search the internet for current information about anything — crypto, DeFi, projects, competitions, news, technical concepts, etc. Always use this when you need facts you are not 100% sure about.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query — be specific' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_crypto_prices',
      description: 'Get real-time cryptocurrency prices with 24h stats from Binance/CoinGecko.',
      parameters: {
        type: 'object',
        properties: {
          symbols: {
            type: 'array',
            items: { type: 'string' },
            description: 'Coin symbols, e.g. ["BTC", "ETH", "SOL"]',
          },
        },
        required: ['symbols'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_crypto_news',
      description: 'Get latest crypto news headlines and trending coins.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Optional focus topic' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_technical_indicators',
      description: 'Get RSI(14) and other technical indicators for a cryptocurrency. Use when asked about RSI, overbought/oversold, or technical analysis.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Coin symbol, e.g. "SOL", "BTC", "ETH"' },
          interval: { type: 'string', description: 'Timeframe: "1h", "4h", or "1d". Default "1h"' },
        },
        required: ['symbol'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'generate_file',
      description: 'Create a downloadable file for the user. Use this when asked to generate code, scripts, configs, reports, or any content they would want to download as a file.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Filename with extension, e.g. "bot.py", "config.json"' },
          content: { type: 'string', description: 'The full file content' },
          description: { type: 'string', description: 'Short one-line description of the file' },
        },
        required: ['filename', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'push_to_github',
      description: 'Push code files to a GitHub repository. Creates a new repo or updates an existing one. Only works if the creator has connected their GitHub account. Use this when the user asks you to push code to GitHub, create a repo, or save code to their GitHub.',
      parameters: {
        type: 'object',
        properties: {
          repo_name: { type: 'string', description: 'Repository name (lowercase, hyphens ok), e.g. "my-trading-bot"' },
          description: { type: 'string', description: 'Short repo description' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path in repo, e.g. "src/bot.py" or "README.md"' },
                content: { type: 'string', description: 'Full file content' },
              },
              required: ['path', 'content'],
            },
            description: 'Array of files to commit to the repo',
          },
        },
        required: ['repo_name', 'files'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'call_api',
      description: 'Make an HTTP request to any public API. Use this to fetch data from REST APIs, query blockchain RPCs, check DeFi protocol data, call webhooks, or interact with any external service. Supports GET and POST.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL to call, e.g. "https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd"' },
          method: { type: 'string', enum: ['GET', 'POST'], description: 'HTTP method. Default: GET' },
          headers: { type: 'object', description: 'Optional request headers as key-value pairs, e.g. {"Authorization": "Bearer token"}' },
          body: { type: 'string', description: 'Optional request body for POST requests (JSON string)' },
        },
        required: ['url'],
      },
    },
  },
  // ── Wallet tools (only active when agent has a funded Sui wallet) ──────────
  {
    type: 'function' as const,
    function: {
      name: 'wallet_balance',
      description: 'Check your own Sui wallet balance: SUI on hand and any SUI deposited into NAVI lending. Use this when asked "what is my balance", "how much SUI do I have", "check my wallet", or any question about your own funds.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'wallet_send',
      description: 'Send SUI from your wallet to another Sui address. Only use this when explicitly asked to send or transfer SUI.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient Sui address (0x...)' },
          amount_sui: { type: 'number', description: 'Amount of SUI to send (e.g. 0.05)' },
        },
        required: ['to', 'amount_sui'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'navi_deposit',
      description: 'Deposit SUI from your wallet into NAVI lending protocol to earn yield. Use when asked to "deposit to NAVI", "earn yield", or "put SUI to work".',
      parameters: {
        type: 'object',
        properties: {
          amount_sui: { type: 'number', description: 'Amount of SUI to deposit (e.g. 0.05)' },
        },
        required: ['amount_sui'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'navi_withdraw',
      description: 'Withdraw SUI from your NAVI lending position back to your wallet.',
      parameters: {
        type: 'object',
        properties: {
          amount_sui: { type: 'number', description: 'Amount of SUI to withdraw (e.g. 0.05)' },
        },
        required: ['amount_sui'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'bc_buy',
      description: 'Buy an AIDA-paired bonding-curve token on Odyssey, paying from your own AIDA balance. Specify the full token coin type (like "0x…::sword::SWORD") and how much AIDA to spend. Optionally pass min_tokens_out for slippage protection (units: 6-decimal token base units; omit to accept any price).',
      parameters: {
        type: 'object',
        properties: {
          coin_type: { type: 'string', description: 'Full token coin type, e.g. "0xc9ec…::nout::NUT"' },
          amount_aida: { type: 'number', description: 'AIDA to spend (whole units, e.g. 25 for 25 AIDA)' },
          min_tokens_out: { type: 'number', description: 'Optional minimum tokens to receive in 6-decimal base units. Omit for "any price" (not recommended).' },
        },
        required: ['coin_type', 'amount_aida'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'bc_sell',
      description: 'Sell an AIDA-paired bonding-curve token you hold back into AIDA. Specify the full token coin type and how many tokens to sell. Optionally pass min_aida_out (in AIDA mist: 10^9 per AIDA) for slippage protection.',
      parameters: {
        type: 'object',
        properties: {
          coin_type: { type: 'string', description: 'Full token coin type' },
          amount_tokens: { type: 'number', description: 'Tokens to sell (whole units, 6-decimal tokens, e.g. 1000 for 1,000 tokens)' },
          min_aida_out: { type: 'number', description: 'Optional minimum AIDA to receive in mist (10^9 per AIDA). Omit for "any price".' },
        },
        required: ['coin_type', 'amount_tokens'],
      },
    },
  },
]

// ─── Agent Wallet Tools ───────────────────────────────────────────────────────

const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet') })

// Navi / oracle object IDs (same as staking page)
const NAVI_PKG_FALLBACK  = '0x1e4a13a0494d5facdbe8473e74127b838c2d446ecec0ce262e2eddafa77259cb'
const NAVI_STORAGE       = '0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe'
const NAVI_POOL_SUI      = '0x96df0fce3c471489f4debaaa762cf960b3d97820bd1f3f025ff8190730e958c5'
const NAVI_INCENTIVE_V2  = '0xf87a8acb8b81d14307894d12595541a73f19933f88e1326d5be349c7a6f7559c'
const NAVI_INCENTIVE_V3  = '0x62982dad27fb10bb314b3384d5de8d2ac2d72ab2dbeae5d801dbdb9efa816c80'
const NAVI_PRICE_ORACLE  = '0x1568865ed9a0b5ec414220e8f79b3d04c77acc82358f6e5ae4635687392ffbef'
const ORACLE_PRO_PKG     = '0x203728f46eb10d19f8f8081db849c86aa8f2a19341b7fd84d7a0e74f053f6242'
const ORACLE_PRO_CONFIG  = '0x1afe1cb83634f581606cc73c4487ddd8cc39a944b951283af23f7d69d5589478'
const ORACLE_SUPRA       = '0xaa0315f0748c1f24ddb2b45f7939cff40f7a8104af5ccbc4a1d32f870c0b4105'
const SUI_PYTH_INFO_OBJ  = '0x801dbc2f0053d34734814b2d6df491ce7807a725fe9a01ad74a07e9c51396c37'
const SUI_FEED_ID        = '0x2cab9b151ca1721624b09b421cc57d0bb26a1feb5da1f821492204b098ec35c9'
const SUI_WORMHOLE_OBJ   = '0x1fa7566f40f93cdbafd5a029a231e06664219444debb59beec2fe3f19ca08b7e'

async function agentWalletBalance(agentId?: string): Promise<string> {
  if (!agentId) return 'No agent ID — cannot check balance.'
  const wallet = await getAgentWallet(agentId)
  if (!wallet) return 'This agent does not have a Sui wallet yet.'
  const [sui, navi] = await Promise.all([
    getAgentSuiBalance(wallet.address),
    getAgentNaviPosition(wallet.address),
  ])
  const lines = [
    `**Wallet:** \`${wallet.address}\``,
    `**SUI balance:** ${sui.toFixed(4)} SUI`,
    navi
      ? `**NAVI lending:** ${navi.deposited.toFixed(4)} SUI deposited${navi.apy > 0 ? ` (${navi.apy}% APY)` : ''}`
      : `**NAVI lending:** no active position`,
    `**Total:** ~${(sui + (navi?.deposited ?? 0)).toFixed(4)} SUI`,
  ]
  return lines.join('\n')
}

async function agentWalletSend(agentId: string | undefined, to: string, amountSui: number): Promise<string> {
  if (!agentId) return 'No agent ID.'
  if (!to?.startsWith('0x')) return 'Invalid recipient address — must start with 0x.'
  if (!amountSui || amountSui <= 0) return 'Amount must be greater than 0.'
  const keypair = await loadAgentKeypair(agentId)
  if (!keypair) return 'No wallet keypair found for this agent.'
  try {
    const amtMist = BigInt(Math.floor(amountSui * 1e9))
    const tx = new Transaction()
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amtMist)])
    tx.transferObjects([coin], to)
    const result = await suiClient.signAndExecuteTransaction({ signer: keypair, transaction: tx })
    return `✅ Sent ${amountSui} SUI to \`${to}\`\nDigest: \`${result.digest}\``
  } catch (e: any) {
    return `Failed to send: ${e.message}`
  }
}

async function agentNaviDeposit(agentId: string | undefined, amountSui: number): Promise<string> {
  if (!agentId) return 'No agent ID.'
  if (!amountSui || amountSui <= 0) return 'Amount must be greater than 0.'
  const keypair = await loadAgentKeypair(agentId)
  if (!keypair) return 'No wallet keypair found for this agent.'
  try {
    const amtMist = BigInt(Math.floor(amountSui * 1e9))
    const tx = new Transaction()
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amtMist)])
    tx.moveCall({
      target: `${NAVI_PKG_FALLBACK}::incentive_v3::entry_deposit`,
      typeArguments: ['0x2::sui::SUI'],
      arguments: [
        tx.object('0x0000000000000000000000000000000000000000000000000000000000000006'),
        tx.object(NAVI_STORAGE),
        tx.object(NAVI_POOL_SUI),
        tx.pure.u8(0),
        coin,
        tx.pure.u64(amtMist),
        tx.object(NAVI_INCENTIVE_V2),
        tx.object(NAVI_INCENTIVE_V3),
      ],
    })
    const result = await suiClient.signAndExecuteTransaction({ signer: keypair, transaction: tx })
    return `✅ Deposited ${amountSui} SUI into NAVI lending\nDigest: \`${result.digest}\`\nYour SUI is now earning yield. Use \`wallet_balance\` to see your position.`
  } catch (e: any) {
    return `Failed to deposit: ${e.message}`
  }
}

async function agentNaviWithdraw(agentId: string | undefined, amountSui: number): Promise<string> {
  if (!agentId) return 'No agent ID.'
  if (!amountSui || amountSui <= 0) return 'Amount must be greater than 0.'
  const keypair = await loadAgentKeypair(agentId)
  if (!keypair) return 'No wallet keypair found for this agent.'
  const address = keypair.getPublicKey().toSuiAddress()
  try {
    const amtMist = BigInt(Math.floor(amountSui * 1e9))
    const tx = new Transaction()
    // Refresh SUI oracle price first (prevents abort 1502 stale oracle)
    tx.moveCall({
      target: `${ORACLE_PRO_PKG}::oracle_pro::update_single_price_v2`,
      arguments: [
        tx.object('0x0000000000000000000000000000000000000000000000000000000000000006'),
        tx.object(ORACLE_PRO_CONFIG),
        tx.object(NAVI_PRICE_ORACLE),
        tx.object(ORACLE_SUPRA),
        tx.object(SUI_PYTH_INFO_OBJ),
        tx.object(SUI_WORMHOLE_OBJ),
        tx.pure.address(SUI_FEED_ID),
      ],
    })
    const [withdrawnBalance] = tx.moveCall({
      target: `${NAVI_PKG_FALLBACK}::incentive_v3::withdraw_v2`,
      typeArguments: ['0x2::sui::SUI'],
      arguments: [
        tx.object('0x0000000000000000000000000000000000000000000000000000000000000006'),
        tx.object(NAVI_PRICE_ORACLE),
        tx.object(NAVI_STORAGE),
        tx.object(NAVI_POOL_SUI),
        tx.pure.u8(0),
        tx.pure.u64(amtMist),
        tx.object(NAVI_INCENTIVE_V2),
        tx.object(NAVI_INCENTIVE_V3),
        tx.object('0x0000000000000000000000000000000000000000000000000000000000000005'),
      ],
    })
    const [suiCoin] = tx.moveCall({
      target: '0x2::coin::from_balance',
      typeArguments: ['0x2::sui::SUI'],
      arguments: [withdrawnBalance],
    })
    tx.transferObjects([suiCoin], address)
    const result = await suiClient.signAndExecuteTransaction({ signer: keypair, transaction: tx })
    return `✅ Withdrew ${amountSui} SUI from NAVI back to your wallet\nDigest: \`${result.digest}\``
  } catch (e: any) {
    return `Failed to withdraw: ${e.message}`
  }
}

// ─── Bonding-curve trade tools (AIDA-pair only, v1) ────────────────────────
//
// Both entries target the current AIDA V5 upgrade. Configuration + TokenLock
// shared objects were minted at the V2 original publish but the V5 upgrade
// is where `buy_exact_in_with_lock` and `sell` live today. We auto-resolve
// the per-token Pool via Sui's dynamic_object_field lookup inside the Move
// entry, so the agent only has to supply a token coin_type.
//
// SUI-pair support is a follow-up — V14's buy has 10 args (Cetus objects)
// and a different Configuration. The bc_* tools return a clear error if the
// token isn't an AIDA-pair token rather than silently trying the wrong
// signature.

async function agentBondingCurveBuy(
  agentId: string | undefined,
  coinType: string,
  amountAida: number,
  minTokensOutBase?: number,
): Promise<string> {
  if (!agentId) return 'No agent ID.'
  if (!coinType || !coinType.includes('::')) return 'Invalid coin_type — must be like "0x…::module::TYPE".'
  if (!amountAida || amountAida <= 0) return 'amount_aida must be greater than 0.'
  const keypair = await loadAgentKeypair(agentId)
  if (!keypair) return 'No wallet keypair for this agent.'
  const address = keypair.getPublicKey().toSuiAddress()

  try {
    const amtMist = BigInt(Math.floor(amountAida * 1e9))
    const minOut = minTokensOutBase && minTokensOutBase > 0
      ? BigInt(Math.floor(minTokensOutBase))
      : 1n

    const { data: aidaCoins } = await suiClient.getCoins({ owner: address, coinType: AIDA_COIN_TYPE })
    if (!aidaCoins.length) return 'No AIDA in wallet. Fund the agent with AIDA first.'
    const sorted = [...aidaCoins].sort((a, b) => Number(BigInt(b.balance) - BigInt(a.balance)))
    const selected: typeof aidaCoins = []
    let accum = 0n
    for (const c of sorted) {
      selected.push(c)
      accum += BigInt(c.balance)
      if (accum >= amtMist) break
    }
    if (accum < amtMist) return `Insufficient AIDA: need ${amountAida}, have ${Number(accum) / 1e9}.`

    const tx = new Transaction()
    const base = tx.object(selected[0].coinObjectId)
    if (selected.length > 1) {
      tx.mergeCoins(base, selected.slice(1).map(c => tx.object(c.coinObjectId)))
    }
    const [spendCoin] = tx.splitCoins(base, [amtMist])

    tx.moveCall({
      target: `${MOONBAGS_AIDA_CONTRACT.packageId}::moonbags::buy_exact_in_with_lock`,
      typeArguments: [coinType],
      arguments: [
        tx.object(MOONBAGS_AIDA_CONTRACT.configuration),
        tx.object(MOONBAGS_AIDA_CONTRACT.lockConfig),
        spendCoin,
        tx.pure.u64(amtMist),
        tx.pure.u64(minOut),
        tx.object('0x0000000000000000000000000000000000000000000000000000000000000006'),
      ],
    })

    const result = await suiClient.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true },
    })
    const ok = result.effects?.status?.status === 'success'
    const symbol = coinType.split('::').pop() ?? 'TOKEN'
    if (!ok) {
      return `Buy failed: ${JSON.stringify(result.effects?.status)}. If the pool is SUI-paired (not AIDA), bc_buy won't work — SUI-pair support is coming in a follow-up.`
    }
    return `✅ Bought ${symbol} with ${amountAida} AIDA\nDigest: \`${result.digest}\``
  } catch (e: any) {
    return `Buy failed: ${e.message}`
  }
}

async function agentBondingCurveSell(
  agentId: string | undefined,
  coinType: string,
  amountTokens: number,
  minAidaOutMist?: number,
): Promise<string> {
  if (!agentId) return 'No agent ID.'
  if (!coinType || !coinType.includes('::')) return 'Invalid coin_type.'
  if (!amountTokens || amountTokens <= 0) return 'amount_tokens must be greater than 0.'
  const keypair = await loadAgentKeypair(agentId)
  if (!keypair) return 'No wallet keypair for this agent.'
  const address = keypair.getPublicKey().toSuiAddress()

  try {
    const amtBase = BigInt(Math.floor(amountTokens * 1e6))
    const minOut = minAidaOutMist && minAidaOutMist > 0
      ? BigInt(Math.floor(minAidaOutMist))
      : 1n

    const { data: tokens } = await suiClient.getCoins({ owner: address, coinType })
    if (!tokens.length) return `No ${coinType.split('::').pop()} in wallet.`
    const total = tokens.reduce((s, c) => s + BigInt(c.balance), 0n)
    if (total < amtBase) return `Insufficient tokens: need ${amountTokens}, have ${Number(total) / 1e6}.`

    const tx = new Transaction()
    const primary = tx.object(tokens[0].coinObjectId)
    if (tokens.length > 1) {
      tx.mergeCoins(primary, tokens.slice(1).map(c => tx.object(c.coinObjectId)))
    }
    let sellCoin: any
    if (amtBase >= total) {
      sellCoin = primary
    } else {
      const [split] = tx.splitCoins(primary, [amtBase])
      sellCoin = split
    }

    tx.moveCall({
      target: `${MOONBAGS_AIDA_CONTRACT.packageId}::moonbags::sell`,
      typeArguments: [coinType],
      arguments: [
        tx.object(MOONBAGS_AIDA_CONTRACT.configuration),
        sellCoin,
        tx.pure.u64(minOut),
        tx.object('0x0000000000000000000000000000000000000000000000000000000000000006'),
      ],
    })

    const result = await suiClient.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true },
    })
    const ok = result.effects?.status?.status === 'success'
    const symbol = coinType.split('::').pop() ?? 'TOKEN'
    if (!ok) {
      return `Sell failed: ${JSON.stringify(result.effects?.status)}. If the pool is SUI-paired, bc_sell won't work — SUI-pair support is coming in a follow-up.`
    }
    return `✅ Sold ${amountTokens} ${symbol} back to AIDA\nDigest: \`${result.digest}\``
  } catch (e: any) {
    return `Sell failed: ${e.message}`
  }
}

// ─── Tool Execution ──────────────────────────────────────────────────────────

async function executeTool(name: string, args: any, agentId?: string, agentApiKeys?: any[]): Promise<string> {
  console.log(`[tool-call] ${name}`, JSON.stringify(args).slice(0, 200))
  try {
    switch (name) {
      case 'web_search': return await webSearch(args.query || '')
      case 'get_crypto_prices': return await cryptoPrices(args.symbols || ['BTC', 'ETH', 'SOL'])
      case 'get_crypto_news': return await cryptoNews(args.topic)
      case 'get_technical_indicators': return await technicalIndicators(args.symbol || 'BTC', args.interval || '1h')
      case 'generate_file': return await generateFile(args.filename, args.content, args.description)
      case 'push_to_github': return await pushToGitHub(agentId || '', args.repo_name, args.files, args.description)
      case 'call_api': return await callApi(args.url, args.method, args.headers, args.body, agentApiKeys)
      case 'wallet_balance': return await agentWalletBalance(agentId)
      case 'wallet_send': return await agentWalletSend(agentId, args.to, args.amount_sui)
      case 'navi_deposit': return await agentNaviDeposit(agentId, args.amount_sui)
      case 'navi_withdraw': return await agentNaviWithdraw(agentId, args.amount_sui)
      case 'bc_buy': return await agentBondingCurveBuy(agentId, args.coin_type, args.amount_aida, args.min_tokens_out)
      case 'bc_sell': return await agentBondingCurveSell(agentId, args.coin_type, args.amount_tokens, args.min_aida_out)
      default: return `Unknown tool: ${name}`
    }
  } catch (err: any) {
    console.error(`[tool-error] ${name}:`, err.message)
    return `Tool error: ${err.message}`
  }
}

async function webSearch(query: string): Promise<string> {
  if (!query) return 'No search query provided.'

  // Serper (Google search) if available
  if (SERPER_API_KEY) {
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: 5 }),
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const data = await res.json()
        const parts: string[] = []
        if (data.answerBox?.answer) parts.push(`Answer: ${data.answerBox.answer}`)
        if (data.answerBox?.snippet) parts.push(data.answerBox.snippet)
        if (data.knowledgeGraph?.description) parts.push(`${data.knowledgeGraph.title}: ${data.knowledgeGraph.description}`)
        for (const r of (data.organic || []).slice(0, 5)) {
          parts.push(`${r.title}\n${r.snippet || ''}\n${r.link}`)
        }
        if (parts.length > 0) return parts.join('\n\n')
      }
    } catch {}
  }

  // DuckDuckGo instant answer (free, no key)
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { signal: AbortSignal.timeout(5000) }
    )
    if (res.ok) {
      const d = await res.json()
      const parts: string[] = []
      if (d.AbstractText) parts.push(`${d.Heading}: ${d.AbstractText}`)
      if (d.Answer) parts.push(`Answer: ${d.Answer}`)
      for (const t of (d.RelatedTopics || []).slice(0, 5)) {
        if (t.Text) parts.push(`- ${t.Text}`)
      }
      if (parts.length > 0) return parts.join('\n')
    }
  } catch {}

  return `No search results found for "${query}". Answer based on your knowledge but tell the user you couldn't verify.`
}

async function cryptoPrices(symbols: string[]): Promise<string> {
  const lines: string[] = []

  // Binance
  try {
    const results = await Promise.all(
      symbols.map(s =>
        fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${s.toUpperCase()}USDT`, {
          signal: AbortSignal.timeout(5000),
        }).then(r => r.ok ? r.json() : null).catch(() => null)
      )
    )
    for (const s of results) {
      if (!s?.symbol) continue
      const name = s.symbol.replace('USDT', '')
      lines.push(`${name}: $${parseFloat(s.lastPrice).toLocaleString()} | 24h: ${parseFloat(s.priceChangePercent) >= 0 ? '+' : ''}${parseFloat(s.priceChangePercent).toFixed(2)}% | H: $${parseFloat(s.highPrice).toLocaleString()} L: $${parseFloat(s.lowPrice).toLocaleString()} | Vol: $${(parseFloat(s.quoteVolume) / 1e6).toFixed(1)}M`)
    }
    if (lines.length > 0) return lines.join('\n')
  } catch {}

  // CoinGecko fallback
  try {
    const idMap: Record<string, string> = {
      BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', SUI: 'sui', ADA: 'cardano',
      DOT: 'polkadot', AVAX: 'avalanche-2', LINK: 'chainlink', DOGE: 'dogecoin', XRP: 'ripple',
    }
    const ids = symbols.map(s => idMap[s.toUpperCase()] || s.toLowerCase()).join(',')
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(5000), cache: 'no-store' }
    )
    if (res.ok) {
      const data = await res.json()
      for (const [id, v] of Object.entries(data) as any) {
        lines.push(`${id}: $${v.usd?.toLocaleString()} (${v.usd_24h_change >= 0 ? '+' : ''}${v.usd_24h_change?.toFixed(2)}%)`)
      }
      if (lines.length > 0) return lines.join('\n')
    }
  } catch {}

  return 'Price data temporarily unavailable.'
}

async function cryptoNews(topic?: string): Promise<string> {
  try {
    const url = topic
      ? `https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=${encodeURIComponent(topic)}&sortOrder=popular&limit=6`
      : 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=popular&limit=6'
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (res.ok) {
      const data = await res.json()
      if (data.Data?.length > 0) {
        return data.Data.slice(0, 6).map((a: any) => {
          const ago = Math.floor((Date.now() / 1000 - a.published_on) / 60)
          const t = ago < 60 ? `${ago}m ago` : `${Math.floor(ago / 60)}h ago`
          return `- ${a.title} (${a.source}, ${t})`
        }).join('\n')
      }
    }
  } catch {}

  try {
    const res = await fetch('https://api.coingecko.com/api/v3/search/trending', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (res.ok) {
      const data = await res.json()
      return 'Trending: ' + (data.coins || []).slice(0, 7).map((c: any) => `${c.item.name} (${c.item.symbol})`).join(', ')
    }
  } catch {}

  return 'News temporarily unavailable.'
}

async function technicalIndicators(symbol: string, interval: string = '1h'): Promise<string> {
  const pair = `${symbol.toUpperCase()}USDT`
  const validIntervals = ['1m', '5m', '15m', '1h', '4h', '1d']
  const tf = validIntervals.includes(interval) ? interval : '1h'

  try {
    // Fetch 30 candles from Binance (need 14+ for RSI)
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${tf}&limit=30`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return `Could not fetch klines for ${pair} (${res.status})`

    const klines = await res.json()
    if (!Array.isArray(klines) || klines.length < 15) return `Not enough data for ${pair}`

    const closes = klines.map((k: any) => parseFloat(k[4]))

    // RSI(14) — Wilder smoothing
    const period = 14
    let gains = 0, losses = 0
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1]
      if (diff >= 0) gains += diff; else losses -= diff
    }
    let avgGain = gains / period
    let avgLoss = losses / period
    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1]
      avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period
      avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs)

    // Current price
    const price = closes[closes.length - 1]

    // Simple interpretation
    let signal = 'Neutral'
    if (rsi >= 70) signal = 'Overbought — potential reversal down'
    else if (rsi >= 60) signal = 'Mildly bullish'
    else if (rsi <= 30) signal = 'Oversold — potential reversal up'
    else if (rsi <= 40) signal = 'Mildly bearish'

    return `${symbol.toUpperCase()} Technical Indicators (${tf} timeframe):
RSI(14): ${rsi.toFixed(1)} — ${signal}
Current Price: $${price.toLocaleString()}
Data points: ${closes.length} candles`
  } catch (err: any) {
    return `Error fetching indicators for ${symbol}: ${err.message}`
  }
}

// ─── File Generation ────────────────────────────────────────────────────────

async function generateFile(filename: string, content: string, description?: string): Promise<string> {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!upstashUrl || !upstashToken) return 'Error: File storage not configured'
  if (content.length > 500_000) return 'Error: File too large (max 500KB)'

  const fileId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const payload = JSON.stringify({
    filename,
    content,
    description: description || filename,
    createdAt: new Date().toISOString(),
    size: content.length,
  })

  const res = await fetch(upstashUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${upstashToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', `file:${fileId}`, payload, 'EX', '86400']),
  })
  if (!res.ok) return 'Error: Failed to store file'

  return `File "${filename}" created (${content.length} bytes). Include this download marker in your response exactly as-is:\n[[DOWNLOAD:${fileId}|${filename}|${description || filename}]]`
}

// ─── Call External API ──────────────────────────────────────────────────────

// Block internal/private IPs to prevent SSRF
function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    // Block private/internal ranges
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') return true
    if (hostname.startsWith('10.') || hostname.startsWith('192.168.') || hostname.startsWith('172.')) return true
    if (hostname === '169.254.169.254') return true // AWS metadata
    if (hostname.endsWith('.internal') || hostname.endsWith('.local')) return true
    // Block file:// and other non-http schemes
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return true
    return false
  } catch {
    return true // Invalid URL
  }
}

// Look up stored API credentials for a URL
function getStoredHeaders(url: string, apiKeys?: any[]): Record<string, string> {
  if (!apiKeys?.length) return {}
  try {
    const parsed = new URL(url)
    const match = apiKeys.find((k: any) => {
      try { return parsed.hostname.includes(new URL(k.baseUrl).hostname) } catch { return false }
    })
    return match?.headers || {}
  } catch { return {} }
}

async function callApi(
  url: string,
  method?: string,
  headers?: Record<string, string>,
  body?: string,
  apiKeys?: any[]
): Promise<string> {
  if (!url) return 'Error: url is required'
  if (isBlockedUrl(url)) return 'Error: Cannot call internal/private URLs'

  // Auto-inject stored credentials if URL matches a configured API
  const storedHeaders = getStoredHeaders(url, apiKeys)
  const mergedHeaders = { ...storedHeaders, ...(headers || {}) }

  const httpMethod = (method || 'GET').toUpperCase()
  if (httpMethod !== 'GET' && httpMethod !== 'POST') return 'Error: Only GET and POST are supported'

  console.log(`[call_api] ${httpMethod} ${url}`)

  try {
    const fetchOptions: RequestInit = {
      method: httpMethod,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'OdysseyAgent/1.0',
        ...mergedHeaders,
      },
      signal: AbortSignal.timeout(10000),
    }

    if (httpMethod === 'POST' && body) {
      fetchOptions.body = body
      if (!mergedHeaders['Content-Type'] && !mergedHeaders['content-type']) {
        (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json'
      }
    }

    const res = await fetch(url, fetchOptions)
    const contentType = res.headers.get('content-type') || ''

    let responseText: string
    if (contentType.includes('json')) {
      const json = await res.json()
      responseText = JSON.stringify(json, null, 2)
    } else {
      responseText = await res.text()
    }

    // Truncate large responses
    if (responseText.length > 4000) {
      responseText = responseText.slice(0, 4000) + '\n... (truncated, response too large)'
    }

    if (!res.ok) {
      return `HTTP ${res.status} ${res.statusText}:\n${responseText}`
    }

    return responseText
  } catch (err: any) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return 'Error: Request timed out (10s limit)'
    }
    return `Error: ${err.message}`
  }
}

// ─── Push to GitHub ─────────────────────────────────────────────────────────

async function pushToGitHub(
  agentId: string,
  repoName: string,
  files: Array<{ path: string; content: string }>,
  description?: string
): Promise<string> {
  if (!agentId) return 'Error: No agent context'
  if (!repoName || !files?.length) return 'Error: repo_name and files are required'

  const agent = await getAgent(agentId) as any
  if (!agent) return 'Error: Agent not found'

  const token = agent.githubToken
  const username = agent.githubUsername

  if (!token || !username) {
    return 'GitHub is not connected. The creator needs to connect their GitHub account from the agent dashboard first. Tell them to click "Connect GitHub" in the settings panel.'
  }

  const ghHeaders: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  try {
    // Create repo (or use existing)
    let repoUrl = ''
    const createRes = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: ghHeaders,
      body: JSON.stringify({
        name: repoName,
        description: description || `Built by ${agent.name} on Odyssey`,
        private: false,
        auto_init: true,
      }),
    })

    const createData = await createRes.json() as any

    if (createRes.ok) {
      repoUrl = createData.html_url
    } else if (createData.errors?.[0]?.message?.includes('already exists')) {
      const existingRes = await fetch(`https://api.github.com/repos/${username}/${repoName}`, {
        headers: ghHeaders,
      })
      const existing = await existingRes.json() as any
      repoUrl = existing.html_url
    } else {
      return `Error creating repo: ${createData.message || 'Unknown error'}`
    }

    // Wait for repo init
    await new Promise(r => setTimeout(r, 1500))

    // Get HEAD SHA
    const refRes = await fetch(
      `https://api.github.com/repos/${username}/${repoName}/git/ref/heads/main`,
      { headers: ghHeaders }
    )
    const refData = await refRes.json() as any
    const baseSha = refData.object?.sha

    if (!baseSha) return `Error: Could not get repo HEAD. Repo may still be initializing — try again.`

    // Create blobs
    const treeItems = await Promise.all(
      files.map(async (file) => {
        const blobRes = await fetch(
          `https://api.github.com/repos/${username}/${repoName}/git/blobs`,
          {
            method: 'POST',
            headers: ghHeaders,
            body: JSON.stringify({
              content: Buffer.from(file.content).toString('base64'),
              encoding: 'base64',
            }),
          }
        )
        const blob = await blobRes.json() as any
        return { path: file.path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha }
      })
    )

    // Create tree
    const treeRes = await fetch(
      `https://api.github.com/repos/${username}/${repoName}/git/trees`,
      {
        method: 'POST',
        headers: ghHeaders,
        body: JSON.stringify({ base_tree: baseSha, tree: treeItems }),
      }
    )
    const tree = await treeRes.json() as any

    // Create commit
    const commitRes = await fetch(
      `https://api.github.com/repos/${username}/${repoName}/git/commits`,
      {
        method: 'POST',
        headers: ghHeaders,
        body: JSON.stringify({
          message: `Built by ${agent.name} via Odyssey`,
          tree: tree.sha,
          parents: [baseSha],
        }),
      }
    )
    const commit = await commitRes.json() as any

    // Update ref
    await fetch(
      `https://api.github.com/repos/${username}/${repoName}/git/refs/heads/main`,
      {
        method: 'PATCH',
        headers: ghHeaders,
        body: JSON.stringify({ sha: commit.sha }),
      }
    )

    const filePaths = files.map(f => f.path).join(', ')
    return `Successfully pushed ${files.length} file(s) to GitHub! Include this in your response:\n[[GITHUB:${repoUrl}|${repoName}|${filePaths}]]`
  } catch (err: any) {
    console.error('[push-to-github error]', err)
    return `Error pushing to GitHub: ${err.message}`
  }
}

// ─── MiniMax with Tool Use Loop ──────────────────────────────────────────────

async function callMiniMaxWithTools(
  messages: Array<{ role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string; name?: string }>,
  agentId?: string,
  agentApiKeys?: any[]
): Promise<string> {
  if (!MINIMAX_API_KEY) return 'No MINIMAX_API_KEY configured.'

  let current = [...messages]

  // Up to 5 tool rounds (agent might chain: search → price check → search again)
  for (let round = 0; round < 5; round++) {
    const res = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MINIMAX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.7',
        messages: current,
        tools: AGENT_TOOLS,
        tool_choice: 'auto',
        max_tokens: 2048,
        temperature: 0.7,
      }),
    })

    if (!res.ok) {
      const err = await res.text().catch(() => 'unknown')
      console.error('[minimax] Error:', res.status, err)
      return 'LLM error — try again.'
    }

    const data = await res.json()
    const msg = data.choices?.[0]?.message
    if (!msg) return 'Empty response from LLM.'

    // Model wants to call tools
    if (msg.tool_calls?.length > 0) {
      current.push({
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.tool_calls,
      })

      for (const tc of msg.tool_calls) {
        let args: any = {}
        try { args = JSON.parse(tc.function.arguments) } catch {}

        const result = await executeTool(tc.function.name, args, agentId, agentApiKeys)
        console.log(`[tool-result] ${tc.function.name}: ${result.slice(0, 100)}...`)

        current.push({
          role: 'tool',
          content: result,
          tool_call_id: tc.id,
        })
      }
      continue // Next round — model sees tool results
    }

    // Final text response
    return msg.content || 'No response generated.'
  }

  return 'Agent used too many tool calls. Try a simpler question.'
}

// ─── System Prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(agent: any, walletAddress?: string): string {
  const skills = Array.isArray(agent.skills) ? agent.skills.join(', ') : 'general'
  const personality = agent.personality || ''
  const hasGithub = !!(agent.githubToken && agent.githubUsername)
  const hasTwitter = !!(agent.twitterConfig?.apiKey && agent.twitterConfig?.accessToken)
  const twitterUser = agent.twitterConfig?.username
  const hasTelegram = !!(agent.telegramConfig?.enabled && agent.telegramConfig?.botToken)
  const telegramBot = agent.telegramConfig?.botUsername
  const hasWallet = !!walletAddress

  return `You are **${agent.name}** ($${agent.symbol || 'AGENT'}), an AI agent on The Odyssey (Sui blockchain DeFi launchpad), powered by OpenClaw.
${hasWallet ? `\n## YOUR SUI WALLET\nYou have your own Sui wallet: \`${walletAddress}\`\nThis wallet holds real SUI and can interact with DeFi protocols on-chain. You can check your balance, send SUI, deposit into NAVI lending to earn yield, and withdraw. These are REAL on-chain transactions.\n` : ''}
## YOUR TOOLS — YOU MUST USE THEM
You have function-calling tools. When a user asks you to do something covered by a tool, you MUST call the tool. Do NOT describe what you "would" do — actually do it by calling the function.

Available tools:
- get_crypto_prices — real-time prices
- get_technical_indicators — RSI / technical analysis
- get_crypto_news — latest crypto news
- web_search — search for any factual info
- generate_file — create downloadable files (use for any code, scripts, configs)
- push_to_github — push files to a GitHub repo${hasGithub ? ` (GitHub connected: @${agent.githubUsername})` : ' (not connected yet)'}
- call_api — make HTTP GET/POST requests to any public API (fetch data, query RPCs, call webhooks, etc.)
${hasWallet ? `- wallet_balance — check your own SUI balance and NAVI lending position (call this immediately when asked about your balance/funds)
- wallet_send — send SUI to any Sui address
- navi_deposit — deposit SUI into NAVI lending to earn yield
- navi_withdraw — withdraw SUI from your NAVI position
- bc_buy — buy an AIDA-paired bonding-curve token using AIDA from your wallet
- bc_sell — sell an AIDA-paired bonding-curve token back to AIDA` : ''}

CRITICAL RULES:
- When asked to "push to GitHub" or "create a repo" → call push_to_github immediately. Do NOT say "I can help with that" or explain how — just call the tool.
- When asked to write code → call generate_file. Do not paste code longer than 10 lines inline.
- When asked to call an API, fetch data from a URL, or interact with an external service → call call_api. You can make real HTTP requests.
- NEVER guess prices or facts. Call the appropriate tool first.
${hasGithub ? `- GitHub IS connected to @${agent.githubUsername}. You CAN push code right now.` : '- GitHub is not connected. Tell the user to click "Connect GitHub" in the dashboard.'}
${hasTwitter ? `\n## Twitter/X\nYou are connected to Twitter as @${twitterUser || 'unknown'}. When the user asks you to tweet or post on X/Twitter, write the tweet text directly. The system will auto-post it. Write tweet content in quotes so the system can extract it. Keep tweets under 280 characters. Be engaging, use your personality.` : ''}
${hasTelegram ? `\n## Telegram\nYou have your own Telegram bot (@${telegramBot || 'your bot'}). People can chat with you directly on Telegram. When asked to send a message to Telegram or your channel, write the message text directly. The system will send it. You can use Markdown formatting in Telegram messages.` : ''}
${agent.services?.length ? `\n## Your Services (Marketplace)\nYou offer the following services that other agents can hire you for:\n${agent.services.filter((s: any) => s.enabled).map((s: any) => `- ${s.name} (${s.price} SUI): ${s.description}`).join('\n')}\nWhen asked about your services, describe them. You can also suggest agents check the Marketplace tab.` : ''}

## Agent Marketplace
Other AI agents on Odyssey also offer services. If a user asks you to hire/find another agent for a task, suggest they check the Marketplace tab in the dashboard. You can describe how the marketplace works: agents list services, other agents hire them, results are stored on Walrus decentralized storage.

If a user asks you to DO something you can't (like execute a backtest), be honest: explain what you'd need and offer alternatives. Don't pretend you did it.

${personality ? `## Personality\n${personality}\n` : ''}
## Skills: ${skills}

## Style
- Confident, opinionated when backed by data
- Use markdown formatting naturally
- Lead with the answer
- Present tool results naturally — don't mention "tool calls"
- Be honest about limitations`
}

// ─── Strip <think> tags from model output ────────────────────────────────────

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim()
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await params
  const { message } = await request.json()

  if (!message) {
    return NextResponse.json({ error: 'Message required' }, { status: 400 })
  }

  try {
    const agent = await getAgent(agentId)
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    // Save user message
    await appendAgentMessage(agentId, {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    })
    storeMemory(agentId, 'user', message).catch(() => {})

    // ── Detect intents that need direct handling (worker can't auto-execute) ──
    const wantsGitHub = /push.*(to\s+)?github|create.*(a\s+)?repo|github.*push|push.*repo/i.test(message)
    const agentData = agent as any
    const hasGitHub = !!(agentData.githubToken && agentData.githubUsername)

    // Detect API call intent: user message has a URL + action words like fetch/call/query/get
    const urlMatch = message.match(/https?:\/\/[^\s"'<>]+/)
    const wantsApiCall = !!urlMatch && /fetch|call|query|get|hit|request|ask|check|pull|grab|retrieve|post to/i.test(message)

    // Detect tweet intent: user asks agent to tweet/post to twitter/X
    const wantsTweet = /tweet|post.*(to\s+)?(twitter|x\b)|send.*(a\s+)?tweet|write.*(a\s+)?tweet|twitter.*post|post.*on\s+x\b/i.test(message)
    const hasTwitter = !!(agentData.twitterConfig?.apiKey && agentData.twitterConfig?.accessToken)

    // Detect Telegram send intent: user asks agent to send/post to Telegram channel
    const wantsTelegramSend = /send.*(to\s+)?telegram|post.*(to\s+)?telegram|telegram.*send|telegram.*post|message.*telegram/i.test(message)
    const hasTelegram = !!(agentData.telegramConfig?.enabled && agentData.telegramConfig?.botToken && agentData.telegramConfig?.channelIds?.length)

    // Detect wallet intent: balance check, send, deposit/withdraw — must use Vercel path (has keypair access)
    const wantsWallet = /\b(balance|wallet|send.*sui|sui.*send|deposit.*navi|navi.*deposit|withdraw.*navi|navi.*withdraw|my.*sui|your.*sui|how much.*sui|sui.*balance|check.*wallet|what.*balance)\b/i.test(message)

    // Force direct handling when we need server-side auto-execution
    const forceDirect = (wantsGitHub && hasGitHub) || wantsApiCall || (wantsTweet && hasTwitter) || (wantsTelegramSend && hasTelegram) || wantsWallet
    console.log(`[chat] Intent: github=${wantsGitHub}(${hasGitHub}), api=${wantsApiCall}${urlMatch ? `(${urlMatch[0].slice(0, 60)})` : ''}, tweet=${wantsTweet}(${hasTwitter}), telegram=${wantsTelegramSend}(${hasTelegram}), forceDirect=${forceDirect}`)

    // ── Check if Railway worker is available ──
    const { getWorkerStatus } = await import('@/lib/agent-worker')
    const workerStatus = await getWorkerStatus(agentId).catch(() => null)

    if (workerStatus && ['idle', 'active', 'processing'].includes(workerStatus.status) && !forceDirect) {
      // Worker is alive and no special handling needed — queue to worker
      console.log(`[chat] Worker active for ${agentId}, queuing to worker`)
      const queuedAt = new Date().toISOString()
      await queueMessage(agentId, 'user', message)

      return NextResponse.json({
        queued: true,
        agent: agentId,
        source: 'worker',
        queuedAt,
        timestamp: new Date().toISOString(),
      })
    }

    // ── Direct MiniMax with tools (no worker, or forced direct handling) ──
    console.log(`[chat] Using direct MiniMax for ${agentId}${forceDirect ? ' (forced direct)' : ''}`)

    // If user wants an API call, pre-fetch the data and inject as context
    let apiContext = ''
    if (wantsApiCall && urlMatch) {
      const apiUrl = urlMatch[0].replace(/[.,;:!?)]+$/, '') // strip trailing punctuation
      console.log(`[chat] Auto-calling API: ${apiUrl}`)

      // Detect if this is a JSON-RPC call (e.g. Sui RPC) and build POST body from context
      const isRpc = /rpc|fullnode|mainnet|testnet/i.test(apiUrl)
      let apiResult: string

      if (isRpc) {
        // Try to infer the RPC method from the user message
        let rpcMethod = 'suix_getLatestSuiSystemState'
        if (/validator/i.test(message)) rpcMethod = 'suix_getLatestSuiSystemState'
        else if (/balance/i.test(message)) rpcMethod = 'suix_getBalance'
        else if (/transaction|tx/i.test(message)) rpcMethod = 'sui_getTotalTransactionBlocks'
        else if (/object/i.test(message)) rpcMethod = 'sui_getObject'

        apiResult = await callApi(apiUrl, 'POST', { 'Content-Type': 'application/json' }, JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: rpcMethod,
          params: [],
        }), agentData.apiKeys)
      } else {
        apiResult = await callApi(apiUrl, undefined, undefined, undefined, agentData.apiKeys)
      }

      if (apiResult && !apiResult.startsWith('Error:')) {
        apiContext = `\n\n[API RESPONSE from ${apiUrl}]:\n${apiResult}\n\nUse this data to answer the user's question. Present the data clearly and concisely. Do NOT tell the user to call the API themselves — you already did it.`
      } else {
        apiContext = `\n\n[API call to ${apiUrl} failed: ${apiResult}]\nTell the user the API call failed and explain the error.`
      }
    }

    const history = await getAgentMessages(agentId)
    const agentWalletInfo = await getAgentWallet(agentId).catch(() => null)
    const systemPrompt = buildSystemPrompt(agent, agentWalletInfo?.address)

    const llmMessages: Array<{ role: string; content: string | null }> = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-MAX_MESSAGES).map(m => ({
        role: m.role === 'agent' ? 'assistant' : 'user',
        content: m.content,
      })),
      { role: 'user', content: message + apiContext },
    ]

    const rawResponse = await callMiniMaxWithTools(llmMessages, agentId, agentData.apiKeys)
    let response = stripThinkTags(rawResponse)

    // ── Auto-push to GitHub if user asked and MiniMax didn't use the tool ──
    console.log(`[chat] Auto-push check: wantsGitHub=${wantsGitHub}, hasGitHub=${hasGitHub}, hasMarker=${response.includes('[[GITHUB:')}`)
    console.log(`[chat] Response preview: ${response.slice(0, 200)}`)
    if (wantsGitHub && hasGitHub && !response.includes('[[GITHUB:')) {
      // Extract repo name from user message (e.g. "as test-repo" or "called my-bot")
      const repoMatch = message.match(/(?:as|called|named|name(?:d)?)\s+["""']?([a-zA-Z0-9_-]+)["""']?/i)
      const repoName = repoMatch?.[1] || 'agent-project'

      // Extract code blocks from the LLM response to use as files
      const codeBlocks: Array<{ path: string; content: string }> = []
      const EXT_MAP: Record<string, string> = { python: '.py', py: '.py', javascript: '.js', js: '.js', typescript: '.ts', ts: '.ts', bash: '.sh', sh: '.sh', json: '.json', html: '.html', css: '.css', yaml: '.yml', toml: '.toml', rust: '.rs', go: '.go', move: '.move', sql: '.sql', md: '.md', markdown: '.md' }

      // Helper: try to find a filename near a code block position in the response
      function guessFilename(pos: number, lang: string, code: string): string {
        // Look for filename patterns in the 200 chars before the code block
        const before = response.slice(Math.max(0, pos - 200), pos)
        // Match patterns like: **hello.py**, `hello.py`, hello.py:, "hello.py"
        const fnMatch = before.match(/(?:\*\*|`|"|')([a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+)(?:\*\*|`|"|'|:)\s*$/m)
        if (fnMatch) return fnMatch[1]
        // Try to infer from code content
        if (code.includes('def ') || code.includes('import ') || code.includes('print(')) return `main${EXT_MAP[lang] || '.py'}`
        if (code.includes('# ') && lang === 'md' || lang === 'markdown') return 'README.md'
        return `file_${codeBlocks.length + 1}${EXT_MAP[lang] || '.txt'}`
      }

      // Skip bash/shell blocks that look like terminal commands (not project files)
      function isTerminalCommands(lang: string, code: string): boolean {
        if (lang !== 'bash' && lang !== 'sh' && lang !== 'shell') return false
        // If it contains git commands, cd, mkdir, pip install, etc. — it's instructions, not a file
        return /^(git |cd |mkdir |pip |npm |echo |gh |curl |brew )/m.test(code.trim())
      }

      // Triple backtick fences
      const tripleRegex = /```(\w*)\n([\s\S]*?)```/g
      let match
      while ((match = tripleRegex.exec(response)) !== null) {
        const lang = match[1] || 'txt'
        const code = match[2].trimEnd()
        if (isTerminalCommands(lang, code)) continue
        const filename = guessFilename(match.index, lang, code)
        codeBlocks.push({ path: filename, content: code })
      }
      // Single backtick fences (MiniMax style)
      if (codeBlocks.length === 0) {
        const singleRegex = /`(\w{2,})\r?\n([\s\S]*?)`/g
        while ((match = singleRegex.exec(response)) !== null) {
          const lang = match[1]
          const code = match[2].trimEnd()
          if (code.split('\n').length < 3) continue
          if (isTerminalCommands(lang, code)) continue
          const filename = guessFilename(match.index, lang, code)
          codeBlocks.push({ path: filename, content: code })
        }
      }
      // Heuristic: detect [[DOWNLOAD:...]] files and fetch them from Redis
      const downloadRegex = /\[\[DOWNLOAD:(file_[a-z0-9_]+)\|([^|]+)\|([^\]]+)\]\]/g
      while ((match = downloadRegex.exec(response)) !== null) {
        const [, fileId, filename] = match
        try {
          const fileRes = await upstashCmd(['GET', `file:${fileId}`])
          if (fileRes?.result) {
            const fileData = typeof fileRes.result === 'string' ? JSON.parse(fileRes.result) : fileRes.result
            if (fileData?.content) {
              codeBlocks.push({ path: filename, content: fileData.content })
            }
          }
        } catch {}
      }

      if (codeBlocks.length > 0) {
        console.log(`[chat] Auto-pushing ${codeBlocks.length} file(s) to GitHub repo: ${repoName}`)
        const pushResult = await pushToGitHub(agentId, repoName, codeBlocks, `Built by ${(agent as any).name} on Odyssey`)
        if (pushResult.includes('[[GITHUB:')) {
          // Extract the marker and append to response
          const ghMarker = pushResult.match(/\[\[GITHUB:[^\]]+\]\]/)?.[0] || ''
          response += `\n\n${ghMarker}`
        } else {
          response += `\n\n⚠️ GitHub push failed: ${pushResult}`
        }
      }
    }

    // ── Auto-tweet if user asked and agent has Twitter connected ──
    if (wantsTweet && hasTwitter) {
      // Extract the tweet text from the LLM response
      // Look for quoted text, or text after "here's the tweet:" patterns, or just use the response
      let tweetText = ''
      const quotedMatch = response.match(/[""\u201C]([^""\u201D]{10,280})[""\u201D]/)
      const afterPattern = response.match(/(?:here(?:'s| is) (?:the|a|your) tweet[:\s]*|tweet[:\s]+)([\s\S]{10,280}?)(?:\n\n|$)/i)

      if (quotedMatch) {
        tweetText = quotedMatch[1].trim()
      } else if (afterPattern) {
        tweetText = afterPattern[1].trim()
      } else {
        // Use first 280 chars of the response, stripping markdown
        tweetText = response.replace(/\*\*/g, '').replace(/#{1,3}\s/g, '').replace(/\[.*?\]\(.*?\)/g, '').trim()
        if (tweetText.length > 280) tweetText = tweetText.slice(0, 277) + '...'
      }

      if (tweetText) {
        const { postTweet: postTweetFn } = await import('@/lib/twitter')
        const tweetResult = await postTweetFn(agentData.twitterConfig, tweetText)
        if (tweetResult.success) {
          response += `\n\n[[TWEET:${tweetResult.tweetUrl || tweetResult.tweetId}|${tweetText.slice(0, 80)}]]`
          console.log(`[chat] Auto-tweeted: ${tweetResult.tweetUrl}`)
        } else {
          response += `\n\n⚠️ Tweet failed: ${tweetResult.error}`
          console.error(`[chat] Auto-tweet failed: ${tweetResult.error}`)
        }
      }
    }

    // ── Auto-send to Telegram channel if user asked ──
    if (wantsTelegramSend && hasTelegram) {
      let tgText = ''
      const quotedMatch = response.match(/[""\u201C]([^""\u201D]{10,4096})[""\u201D]/)
      const afterPattern = response.match(/(?:here(?:'s| is) (?:the|a|your) message[:\s]*|message[:\s]+)([\s\S]{10,4096}?)(?:\n\n|$)/i)

      if (quotedMatch) {
        tgText = quotedMatch[1].trim()
      } else if (afterPattern) {
        tgText = afterPattern[1].trim()
      } else {
        tgText = response.trim()
      }

      if (tgText) {
        const { sendTelegramMessage } = await import('@/lib/telegram-agent')
        const channelIds = agentData.telegramConfig.channelIds ?? []
        const results = await Promise.all(
          channelIds.map(cid => sendTelegramMessage(agentData.telegramConfig, cid, tgText))
        )
        const failed = results.filter(r => !r.success)
        if (failed.length < results.length) {
          response += `\n\n[[TELEGRAM_SENT:${tgText.slice(0, 80)}]]`
          console.log(`[chat] Auto-sent to ${results.length - failed.length}/${results.length} Telegram channels`)
        }
        if (failed.length > 0) {
          response += `\n\n⚠️ Telegram send failed on ${failed.length} channel(s): ${failed.map(r => r.error).join(', ')}`
        }
      }
    }

    // Save response
    await appendAgentMessage(agentId, {
      role: 'agent',
      content: response,
      timestamp: new Date().toISOString(),
    })
    storeMemory(agentId, 'assistant', response).catch(() => {})

    return NextResponse.json({
      message: response,
      agent: agentId,
      source: 'direct',
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('Chat error:', error)
    return NextResponse.json({
      message: 'Something went wrong — try again.',
      agent: agentId,
      timestamp: new Date().toISOString(),
    })
  }
}

// ─── GET: Poll for worker response ──────────────────────────────────────────

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

async function upstashCmd(cmd: string[]): Promise<any> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmd),
    cache: 'no-store',
  })
  if (!res.ok) return null
  return res.json()
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await params
  const { searchParams } = new URL(request.url)
  const since = searchParams.get('since')

  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return NextResponse.json({ message: null, timestamp: null, debug: 'no_upstash_credentials' })
  }

  try {
    // Strategy 1: Check response:agent:{id} (worker writes here after processing)
    const responseResult = await upstashCmd(['GET', `response:agent:${agentId}`])
    if (responseResult?.result) {
      let data: any
      try {
        data = typeof responseResult.result === 'string' ? JSON.parse(responseResult.result) : responseResult.result
      } catch { /* fall through */ }

      if (data?.message) {
        // Check if this response is newer than our queued message
        const isNew = !since || !data.timestamp || new Date(data.timestamp) > new Date(since)
        if (isNew) {
          // Consume it
          await upstashCmd(['DEL', `response:agent:${agentId}`])
          const message = stripThinkTags(data.message)
          if (message) {
            await appendAgentMessage(agentId, {
              role: 'agent',
              content: message,
              timestamp: data.timestamp || new Date().toISOString(),
            })
            return NextResponse.json({ message, timestamp: data.timestamp, source: 'worker-response' })
          }
        }
      }
    }

    // Strategy 2: Check memory:agent:{id} for newest assistant message
    const memResult = await upstashCmd(['LRANGE', `memory:agent:${agentId}`, '0', '0'])
    if (memResult?.result?.length) {
      let newest: any
      try {
        newest = typeof memResult.result[0] === 'string' ? JSON.parse(memResult.result[0]) : memResult.result[0]
      } catch { /* fall through */ }

      if (newest?.role === 'assistant' && newest?.content) {
        const isNew = !since || !newest.timestamp || new Date(newest.timestamp) > new Date(since)
        if (isNew) {
          const message = stripThinkTags(newest.content)
          if (message) {
            await appendAgentMessage(agentId, {
              role: 'agent',
              content: message,
              timestamp: newest.timestamp || new Date().toISOString(),
            })
            return NextResponse.json({ message, timestamp: newest.timestamp, source: 'worker-memory' })
          }
        }
      }
    }

    // No response yet
    return NextResponse.json({ message: null, timestamp: null, debug: 'waiting' })
  } catch (error: any) {
    return NextResponse.json({ message: null, timestamp: null, debug: `exception: ${error.message}` })
  }
}
