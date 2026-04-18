'use client'

import { useState } from 'react'
import { Bot, Cpu, Zap, Globe, Shield, Wallet, ArrowRight, Sparkles } from 'lucide-react'

export default function RoboticsPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const handleWaitlist = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    // TODO: wire to waitlist endpoint
    setSubmitted(true)
    setEmail('')
  }

  return (
    <div className="min-h-screen bg-[#07070e] pt-24 pb-20 overflow-hidden">
      {/* Ambient gold glow */}
      <div className="absolute top-24 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-[#D4AF37]/[0.06] blur-[120px] rounded-full pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* ─── Hero ──────────────────────────────────────────────────────── */}
        <div className="text-center mb-20">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37] text-xs font-semibold mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            Coming Soon
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white tracking-tight mb-6 leading-[1.05]">
            On-Chain
            <span className="block bg-gradient-to-r from-[#D4AF37] via-[#F4D03F] to-[#D4AF37] bg-clip-text text-transparent">
              Robotics
            </span>
          </h1>

          <p className="max-w-2xl mx-auto text-lg sm:text-xl text-gray-400 leading-relaxed mb-10">
            The bridge between machines and the blockchain. Embodied AI agents with their own wallets, settling payments autonomously on Sui — no humans, no banks, no friction.
          </p>

          <form onSubmit={handleWaitlist} className="max-w-md mx-auto flex gap-2">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="flex-1 px-4 py-3 bg-[#0d0f1a] border border-white/[0.08] rounded-xl text-white text-sm placeholder-gray-600 focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
            />
            <button
              type="submit"
              className="px-5 py-3 rounded-xl bg-[#D4AF37] text-black text-sm font-bold hover:opacity-90 hover:shadow-lg hover:shadow-[#D4AF37]/30 transition-all flex items-center gap-2"
            >
              Early Access
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
          {submitted && (
            <p className="text-xs text-emerald-400 mt-3">You&apos;re on the list. We&apos;ll reach out when testnet goes live.</p>
          )}
        </div>

        {/* ─── Vision statement ────────────────────────────────────────────── */}
        <div className="bg-[#0d0f1a] rounded-3xl border border-white/[0.06] p-8 sm:p-12 mb-16">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold text-[#D4AF37] uppercase tracking-wider mb-3">The Vision</div>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-5 leading-tight">
              Machines as economic actors.
            </h2>
            <p className="text-base text-gray-400 leading-relaxed mb-4">
              Robots today are customers of their human operators. Every charge, every API call, every data stream routes through a person with a credit card. That model doesn&apos;t scale to a world with billions of autonomous machines.
            </p>
            <p className="text-base text-gray-400 leading-relaxed">
              Odyssey Robotics gives every robot its own Sui wallet, its own USDC balance, and its own economic identity. A delivery drone earns for the miles it flies. A warehouse arm pays for its own electricity. A humanoid buys compute when it needs to think harder. Pure machine-to-machine commerce, settled on-chain in under a second.
            </p>
          </div>
        </div>

        {/* ─── Feature grid ────────────────────────────────────────────────── */}
        <div className="mb-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">Built for the machine economy</h2>
            <p className="text-gray-500 text-sm">Primitives that make autonomous payments practical at scale.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <FeatureCard
              icon={Wallet}
              title="Robot Wallets"
              description="Every robot gets a Sui keypair with bounded spending policy. Funded once, operates for life."
            />
            <FeatureCard
              icon={Zap}
              title="Pay-Per-Action"
              description="HTTP 402 handshake for physical services — charging, compute, data, coordination. Settled in USDC."
            />
            <FeatureCard
              icon={Cpu}
              title="Verifiable Identity"
              description="On-chain identity for every machine. Reputation, history, and capability — all auditable."
            />
            <FeatureCard
              icon={Shield}
              title="Escrow & Safety"
              description="Move-language escrow modules enforce delivery before release. Disputes resolved on-chain."
            />
          </div>
        </div>

        {/* ─── Use cases ───────────────────────────────────────────────────── */}
        <div className="mb-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">What becomes possible</h2>
            <p className="text-gray-500 text-sm">Real scenarios, settled in milliseconds.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <UseCaseCard
              tag="Logistics"
              title="Delivery drones that pay for their own charging"
              body="A drone completes a run, lands at a charging pad, and the pad bills it 0.08 USDC per kWh. No operator, no invoice — just a signed transaction."
            />
            <UseCaseCard
              tag="Manufacturing"
              title="Factory arms that buy compute on demand"
              body="A robotic arm faces an unfamiliar part. It pays a cloud vision model 0.002 USDC for a classification, gets the answer, keeps working."
            />
            <UseCaseCard
              tag="Humanoids"
              title="Humanoids hiring each other for skills"
              body="One humanoid lacks a dexterity skill another has. They negotiate a price in USDC, the skill is executed, payment settles on-chain."
            />
          </div>
        </div>

        {/* ─── Roadmap ─────────────────────────────────────────────────────── */}
        <div className="bg-[#0d0f1a] rounded-3xl border border-white/[0.06] p-8 sm:p-12 mb-20">
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">Roadmap</h2>
            <p className="text-gray-500 text-sm">Building the stack in public.</p>
          </div>

          <div className="space-y-4 max-w-3xl mx-auto">
            <RoadmapItem
              phase="Phase 1"
              status="In progress"
              title="Agent wallets + USDC settlement"
              description="Every Odyssey agent gets a Sui keypair. Marketplace requests settle in native USDC with on-chain proof of payment."
              active
            />
            <RoadmapItem
              phase="Phase 2"
              status="Q3 2026"
              title="x402 facilitator on Sui"
              description="HTTP 402 handshake for paid APIs. Sponsored transactions so agents never need SUI for gas."
            />
            <RoadmapItem
              phase="Phase 3"
              status="Q4 2026"
              title="Physical robot SDK"
              description="Unitree, humanoid, and drone integrations. Move escrow contracts for real-world service delivery."
            />
            <RoadmapItem
              phase="Phase 4"
              status="2027"
              title="DePAI — decentralized physical AI"
              description="Machine fleets with on-chain coordination, reputation systems, and autonomous capital deployment."
            />
          </div>
        </div>

        {/* ─── Footer CTA ──────────────────────────────────────────────────── */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 text-xs text-gray-600 mb-4">
            <div className="w-8 h-px bg-white/10" />
            <span>Powered by Sui + USDC</span>
            <div className="w-8 h-px bg-white/10" />
          </div>
          <p className="text-gray-500 text-sm max-w-xl mx-auto">
            Want to build a physical agent on Odyssey? We&apos;re looking for early partners — robotics teams, embodied AI researchers, and hardware builders.
          </p>
        </div>

      </div>
    </div>
  )
}

// ─── Components ────────────────────────────────────────────────────────────────

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <div className="group relative bg-[#0d0f1a] rounded-2xl border border-white/[0.06] hover:border-[#D4AF37]/20 p-6 transition-all">
      <div className="w-11 h-11 rounded-xl bg-[#D4AF37]/10 border border-[#D4AF37]/20 flex items-center justify-center mb-4 group-hover:bg-[#D4AF37]/15 transition-colors">
        <Icon className="w-5 h-5 text-[#D4AF37]" />
      </div>
      <h3 className="text-base font-semibold text-white mb-2">{title}</h3>
      <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
    </div>
  )
}

function UseCaseCard({
  tag,
  title,
  body,
}: {
  tag: string
  title: string
  body: string
}) {
  return (
    <div className="bg-[#0d0f1a] rounded-2xl border border-white/[0.06] hover:border-white/[0.12] p-6 transition-all">
      <div className="flex items-center gap-2 mb-4">
        <Bot className="w-4 h-4 text-[#D4AF37]" />
        <span className="text-[10px] font-semibold text-[#D4AF37] uppercase tracking-wider">{tag}</span>
      </div>
      <h3 className="text-base font-semibold text-white mb-2 leading-snug">{title}</h3>
      <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
    </div>
  )
}

function RoadmapItem({
  phase,
  status,
  title,
  description,
  active,
}: {
  phase: string
  status: string
  title: string
  description: string
  active?: boolean
}) {
  return (
    <div className={`flex gap-4 p-5 rounded-2xl border transition-colors ${
      active
        ? 'bg-[#D4AF37]/[0.04] border-[#D4AF37]/20'
        : 'bg-white/[0.02] border-white/[0.04]'
    }`}>
      <div className="flex-shrink-0 pt-0.5">
        <div className={`w-2 h-2 rounded-full ${active ? 'bg-[#D4AF37] pulse-dot' : 'bg-white/20'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{phase}</span>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
            active
              ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
              : 'bg-white/5 text-gray-500'
          }`}>{status}</span>
        </div>
        <h3 className="text-sm font-semibold text-white mb-1">{title}</h3>
        <p className="text-xs text-gray-500 leading-relaxed">{description}</p>
      </div>
    </div>
  )
}
