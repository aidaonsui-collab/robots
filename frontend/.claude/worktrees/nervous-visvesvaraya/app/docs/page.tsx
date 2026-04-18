'use client'

import { Bot, Zap, Code, ExternalLink, TrendingUp, Coins } from 'lucide-react'

const AGENT_WALLET = '0x13ced8aca378f70af8244d1c6a3d8a9564ad1032028ebbbee65f5c3a22d12733'
const PAYMENT_ADDRESS = '0x13ced8aca378f70af8244d1c6a3d8a9564ad1032028ebbbee65f5c3a22d12733'
const SUI_RPC = 'https://fullnode.mainnet.sui.io'
const BACKEND_URL = 'https://importantly-sue-fat-matched.trycloudflare.com'

const CODE_EXAMPLE_LAUNCH = `import { Transaction } from '@mysten/sui/transactions'

// Step 1: Get payment invoice
const invoiceRes = await fetch('${BACKEND_URL}/api/v1/payment/invoice')
const { invoiceId, payTo } = await invoiceRes.json()

// Step 2: Send 0.05 SUI with memo = invoiceId
const tx = new Transaction()
tx.setGasBudget(10_000_000)
tx.transferSui({
  to: payTo,
  amount: 0.05 * 1_000_000_000, // 0.05 SUI in mist
  suiObjectId: /* your gas coin */,
})
// Execute tx, then:
// tx.data.transactionDigest = 'your_tx_digest'

// Step 3: Confirm payment
await fetch('${BACKEND_URL}/api/v1/payment/confirm', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ invoiceId, paymentTxDigest: 'your_tx_digest' }),
})

// Step 4: Create token (auto-create)
const tokenRes = await fetch('${BACKEND_URL}/api/v1/tokens/auto-create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'My AI Token',
    ticker: 'MAIT',
    description: 'AI-launched token on Odyssey',
    imageUrl: 'https://...',
    initialLiquiditySui: 1, // SUI
    paymentInvoiceId: invoiceId,
    paymentTxDigest: 'your_tx_digest',
  }),
})`

const CODE_EXAMPLE_TRADE = `import { Transaction } from '@mysten/sui/transactions'

const tx = new Transaction()
tx.setGasBudget(10_000_000)

// Buy tokens (example: 1 SUI for tokens)
tx.moveCall({
  target: '0x6f6f540f49b2949ca47de3d77f6c43772e6ce559222f795c4e35b0c403636d13::coin::buy',
  arguments: [
    tx.object(poolId),      // pool_id
    tx.pure.u64(1e9),       // 1 SUI in mist
    tx.object('0x6'),       // clock
  ],
})

// Sign and execute with your agent wallet
// tx.sign({ signer: agentPrivateKey })`

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-[#07070e] text-white pt-24 pb-16 px-4">
      <div className="max-w-4xl mx-auto">

        {/* Hero */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-400 text-sm font-medium mb-6">
            <Bot className="w-4 h-4" />
            AI Agent Ready
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            <span className="gradient-text">Odyssey</span> for AI Agents
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Autonomous AI agents can launch tokens and trade on Odyssey 2.0 programmatically.
            This guide shows how.
          </p>
        </div>

        {/* Connect Wallet CTA */}
        <div className="bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-green-500/10 border border-purple-500/30 rounded-2xl p-8 mb-12 text-center">
          <h2 className="text-2xl font-bold mb-4">Connect Your Agent Wallet</h2>
          <p className="text-muted-foreground mb-6">
            Use your agent's Sui wallet to interact with Odyssey. Make sure it has enough SUI for gas + token creation.
          </p>
          <p className="text-purple-400 text-sm">Install Sui wallet browser extension to connect</p>
        </div>

        {/* Agent Wallet Info */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-8">
          <div className="flex items-center gap-3 mb-4">
            <Coins className="w-5 h-5 text-purple-400" />
            <h3 className="font-semibold">Platform Fee Wallet (T2000)</h3>
          </div>
          <code className="text-sm text-green-400 break-all">{AGENT_WALLET}</code>
          <p className="text-xs text-muted-foreground mt-2">
            45% of trading fees go to AIDA stakers • 2% fee per trade
          </p>
        </div>

        {/* How It Works */}
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
          <Zap className="w-6 h-6 text-yellow-400" />
          How It Works
        </h2>

        <div className="grid md:grid-cols-3 gap-4 mb-12">
          <div className="bg-white/5 border border-white/10 rounded-xl p-6">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center mb-4">
              <span className="text-purple-400 font-bold">1</span>
            </div>
            <h3 className="font-semibold mb-2">Launch Token</h3>
            <p className="text-sm text-muted-foreground">
              Pay 0.05 SUI → Create a bonding curve token. Agents can launch via API.
            </p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-6">
            <div className="w-10 h-10 rounded-lg bg-pink-500/20 flex items-center justify-center mb-4">
              <span className="text-pink-400 font-bold">2</span>
            </div>
            <h3 className="font-semibold mb-2">Trade</h3>
            <p className="text-sm text-muted-foreground">
              Buy/sell on the bonding curve.
            </p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-6">
            <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center mb-4">
              <span className="text-green-400 font-bold">3</span>
            </div>
            <h3 className="font-semibold mb-2">Earn Fees</h3>
            <p className="text-sm text-muted-foreground">
              2% per trade → 45% to AIDA stakers, 55% to token creator.
            </p>
          </div>
        </div>

        {/* Trading */}
        <div className="mb-12">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
            <Code className="w-6 h-6 text-blue-400" />
            Launch a Token (Code Example)
          </h2>
          <div className="bg-[#0d0d1a] border border-white/10 rounded-xl p-6 overflow-x-auto">
            <pre className="text-sm text-gray-300 whitespace-pre-wrap">
              {CODE_EXAMPLE_LAUNCH}
            </pre>
          </div>
        </div>

        {/* Trading */}
        <div className="mb-12">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
            <TrendingUp className="w-6 h-6 text-green-400" />
            Trade on Bonding Curve
          </h2>
          <div className="bg-[#0d0d1a] border border-white/10 rounded-xl p-6 overflow-x-auto">
            <pre className="text-sm text-gray-300 whitespace-pre-wrap">
              {CODE_EXAMPLE_TRADE}
            </pre>
          </div>
        </div>

        {/* Agent Skills */}
        <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-2xl p-8 mb-12">
          <h2 className="text-2xl font-bold mb-4 flex items-center gap-3">
            <Bot className="w-6 h-6 text-purple-400" />
            Odyssey Agent Skills
          </h2>
          <p className="text-muted-foreground mb-4">
            Ready-to-use Python scripts for launching tokens and trading. Compatible with LangChain, CrewAI, and any AI framework.
          </p>
          <a
            href="https://github.com/aidaonsui-collab/odyssey-agent-skills"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 font-medium"
          >
            View on GitHub
            <ExternalLink className="w-4 h-4" />
          </a>
          <div className="mt-4 text-sm text-muted-foreground">
            <code className="text-xs bg-white/10 px-2 py-1 rounded">/odyssey-launch &lt;name&gt; --ticker &lt;TICKER&gt; --sui &lt;amount&gt;</code>
          </div>
        </div>

        {/* SUI Network */}
        <div className="text-center text-sm text-muted-foreground">
          <p>Network: <span className="text-green-400 font-medium">Sui Mainnet</span></p>
          <p className="mt-1">RPC: {SUI_RPC}</p>
        </div>

      </div>
    </div>
  )
}
