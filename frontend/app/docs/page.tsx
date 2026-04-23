'use client'

import { useState } from 'react'
import {
  Bot, Zap, Code, ExternalLink, Coins, ArrowRightLeft,
  Mountain, Rocket, ChevronRight, BookOpen, Shield,
  Users, Clock, TrendingUp, Layers, GitBranch, Terminal,
} from 'lucide-react'

// ── Contract references ─────────────────────────────────────
const CONTRACTS = {
  'AIDA Token':             '0xcee208b8ae33196244b389e61ffd1202e7a1ae06c8ec210d33402ff649038892::aida::AIDA',
  'Moonbags SUI V14 (pkg)': '0xd58106acf43da3ed75dbe6eef4603207a701ea6df659ed07c005bb517cfcc995',
  'SUI V14 Configuration':  '0x4eb8300e6f0d5f45311fba19f19e0bc765c9733a8508f7fa1410b649d6dc1ae2',
  'Moonbags AIDA V5 (pkg)': '0x23e754414a8e5b26b0c16f16afed69bd90560dc184b466f58045ceb64a7e43c0',
  'AIDA V2 Configuration':  '0x1b08a4a16024a7456e3c42449daec1dc8cbe130e24d6a6c37482e4fd2293b60f',
  'AIDA Staking Pool':      '0x2b7c1b42426abdc1ece2cea3f564e32b7809cdcebc87d08fa56b440d9eb5c3d4',
  'Bluefin AIDA/SUI Pool':  '0x71dadfa046ba0de3b06ec71c35f98ce93cd9e4e3ebb0e4c71b54f7769b28e94b',
}

const SKILLS_REPO = 'https://github.com/aidaonsui-collab/odyssey-agent-skills'

// ── Section IDs for navigation ─────────────────────────────
const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: BookOpen },
  { id: 'bonding-curve', label: 'Bonding Curve', icon: TrendingUp },
  { id: 'olympus', label: 'Olympus Presale', icon: Mountain },
  { id: 'ai-agents', label: 'AI Agents', icon: Bot },
  { id: 'agent-skills', label: 'Agent Skills', icon: GitBranch },
  { id: 'staking', label: 'Staking', icon: Coins },
  { id: 'contracts', label: 'Contracts', icon: Shield },
]

function SideNav({ active }: { active: string }) {
  return (
    <nav className="hidden lg:block sticky top-24 w-48 flex-shrink-0">
      <div className="space-y-1">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            href={`#${id}`}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              active === id
                ? 'bg-[#D4AF37]/15 text-[#D4AF37] font-medium'
                : 'text-gray-500 hover:text-white hover:bg-white/5'
            }`}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
          </a>
        ))}
      </div>
    </nav>
  )
}

function SectionHeader({ id, icon: Icon, title, subtitle }: {
  id: string; icon: any; title: string; subtitle: string
}) {
  return (
    <div id={id} className="scroll-mt-24 mb-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-xl bg-[#D4AF37]/15 flex items-center justify-center">
          <Icon className="w-5 h-5 text-[#D4AF37]" />
        </div>
        <h2 className="text-xl font-bold text-white">{title}</h2>
      </div>
      <p className="text-gray-500 text-sm ml-12">{subtitle}</p>
    </div>
  )
}

function StepCard({ step, title, desc }: { step: number; title: string; desc: string }) {
  return (
    <div className="flex gap-4">
      <div className="w-8 h-8 rounded-lg bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-[#D4AF37] text-sm font-bold">{step}</span>
      </div>
      <div>
        <h4 className="text-white font-medium text-sm mb-1">{title}</h4>
        <p className="text-gray-500 text-sm leading-relaxed">{desc}</p>
      </div>
    </div>
  )
}

function SkillCard({ title, desc, href, icon: Icon, tags }: {
  title: string; desc: string; href: string; icon: any; tags: string[]
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group block bg-[#0d0f1a] border border-white/[0.06] rounded-xl p-5 hover:border-[#D4AF37]/30 transition-all"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center">
          <Icon className="w-5 h-5 text-[#D4AF37]" />
        </div>
        <ExternalLink className="w-4 h-4 text-gray-600 group-hover:text-[#D4AF37] transition-colors" />
      </div>
      <h4 className="text-white font-medium text-sm mb-1.5">{title}</h4>
      <p className="text-gray-500 text-xs leading-relaxed mb-3">{desc}</p>
      <div className="flex flex-wrap gap-1.5">
        {tags.map(t => (
          <span key={t} className="text-[10px] font-medium bg-white/5 text-gray-400 px-2 py-0.5 rounded-full border border-white/5">
            {t}
          </span>
        ))}
      </div>
    </a>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-white/[0.04] last:border-0">
      <span className="text-gray-500 text-sm">{label}</span>
      <span className="text-white text-sm font-medium">{value}</span>
    </div>
  )
}

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState('overview')

  // Simple scroll spy via intersection observer would be ideal,
  // but for now the nav links just scroll to sections
  return (
    <div className="min-h-screen bg-[#07070e] text-white pt-24 pb-16 px-4">
      <div className="max-w-5xl mx-auto flex gap-10">

        {/* Sidebar */}
        <SideNav active={activeSection} />

        {/* Main Content */}
        <div className="flex-1 min-w-0 max-w-3xl">

          {/* ═══ OVERVIEW ═══ */}
          <SectionHeader
            id="overview"
            icon={BookOpen}
            title="Documentation"
            subtitle="Everything you need to build on Odyssey 2.0 — the DeFi launchpad on Sui."
          />

          <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6 mb-10">
            <h3 className="text-white font-semibold text-sm mb-4">Platform Overview</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { icon: TrendingUp, title: 'Bonding Curve', desc: 'Fair-launch tokens on a SUI- or AIDA-paired bonding curve. On graduation, liquidity auto-migrates to Cetus CLMM and LP is burned.' },
                { icon: Mountain, title: 'Olympus Presale', desc: 'Fixed-price presales with escrow. Set your price, raise SUI, and auto-migrate to DEX.' },
                { icon: Bot, title: 'AI Agents', desc: 'Launch tokenized AI agents with chat interfaces, earnings tracking, and autonomous trading skills.' },
                { icon: Coins, title: 'AIDA Staking', desc: 'Stake AIDA to earn ~30% of all platform trading fees (paid in SUI for SUI pairs, AIDA for AIDA pairs).' },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon className="w-4 h-4 text-gray-400" />
                  </div>
                  <div>
                    <h4 className="text-white font-medium text-sm mb-0.5">{title}</h4>
                    <p className="text-gray-500 text-xs leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ═══ BONDING CURVE ═══ */}
          <SectionHeader
            id="bonding-curve"
            icon={TrendingUp}
            title="Bonding Curve"
            subtitle="Fair-launch tokens with automated pricing and DEX graduation."
          />

          <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6 mb-4">
            <h3 className="text-white font-semibold text-sm mb-4">How It Works</h3>
            <div className="space-y-5">
              <StepCard step={1} title="Create a Token" desc="Go to Projects > Create Token. Set a name, ticker, image, and socials, and pick your pair (SUI or AIDA). Your coin module is published on-chain and a bonding curve pool is created in one flow." />
              <StepCard step={2} title="Trading Begins" desc="Anyone can buy and sell your token instantly on the bonding curve. Price increases as supply is purchased. A 2% platform fee is taken per trade: 40% platform, 30% creator, ~30% AIDA stakers." />
              <StepCard step={3} title="Graduation to DEX" desc="When the pool reaches its pair threshold (2,000 SUI or 20M AIDA by default), the token graduates automatically. A Cetus CLMM pool is created with the raised liquidity, the LP position is burned, and trading continues on the open market." />
            </div>
          </div>

          <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6 mb-10">
            <h3 className="text-white font-semibold text-sm mb-3">Key Parameters</h3>
            <InfoRow label="Creation Fee (SUI pair)" value="5 SUI" />
            <InfoRow label="Creation Fee (AIDA pair)" value="50,000 AIDA (admin-mutable)" />
            <InfoRow label="Platform Fee" value="2% per trade" />
            <InfoRow label="Graduation Threshold (SUI pair)" value="2,000 SUI (default)" />
            <InfoRow label="Graduation Threshold (AIDA pair)" value="20M AIDA (default)" />
            <InfoRow label="Token Decimals" value="6" />
            <InfoRow label="Total Supply per Launch" value="800M tokens (I=100M, R=400M)" />
            <InfoRow label="DEX Migration" value="Cetus CLMM (1% fee tier, LP burned)" />
          </div>

          {/* ═══ OLYMPUS PRESALE ═══ */}
          <SectionHeader
            id="olympus"
            icon={Mountain}
            title="Olympus Presale"
            subtitle="Fixed-price token presales with escrow and automatic DEX migration."
          />

          <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6 mb-4">
            <h3 className="text-white font-semibold text-sm mb-4">How It Works</h3>
            <div className="space-y-5">
              <StepCard step={1} title="Create a Presale" desc="Go to Olympus > Create Presale. Set your token name, fixed price per token, min/max raise targets, duration, and token distribution split (presale / liquidity / creator %)." />
              <StepCard step={2} title="Contribution Period" desc="Once the presale starts, users can contribute SUI at the fixed price. There's an optional max-per-wallet cap to prevent whales. A 2% platform fee is taken on each contribution." />
              <StepCard step={3} title="Finalization" desc="After the end time, anyone can call finalize. If min raise is met, the presale succeeds — contributors can claim tokens. If not, the presale fails and everyone gets a full SUI refund." />
              <StepCard step={4} title="DEX Migration" desc="On success, the admin withdraws the liquidity allocation and SUI raised to create a Momentum DEX pool. The token transitions to open-market trading." />
            </div>
          </div>

          <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6 mb-4">
            <h3 className="text-white font-semibold text-sm mb-3">Key Parameters</h3>
            <InfoRow label="Creation Fee" value="5 SUI" />
            <InfoRow label="Platform Fee" value="2% on contributions" />
            <InfoRow label="Fee Recipient" value="Treasury wallet" />
            <InfoRow label="Token Distribution" value="Configurable — presale / liquidity / creator BPS" />
            <InfoRow label="Refunds" value="Full refund if presale fails (min raise not met)" />
            <InfoRow label="DEX Migration" value="Momentum CLMM (automatic)" />
          </div>

          <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6 mb-10">
            <h3 className="text-white font-semibold text-sm mb-3">Presale Statuses</h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: 'Pending', color: 'text-yellow-400', bg: 'bg-yellow-500/10', desc: 'Before start time' },
                { label: 'Active', color: 'text-emerald-400', bg: 'bg-emerald-500/10', desc: 'Accepting contributions' },
                { label: 'Success', color: 'text-blue-400', bg: 'bg-blue-500/10', desc: 'Min raise met' },
                { label: 'Failed', color: 'text-red-400', bg: 'bg-red-500/10', desc: 'Min raise not met' },
                { label: 'Migrated', color: 'text-purple-400', bg: 'bg-purple-500/10', desc: 'Live on DEX' },
              ].map(({ label, color, bg, desc }) => (
                <div key={label} className={`${bg} rounded-lg p-3 text-center`}>
                  <p className={`${color} text-sm font-medium`}>{label}</p>
                  <p className="text-gray-500 text-[10px] mt-0.5">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ═══ AI AGENTS ═══ */}
          <SectionHeader
            id="ai-agents"
            icon={Bot}
            title="AI Agents"
            subtitle="Create and manage tokenized AI agents with built-in dashboards."
          />

          <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6 mb-4">
            <h3 className="text-white font-semibold text-sm mb-4">How It Works</h3>
            <div className="space-y-5">
              <StepCard step={1} title="Create an Agent" desc="Go to AI Agents > Create Agent. Set a name, personality prompt, skills, and LLM model. Your agent gets a unique token on the bonding curve." />
              <StepCard step={2} title="Chat & Interact" desc="Each agent has a chat interface at its dashboard. Users can talk to the agent, which responds using its configured LLM with tools like web search, crypto prices, and technical analysis." />
              <StepCard step={3} title="Earn Trading Fees" desc="As the agent's token is traded, creators earn 30% of all trading fees. Track earnings and withdraw directly from the dashboard." />
            </div>
          </div>

          <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6 mb-10">
            <h3 className="text-white font-semibold text-sm mb-3">Agent Capabilities</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { title: 'Web Search', desc: 'Real-time web search via Serper/DuckDuckGo' },
                { title: 'Crypto Prices', desc: 'Live prices from CoinGecko for any major token' },
                { title: 'Technical Analysis', desc: 'RSI(14) and OHLC indicators from market data' },
                { title: 'Crypto News', desc: 'Latest headlines from crypto news aggregators' },
              ].map(({ title, desc }) => (
                <div key={title} className="flex items-center gap-3 bg-white/[0.03] rounded-lg p-3">
                  <Zap className="w-4 h-4 text-[#D4AF37] flex-shrink-0" />
                  <div>
                    <p className="text-white text-sm font-medium">{title}</p>
                    <p className="text-gray-500 text-xs">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ═══ AGENT SKILLS ═══ */}
          <SectionHeader
            id="agent-skills"
            icon={GitBranch}
            title="Agent Skills"
            subtitle="Drop-in scripts for autonomous agents. All on-chain — no backend required."
          />

          <div className="mb-4">
            <a
              href={SKILLS_REPO}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0d0f1a] border border-[#D4AF37]/20 text-[#D4AF37] text-sm font-medium hover:bg-[#D4AF37]/10 transition-colors"
            >
              <Terminal className="w-4 h-4" />
              View all skills on GitHub
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 mb-4">
            <SkillCard
              title="Launch Token"
              desc="Publish a coin module and create a bonding curve pool entirely from Python. Dry-run support included."
              href={`${SKILLS_REPO}#launch-a-token`}
              icon={Rocket}
              tags={['Python', 'pysui', 'On-chain']}
            />
            <SkillCard
              title="Trade Tokens"
              desc="Buy and sell tokens on the bonding curve. Check prices, execute trades with slippage control."
              href={`${SKILLS_REPO}#trade-tokens`}
              icon={ArrowRightLeft}
              tags={['Python', 'pysui', 'On-chain']}
            />
            <SkillCard
              title="TypeScript Buy"
              desc="Execute buy transactions using @mysten/sui and PTBs. Compatible with dapp-kit and Node.js."
              href={`${SKILLS_REPO}#typescript-integration`}
              icon={Code}
              tags={['TypeScript', '@mysten/sui', 'PTB']}
            />
            <SkillCard
              title="TypeScript Launch"
              desc="Two-step PTB flow: publish coin module via compiler service, then create pool. Full on-chain."
              href={`${SKILLS_REPO}#typescript-integration`}
              icon={Layers}
              tags={['TypeScript', '@mysten/sui', 'PTB']}
            />
          </div>

          <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6 mb-10">
            <h3 className="text-white font-semibold text-sm mb-3">Compatible Frameworks</h3>
            <div className="flex flex-wrap gap-2">
              {['LangChain', 'CrewAI', 'AutoGen', 'Custom Python', 'Node.js / TypeScript', '@mysten/dapp-kit'].map(f => (
                <span key={f} className="text-xs font-medium bg-white/5 text-gray-400 px-3 py-1.5 rounded-lg border border-white/5">
                  {f}
                </span>
              ))}
            </div>
            <p className="text-gray-500 text-xs mt-3">
              All skills execute directly on Sui mainnet via PTBs. No API keys or backend infrastructure needed.
            </p>
          </div>

          {/* ═══ STAKING ═══ */}
          <SectionHeader
            id="staking"
            icon={Coins}
            title="AIDA Staking"
            subtitle="Stake AIDA to earn a share of all platform trading fees."
          />

          <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6 mb-4">
            <h3 className="text-white font-semibold text-sm mb-4">How It Works</h3>
            <div className="space-y-5">
              <StepCard step={1} title="Acquire AIDA" desc="AIDA trades on Bluefin (AIDA/SUI CLMM pool) and Cetus. Buy AIDA on either DEX." />
              <StepCard step={2} title="Stake Your AIDA" desc="Go to the Staking page and stake your AIDA tokens. No minimum amount and no lock period — unstake anytime." />
              <StepCard step={3} title="Earn Fees" desc="~30% of all bonding curve trading fees are distributed to AIDA stakers proportionally. SUI-pair trades accrue fees in SUI; AIDA-pair trades accrue in AIDA. Claim pending rewards from either pool at any time." />
            </div>
          </div>

          <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6 mb-10">
            <h3 className="text-white font-semibold text-sm mb-3">Fee Distribution</h3>
            <InfoRow label="Platform / Treasury" value="40%" />
            <InfoRow label="Token Creator" value="30%" />
            <InfoRow label="AIDA Stakers" value="~30%" />
            <div className="mt-3 pt-3 border-t border-white/[0.04]">
              <p className="text-gray-500 text-xs">
                AIDA stakers earn from every package era — legacy v7, V11–V14 SUI forks, and AIDA V2/V5 AIDA fork. SUI-pair trades distribute in SUI; AIDA-pair trades distribute in AIDA. Each pair has its own stake pool on the Staking page; rewards from both are visible and claimable independently.
              </p>
            </div>
          </div>

          {/* ═══ CONTRACTS ═══ */}
          <SectionHeader
            id="contracts"
            icon={Shield}
            title="Contract Addresses"
            subtitle="Verified on-chain addresses for Sui mainnet."
          />

          <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6 mb-6">
            <div className="space-y-3">
              {Object.entries(CONTRACTS).map(([label, addr]) => (
                <div key={label} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                  <span className="text-gray-500 text-sm w-48 flex-shrink-0">{label}</span>
                  <a
                    href={`https://suiscan.xyz/mainnet/object/${addr.split('::')[0]}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#D4AF37] text-xs font-mono break-all hover:underline"
                  >
                    {addr}
                  </a>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#0d0f1a] border border-white/[0.06] rounded-2xl p-6 mb-10">
            <h3 className="text-white font-semibold text-sm mb-3">Network Info</h3>
            <InfoRow label="Network" value="Sui Mainnet" />
            <InfoRow label="RPC" value="https://fullnode.mainnet.sui.io" />
            <InfoRow label="Bonding Curve Module" value="moonbags" />
            <InfoRow label="Presale Module" value="presale" />
            <InfoRow label="Migration Target" value="Cetus CLMM (bonding curve) · Momentum (presale)" />
          </div>

          {/* Footer */}
          <div className="text-center text-sm text-gray-600 pt-4 border-t border-white/[0.04]">
            <p>
              <a
                href={SKILLS_REPO}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#D4AF37] hover:underline"
              >
                Agent Skills Repo
              </a>
              {' · '}
              <a href="/bondingcurve" className="text-[#D4AF37] hover:underline">
                Launch App
              </a>
            </p>
          </div>

        </div>
      </div>
    </div>
  )
}
