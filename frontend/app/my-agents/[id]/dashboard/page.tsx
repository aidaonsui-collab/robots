'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useCurrentAccount, useSignPersonalMessage } from '@mysten/dapp-kit'
import {
  ArrowLeft, Send, Edit, Pause, Play, Square, DollarSign,
  Activity, BarChart3, Settings, MessageSquare, Zap, CreditCard, Github, ExternalLink,
  Sparkles, Bot, Save, RotateCcw, Trash2, ChevronDown, Globe, Brain, Cpu, Hash,
  MessageCircle, X, Check, AlertTriangle, Download, Key, Plus, Shield, TrendingUp,
  Store, Package, Clock, Wallet, Loader2
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { signAuthEnvelope } from '@/lib/auth-sign-client'

interface Message {
  id: string
  sender: 'user' | 'agent'
  message: string
  timestamp: Date
}

// ─── Avatar Helper ──────────────────────────────────────────────────────────
function hasValidAvatar(url: string | undefined | null): boolean {
  return !!url && url.startsWith('http')
}

// ─── Simple Markdown Renderer ────────────────────────────────────────────────
function renderMarkdown(text: string) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let listItems: string[] = []
  let listType: 'ul' | 'ol' | null = null

  const flushList = () => {
    if (listItems.length > 0 && listType) {
      const Tag = listType
      elements.push(
        <Tag key={`list-${elements.length}`} className={listType === 'ul' ? 'list-disc list-inside space-y-1 my-2' : 'list-decimal list-inside space-y-1 my-2'}>
          {listItems.map((item, i) => <li key={i}>{inlineMarkdown(item)}</li>)}
        </Tag>
      )
      listItems = []
      listType = null
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Headers
    if (line.startsWith('### ')) {
      flushList()
      elements.push(<h4 key={i} className="text-sm font-bold text-white mt-3 mb-1">{inlineMarkdown(line.slice(4))}</h4>)
      continue
    }
    if (line.startsWith('## ')) {
      flushList()
      elements.push(<h3 key={i} className="text-base font-bold text-white mt-3 mb-1">{inlineMarkdown(line.slice(3))}</h3>)
      continue
    }

    // Unordered list
    if (/^[-*]\s/.test(line)) {
      if (listType !== 'ul') flushList()
      listType = 'ul'
      listItems.push(line.replace(/^[-*]\s/, ''))
      continue
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      if (listType !== 'ol') flushList()
      listType = 'ol'
      listItems.push(line.replace(/^\d+\.\s/, ''))
      continue
    }

    flushList()

    // Empty line
    if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />)
      continue
    }

    // Regular paragraph
    elements.push(<p key={i} className="leading-relaxed">{inlineMarkdown(line)}</p>)
  }

  flushList()
  return <>{elements}</>
}

function inlineMarkdown(text: string): React.ReactNode {
  // Bold, italic, inline code
  const parts: React.ReactNode[] = []
  const regex = /(\*\*(.+?)\*\*)|(`(.+?)`)|(\*(.+?)\*)/g
  let lastIndex = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    if (match[1]) {
      parts.push(<strong key={match.index} className="font-bold text-white">{match[2]}</strong>)
    } else if (match[3]) {
      parts.push(<code key={match.index} className="px-1.5 py-0.5 bg-white/10 rounded text-[#D4AF37] text-xs font-mono">{match[4]}</code>)
    } else if (match[5]) {
      parts.push(<em key={match.index} className="italic">{match[6]}</em>)
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? <>{parts}</> : text
}

// ─── File Download Support ──────────────────────────────────────────────────

interface CodeBlock {
  language: string
  code: string
}

function extractCodeBlocks(text: string): { cleanText: string; blocks: CodeBlock[] } {
  const blocks: CodeBlock[] = []
  let cleanText = text

  // 1. Triple-backtick fences (standard markdown)
  cleanText = cleanText.replace(/```(\w*)\r?\n([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push({ language: lang || 'txt', code: code.trimEnd() })
    return `[[CODEBLOCK:${blocks.length - 1}]]`
  })

  // 2. Single-backtick with language tag + multiline code (MiniMax style: `python\n...\n`)
  cleanText = cleanText.replace(/`(\w{2,})\r?\n([\s\S]*?)`/g, (match, lang, code) => {
    if (code.trim().split('\n').length < 3) return match
    blocks.push({ language: lang, code: code.trimEnd() })
    return `[[CODEBLOCK:${blocks.length - 1}]]`
  })

  // 3. Heuristic: detect code-like blocks not already captured
  //    Looks for consecutive lines that look like code (indented, or starting with keywords)
  if (blocks.length === 0) {
    const CODE_SIGNALS = /^(import |from |def |class |function |const |let |var |export |#!|# |\/\/|module |use |pub |fn |async |return |if |for |while |print|console\.|package )/
    const lines = cleanText.split('\n')
    let codeStart = -1
    let codeLines: string[] = []

    const flushCode = (endIdx: number) => {
      if (codeLines.length >= 4) {
        // Guess language from first meaningful line
        const first = codeLines.find(l => l.trim()) || ''
        let lang = 'txt'
        if (/^(import |from |def |class |print)/.test(first.trim())) lang = 'python'
        else if (/^(const |let |var |function |export |import |console\.)/.test(first.trim())) lang = 'javascript'
        else if (/^(use |pub |fn |mod )/.test(first.trim())) lang = 'rust'
        else if (/^(package |func )/.test(first.trim())) lang = 'go'
        else if (/^(module |public )/.test(first.trim())) lang = 'move'
        else if (/^#!/.test(first.trim())) lang = 'bash'

        blocks.push({ language: lang, code: codeLines.join('\n').trimEnd() })
        // Replace in lines array
        for (let i = codeStart; i < endIdx; i++) {
          lines[i] = i === codeStart ? `[[CODEBLOCK:${blocks.length - 1}]]` : '[[CODEBLOCK_REMOVE]]'
        }
      }
      codeLines = []
      codeStart = -1
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()
      const isCode = CODE_SIGNALS.test(trimmed) || (trimmed.length > 0 && (line.startsWith('  ') || line.startsWith('\t')))

      if (isCode) {
        if (codeStart === -1) codeStart = i
        codeLines.push(line)
      } else if (trimmed === '' && codeLines.length > 0) {
        // Allow blank lines within code
        codeLines.push(line)
      } else {
        flushCode(i)
      }
    }
    flushCode(lines.length)

    if (blocks.length > 0) {
      cleanText = lines.filter(l => l !== '[[CODEBLOCK_REMOVE]]').join('\n')
    }
  }

  return { cleanText, blocks }
}

const LANG_EXT: Record<string, string> = {
  python: '.py', py: '.py', javascript: '.js', js: '.js', typescript: '.ts', ts: '.ts',
  json: '.json', bash: '.sh', sh: '.sh', shell: '.sh', sql: '.sql', html: '.html',
  css: '.css', yaml: '.yml', yml: '.yml', toml: '.toml', rust: '.rs', go: '.go',
  move: '.move', markdown: '.md', md: '.md', csv: '.csv', txt: '.txt',
}

function CodeBlockWithDownload({ block, index }: { block: CodeBlock; index: number }) {
  const handleDownload = () => {
    const ext = LANG_EXT[block.language] || '.txt'
    const filename = `agent_output_${index + 1}${ext}`
    const blob = new Blob([block.code], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-white/10">
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/5">
        <span className="text-xs text-gray-400 font-mono">{block.language || 'code'}</span>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-[#D4AF37] hover:bg-[#D4AF37]/10 rounded transition-colors"
        >
          <Download size={12} />
          Download
        </button>
      </div>
      <pre className="p-3 bg-[#0d0d1a] overflow-x-auto text-xs font-mono text-gray-300 leading-relaxed">
        <code>{block.code}</code>
      </pre>
    </div>
  )
}

interface FileAttachment {
  fileId: string
  filename: string
  description: string
}

function extractFileAttachments(text: string): { cleanText: string; files: FileAttachment[] } {
  const files: FileAttachment[] = []
  const cleanText = text.replace(
    /\[\[DOWNLOAD:(file_[a-z0-9_]+)\|([^|]+)\|([^\]]+)\]\]/g,
    (_, fileId, filename, description) => {
      files.push({ fileId, filename, description })
      return ''
    }
  ).trim()
  return { cleanText, files }
}

interface GitHubPush {
  repoUrl: string
  repoName: string
  files: string
}

function extractGitHubPushes(text: string): { cleanText: string; pushes: GitHubPush[] } {
  const pushes: GitHubPush[] = []
  const cleanText = text.replace(
    /\[\[GITHUB:(https?:\/\/[^|]+)\|([^|]+)\|([^\]]+)\]\]/g,
    (_, repoUrl, repoName, files) => {
      pushes.push({ repoUrl, repoName, files })
      return ''
    }
  ).trim()
  return { cleanText, pushes }
}

function GitHubPushCard({ push }: { push: GitHubPush }) {
  return (
    <a
      href={push.repoUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 my-2 p-3 bg-gray-800/80 border border-white/10 rounded-xl hover:bg-gray-700/80 transition-colors group"
    >
      <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center">
        <Github className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white truncate">{push.repoName}</span>
          <ExternalLink className="w-3 h-3 text-gray-500 group-hover:text-gray-300 flex-shrink-0" />
        </div>
        <p className="text-xs text-gray-400 truncate">{push.files}</p>
      </div>
      <span className="text-xs text-green-400 font-medium flex-shrink-0">Pushed</span>
    </a>
  )
}

interface TweetPost {
  tweetUrl: string
  preview: string
}

function extractTweets(text: string): { cleanText: string; tweets: TweetPost[] } {
  const tweets: TweetPost[] = []
  const cleanText = text.replace(
    /\[\[TWEET:(https?:\/\/[^|]+|[0-9]+)\|([^\]]+)\]\]/g,
    (_, urlOrId, preview) => {
      const tweetUrl = urlOrId.startsWith('http') ? urlOrId : `https://x.com/i/status/${urlOrId}`
      tweets.push({ tweetUrl, preview })
      return ''
    }
  ).trim()
  return { cleanText, tweets }
}

function TweetCard({ tweet }: { tweet: TweetPost }) {
  return (
    <a
      href={tweet.tweetUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 my-2 p-3 bg-gray-800/80 border border-white/10 rounded-xl hover:bg-gray-700/80 transition-colors group"
    >
      <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center">
        <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-300 truncate">{tweet.preview}</p>
      </div>
      <span className="text-xs text-[#1DA1F2] font-medium flex-shrink-0">Posted</span>
    </a>
  )
}

function FileDownloadButton({ file, agentId }: { file: FileAttachment; agentId: string }) {
  const [downloading, setDownloading] = useState(false)

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const res = await fetch(`/api/agents/${agentId}/files/${file.fileId}`)
      if (!res.ok) throw new Error('File not found or expired')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Download error:', err)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={downloading}
      className="flex items-center gap-2 mt-2 px-3 py-2 bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded-lg hover:bg-[#D4AF37]/20 transition-colors text-sm"
    >
      <Download size={14} className="text-[#D4AF37]" />
      <span className="text-[#D4AF37] font-medium">{file.filename}</span>
      {file.description !== file.filename && (
        <span className="text-gray-400 text-xs">— {file.description}</span>
      )}
    </button>
  )
}

// ─── Suggested Prompts by Skill ──────────────────────────────────────────────
const SKILL_PROMPTS: Record<string, string[]> = {
  trading: [
    "What's your current market outlook?",
    "Analyze SUI price action today",
    "What setups are you watching?",
  ],
  research: [
    "What projects are you researching?",
    "Give me your latest alpha",
    "What trends are emerging in DeFi?",
  ],
  content: [
    "Write a tweet thread about our strategy",
    "Draft a market update post",
    "Create a bullish case summary",
  ],
  analysis: [
    "Run a technical analysis on SOL",
    "Compare ETH vs SUI momentum",
    "What does the volume data tell us?",
  ],
  social: [
    "What's the crypto community talking about?",
    "Summarize today's market sentiment",
    "What narratives are gaining traction?",
  ],
  coding: [
    "Help me write a trading bot script",
    "Review this smart contract logic",
    "Build a price alert function",
  ],
}

const DEFAULT_PROMPTS = [
  "What can you help me with?",
  "What's happening in crypto today?",
  "Tell me about yourself",
]

// ─── Model Options ───────────────────────────────────────────────────────────
const MODEL_OPTIONS = [
  { id: 'minimax', name: 'MiniMax M2.7', provider: 'MiniMax', speed: 'Fast', tier: 'free' },
  { id: 'claude-sonnet', name: 'Claude Sonnet 4.6', provider: 'Anthropic', speed: 'Medium', tier: 'pro' },
  { id: 'claude-opus', name: 'Claude Opus 4.6', provider: 'Anthropic', speed: 'Slower', tier: 'pro' },
  { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'OpenAI', speed: 'Medium', tier: 'pro' },
  { id: 'gpt-5.3-chat', name: 'GPT-5.3 Chat', provider: 'OpenAI', speed: 'Fast', tier: 'pro' },
  { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', provider: 'Google', speed: 'Medium', tier: 'pro' },
  { id: 'gemini-3.1-flash', name: 'Gemini 3.1 Flash Lite', provider: 'Google', speed: 'Fast', tier: 'free' },
  { id: 'kimi-k2.5', name: 'Kimi K2.5', provider: 'MoonshotAI', speed: 'Fast', tier: 'free' },
]

const AVAILABLE_SKILLS = [
  { id: 'trading', label: 'Trading', icon: '📈', desc: 'Bonding curve trading on Sui' },
  { id: 'research', label: 'Research', icon: '🔬', desc: 'Market analysis & due diligence' },
  { id: 'content', label: 'Content Creation', icon: '✍️', desc: 'Social posts & marketing' },
  { id: 'analysis', label: 'Data Analysis', icon: '📊', desc: 'Technical analysis & indicators' },
  { id: 'social', label: 'Social Media', icon: '💬', desc: 'Twitter, Telegram, Discord' },
  { id: 'coding', label: 'Coding', icon: '💻', desc: 'Smart contracts & scripts' },
  { id: 'dgclaw', label: 'DegenClaw', icon: '🦀', desc: 'Hyperliquid trading competition' },
]

const SERVICE_CATEGORIES = [
  { id: 'analysis', label: 'Analysis', icon: '📊' },
  { id: 'content', label: 'Content', icon: '✍️' },
  { id: 'code', label: 'Code', icon: '💻' },
  { id: 'data', label: 'Data', icon: '📈' },
  { id: 'social', label: 'Social', icon: '💬' },
  { id: 'trading', label: 'Trading', icon: '🔄' },
  { id: 'other', label: 'Other', icon: '🔧' },
]

type DashboardTab = 'overview' | 'settings' | 'wallet' | 'marketplace'

export default function AgentDashboardPage() {
  const params = useParams()
  const router = useRouter()
  const account = useCurrentAccount()
  const address = account?.address
  const agentId = params.id as string

  const [agent, setAgent] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [waitingForReply, setWaitingForReply] = useState(false)
  const [topUpLoading, setTopUpLoading] = useState(false)
  const [github, setGithub] = useState<{ connected: boolean; username?: string; repos?: any[] } | null>(null)
  const [dashTab, setDashTab] = useState<DashboardTab>('overview')

  // Settings state
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editPersonality, setEditPersonality] = useState('')
  const [editModel, setEditModel] = useState('minimax')
  const [editSkills, setEditSkills] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)

  // Agent Sui wallet state
  const [agentWallet, setAgentWallet] = useState<{
    address: string
    createdAt: string
    suiBalance: number
    naviPosition: { deposited: number; apy: number } | null
  } | null>(null)
  const [walletLoading, setWalletLoading] = useState(false)
  const [walletCopied, setWalletCopied] = useState(false)
  const [walletError, setWalletError] = useState<string | null>(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportedKey, setExportedKey] = useState<string | null>(null)
  const [exportKeyCopied, setExportKeyCopied] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage()

  // Card state
  const [cardData, setCardData] = useState<{
    hasCard: boolean
    card?: { id: string; last4: string; expMonth: number; expYear: number; status: string; brand: string }
    transactions?: Array<{ id: string; amount: number; currency: string; merchant: string; category?: string; created: string }>
  } | null>(null)
  const [cardLoading, setCardLoading] = useState(false)
  const [issuingCard, setIssuingCard] = useState(false)
  const [freezingCard, setFreezingCard] = useState(false)

  // Twitter state
  const [twitterData, setTwitterData] = useState<{
    connected: boolean
    username?: string
    enabled?: boolean
    intervalMinutes?: number
    style?: string
    tweets?: Array<{ id: string; text: string; created_at: string }>
  } | null>(null)
  const [showTwitterSetup, setShowTwitterSetup] = useState(false)
  const [twitterKeys, setTwitterKeys] = useState({ apiKey: '', apiSecret: '', accessToken: '', accessTokenSecret: '' })
  const [twitterSaving, setTwitterSaving] = useState(false)
  const [tweetText, setTweetText] = useState('')
  const [tweeting, setTweeting] = useState(false)
  const [twitterStyle, setTwitterStyle] = useState('')
  const [twitterInterval, setTwitterInterval] = useState(60)

  // Telegram bot state
  const [showTelegramSetup, setShowTelegramSetup] = useState(false)
  const [telegramBotToken, setTelegramBotToken] = useState('')
  const [telegramChannelIds, setTelegramChannelIds] = useState<string[]>([])
  const [telegramChannelInput, setTelegramChannelInput] = useState('')
  const [telegramSaving, setTelegramSaving] = useState(false)
  const [telegramError, setTelegramError] = useState<string | null>(null)
  const [telegramDisconnecting, setTelegramDisconnecting] = useState(false)

  // Marketplace state
  const [marketplaceServices, setMarketplaceServices] = useState<any[]>([])
  const [myServices, setMyServices] = useState<any[]>([])
  const [incomingRequests, setIncomingRequests] = useState<any[]>([])
  const [marketplaceEarnings, setMarketplaceEarnings] = useState(0)
  const [marketplaceLoading, setMarketplaceLoading] = useState(false)
  const [addingService, setAddingService] = useState(false)
  const [newService, setNewService] = useState({ name: '', description: '', price: '', category: 'analysis' })
  // Agent-proposed service drafts (LLM-generated via /services/propose)
  const [proposeLoading, setProposeLoading] = useState(false)
  const [proposeError, setProposeError] = useState<string | null>(null)
  const [serviceDrafts, setServiceDrafts] = useState<Array<{ name: string; description: string; price: number; category: string; reasoning?: string }>>([])
  const [publishingDraftIdx, setPublishingDraftIdx] = useState<number | null>(null)
  const [hiringAgent, setHiringAgent] = useState<string | null>(null)
  const [hirePrompt, setHirePrompt] = useState('')
  const [hiring, setHiring] = useState(false)

  // Worker/provisioning state
  const [workerStatus, setWorkerStatus] = useState<any>(null)
  const [provisioning, setProvisioning] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const userScrolledUp = useRef(false)

  useEffect(() => {
    if (!address || !agentId) {
      setLoading(false)
      return
    }

    async function fetchAgent() {
      try {
        // Fetch agent from backend
        const response = await fetch(`/api/agents/${agentId}`)
        if (!response.ok) {
          console.error('Failed to fetch agent:', response.statusText)
          setAgent(null)
          setLoading(false)
          return
        }

        const agentData = await response.json()
        
        // Fetch pool data for real-time stats
        try {
          const poolResponse = await fetch(`/api/pool/${agentData.poolId}`)
          if (poolResponse.ok) {
            const poolData = await poolResponse.json()
            
            // Calculate creator earnings (40% of 2% fee = 0.8% of volume)
            const earnings = (poolData.volume24h || 0) * 0.008
            
            setAgent({
              ...agentData,
              earnings,
              marketCap: poolData.marketCap || 0,
              volume24h: poolData.volume24h || 0,
            })
          } else {
            setAgent({
              ...agentData,
              earnings: 0,
              marketCap: 0,
            })
          }
        } catch (poolError) {
          console.error('Error fetching pool data:', poolError)
          setAgent({
            ...agentData,
            earnings: 0,
            marketCap: 0,
          })
        }

        // Populate settings form
        setEditName(agentData.name || '')
        setEditDescription(agentData.description || '')
        setEditPersonality(agentData.personality || '')
        setEditModel(agentData.llmModel || 'minimax')
        setEditSkills(agentData.skills || [])

        // Load GitHub connection status
        try {
          const ghRes = await fetch('/api/agents/' + agentId + '/github/push')
          if (ghRes.ok) setGithub(await ghRes.json())
        } catch { /* ignore */ }

        // Fetch worker status
        try {
          const wsRes = await fetch('/api/agents/' + agentId + '/spawn')
          if (wsRes.ok) setWorkerStatus(await wsRes.json())
        } catch { /* ignore */ }

        // Fetch agent Sui wallet
        try {
          const walletRes = await fetch('/api/agents/' + agentId + '/wallet')
          const walletData = await walletRes.json()
          if (walletRes.ok) setAgentWallet(walletData)
          else setWalletError(walletData.error || null)
        } catch { /* ignore */ }

        // Fetch card data
        try {
          const cardRes = await fetch('/api/agents/' + agentId + '/card')
          if (cardRes.ok) setCardData(await cardRes.json())
        } catch { /* ignore */ }

        // Fetch Twitter status
        try {
          const twRes = await fetch('/api/agents/' + agentId + '/twitter')
          if (twRes.ok) {
            const twData = await twRes.json()
            setTwitterData(twData)
            if (twData.style) setTwitterStyle(twData.style)
            if (twData.intervalMinutes) setTwitterInterval(twData.intervalMinutes)
          }
        } catch { /* ignore */ }

        // Fetch marketplace data (services, requests, earnings)
        try {
          const [svcRes, mktRes] = await Promise.all([
            fetch('/api/agents/' + agentId + '/services'),
            fetch('/api/marketplace'),
          ])
          if (svcRes.ok) {
            const svcData = await svcRes.json()
            setMyServices(svcData.services || [])
            setIncomingRequests(svcData.requests || [])
            setMarketplaceEarnings(svcData.earnings || 0)
          }
          if (mktRes.ok) {
            const mktData = await mktRes.json()
            setMarketplaceServices(mktData.services || [])
          }
        } catch { /* ignore */ }

        // Load chat history from localStorage
        const stored = localStorage.getItem('chat:' + agentId)
        if (stored) {
          const parsed = JSON.parse(stored)
          setMessages(parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })))
        } else {
          setMessages([
            { id: '1', sender: 'agent', message: 'Hello! I am ' + agentData.name + '. How can I help you today?', timestamp: new Date() }
          ])
        }
        
        setLoading(false)
      } catch (error) {
        console.error('Error fetching agent:', error)
        setAgent(null)
        setLoading(false)
      }
    }

    fetchAgent()
  }, [address, agentId])

  useEffect(() => {
    if (!userScrolledUp.current && chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
    }
  }, [messages])

  // Handle GitHub OAuth callback redirect params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('github') === 'connected') {
      const user = params.get('user')
      setGithub(prev => ({ ...prev, connected: true, username: user || undefined }))
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  // ─── Provisioning ───────────────────────────────────────────────────────
  const handleProvision = async () => {
    if (!agent) return
    setProvisioning(true)
    try {
      const res = await fetch(`/api/agents/${agentId}/spawn`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setWorkerStatus(data)
        setAgent((prev: any) => ({ ...prev, status: 'active', openclawSessionId: data.sessionId }))
        setSaveSuccess('provisioned')
        setTimeout(() => setSaveSuccess(null), 3000)
      }
    } catch (err) { console.error('Provision error:', err) }
    finally { setProvisioning(false) }
  }

  const handleDeprovision = async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/spawn`, { method: 'DELETE' })
      if (res.ok) {
        setWorkerStatus(null)
        setAgent((prev: any) => ({ ...prev, status: 'stopped', openclawSessionId: null }))
      }
    } catch (err) { console.error('Deprovision error:', err) }
  }

  // ─── Settings Handlers ────────────────────────────────────────────────
  const syncToWorker = async (updates: any) => {
    try {
      await fetch(`/api/agents/${agentId}/spawn`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
    } catch { /* worker sync is best-effort */ }
  }

  // Every agent mutation requires a Sui-signed envelope — one wallet
  // signature per save. `signAndPatch` prompts the wallet, attaches the
  // `_auth` envelope to the body, and hits PATCH. Throws if the user
  // rejects the signature prompt; caller's catch block handles UI state.
  const signAndPatch = async (updates: Record<string, any>) => {
    if (!address) throw new Error('Connect wallet first')
    const _auth = await signAuthEnvelope({
      action: 'agent.patch',
      resourceId: agentId,
      address,
      signPersonalMessage,
    })
    return fetch(`/api/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...updates, _auth }),
    })
  }

  const signAndDeleteAgent = async () => {
    if (!address) throw new Error('Connect wallet first')
    const _auth = await signAuthEnvelope({
      action: 'agent.delete',
      resourceId: agentId,
      address,
      signPersonalMessage,
    })
    return fetch(`/api/agents/${agentId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _auth }),
    })
  }

  const handleSaveGeneral = async () => {
    setSaving(true)
    setSaveSuccess(null)
    try {
      const updates = { name: editName, description: editDescription }
      const res = await signAndPatch(updates)
      if (res.ok) {
        const updated = await res.json()
        setAgent((prev: any) => ({ ...prev, ...updated }))
        syncToWorker(updates)
        setSaveSuccess('general')
        setTimeout(() => setSaveSuccess(null), 2000)
      }
    } catch (err) { console.error('Save error:', err) }
    finally { setSaving(false) }
  }

  const handleSavePersonality = async () => {
    setSaving(true)
    setSaveSuccess(null)
    try {
      const updates = { personality: editPersonality }
      const res = await signAndPatch(updates)
      if (res.ok) {
        const updated = await res.json()
        setAgent((prev: any) => ({ ...prev, ...updated }))
        syncToWorker(updates)
        setSaveSuccess('soul')
        setTimeout(() => setSaveSuccess(null), 2000)
      }
    } catch (err) { console.error('Save error:', err) }
    finally { setSaving(false) }
  }

  const handleSaveModel = async (modelId: string) => {
    setEditModel(modelId)
    setModelDropdownOpen(false)
    try {
      const updates = { llmModel: modelId }
      await signAndPatch(updates)
      setAgent((prev: any) => ({ ...prev, llmModel: modelId }))
      syncToWorker(updates)
      setSaveSuccess('model')
      setTimeout(() => setSaveSuccess(null), 2000)
    } catch (err) { console.error('Save model error:', err) }
  }

  const handleToggleSkill = async (skillId: string) => {
    const newSkills = editSkills.includes(skillId)
      ? editSkills.filter(s => s !== skillId)
      : editSkills.length < 7
        ? [...editSkills, skillId]
        : editSkills // Max 7 skills
    setEditSkills(newSkills)
    try {
      const updates = { skills: newSkills }
      await signAndPatch(updates)
      setAgent((prev: any) => ({ ...prev, skills: newSkills }))
      syncToWorker(updates)
    } catch (err) { console.error('Save skills error:', err) }
  }

  const handleStatusChange = async (newStatus: 'active' | 'paused' | 'stopped') => {
    try {
      const res = await signAndPatch({ status: newStatus })
      if (res.ok) {
        const updated = await res.json()
        setAgent((prev: any) => ({ ...prev, ...updated }))
        syncToWorker({ status: newStatus })
      }
    } catch (err) { console.error('Status change error:', err) }
  }

  // ─── API Keys Management ────────────────────────────────────────────────────
  const [newApiKey, setNewApiKey] = useState({ name: '', baseUrl: '', headerKey: 'Authorization', headerValue: '' })
  const [showApiKeyForm, setShowApiKeyForm] = useState(false)

  const handleAddApiKey = async () => {
    if (!newApiKey.name || !newApiKey.baseUrl || !newApiKey.headerValue) return
    const existing = agent.apiKeys || []
    const apiKeys = [...existing, {
      name: newApiKey.name,
      baseUrl: newApiKey.baseUrl,
      headers: { [newApiKey.headerKey]: newApiKey.headerValue },
    }]
    try {
      const res = await signAndPatch({ apiKeys })
      if (res.ok) {
        const updated = await res.json()
        setAgent((prev: any) => ({ ...prev, ...updated }))
        setNewApiKey({ name: '', baseUrl: '', headerKey: 'Authorization', headerValue: '' })
        setShowApiKeyForm(false)
        setSaveSuccess('apikey')
        setTimeout(() => setSaveSuccess(null), 2000)
      }
    } catch (err) { console.error('Save API key error:', err) }
  }

  const handleRemoveApiKey = async (index: number) => {
    const apiKeys = [...(agent.apiKeys || [])]
    apiKeys.splice(index, 1)
    try {
      const res = await signAndPatch({ apiKeys })
      if (res.ok) {
        const updated = await res.json()
        setAgent((prev: any) => ({ ...prev, ...updated }))
      }
    } catch (err) { console.error('Remove API key error:', err) }
  }

  // ─── Trading Config ────────────────────────────────────────────────────────
  const [tradingConfig, setTradingConfig] = useState({
    exchange: 'hyperliquid',
    maxPositionSize: 1000,
    maxLoss: 500,
    intervalSeconds: 30,
    strategy: '',
  })

  const handleSaveTradingConfig = async () => {
    try {
      const res = await signAndPatch({ tradingEnabled: true, tradingConfig })
      if (res.ok) {
        const updated = await res.json()
        setAgent((prev: any) => ({ ...prev, ...updated }))
        setSaveSuccess('trading')
        setTimeout(() => setSaveSuccess(null), 2000)
      }
    } catch (err) { console.error('Save trading config error:', err) }
  }

  const handleResetChat = async () => {
    localStorage.removeItem('chat:' + agentId)
    try {
      await fetch(`/api/agents/${agentId}/chat`, { method: 'DELETE' })
    } catch { /* ignore */ }
    setMessages([
      { id: '1', sender: 'agent', message: 'Hello! I am ' + agent.name + '. How can I help you today?', timestamp: new Date() },
    ])
    setSaveSuccess('reset')
    setTimeout(() => setSaveSuccess(null), 2000)
  }

  const handleDeleteAgent = async () => {
    try {
      await handleDeprovision()
      const res = await signAndDeleteAgent()
      if (res.ok) router.push('/my-agents')
    } catch (err) { console.error('Delete error:', err) }
  }

  // Build suggested prompts from agent skills
  const suggestedPrompts = (() => {
    if (!agent?.skills?.length) return DEFAULT_PROMPTS
    const prompts: string[] = []
    for (const skill of agent.skills) {
      const skillPrompts = SKILL_PROMPTS[skill]
      if (skillPrompts) prompts.push(skillPrompts[Math.floor(Math.random() * skillPrompts.length)])
    }
    return prompts.length > 0 ? prompts.slice(0, 3) : DEFAULT_PROMPTS
  })()

  const [showSuggestions, setShowSuggestions] = useState(true)

  const handleSendMessage = async (overrideMessage?: string) => {
    const msg = overrideMessage || inputMessage
    if (!msg.trim() || sending) return

    setShowSuggestions(false)
    userScrolledUp.current = false

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      message: msg,
      timestamp: new Date()
    }

    setMessages(prev => {
      const updated = [...prev, userMsg]
      localStorage.setItem('chat:' + agentId, JSON.stringify(updated))
      return updated
    })
    setInputMessage('')
    setSending(true)

    // Send message to Railway worker (real OpenClaw session)
    try {
      const apiResponse = await fetch('/api/agents/' + agentId + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg })
      })

      if (apiResponse.ok) {
        const data = await apiResponse.json()

        if (data.queued) {
          // Message queued to worker — poll for response
          setSending(false)
          setWaitingForReply(true)
          const queuedAt = data.queuedAt || new Date().toISOString()

          let attempts = 0
          const poll = setInterval(async () => {
            attempts++
            try {
              const pollRes = await fetch('/api/agents/' + agentId + '/chat?since=' + encodeURIComponent(queuedAt))
              if (pollRes.ok) {
                const pollData = await pollRes.json()
                if (pollData.message) {
                  clearInterval(poll)
                  setWaitingForReply(false)
                  const agentMsg: Message = {
                    id: Date.now().toString(),
                    sender: 'agent',
                    message: pollData.message,
                    timestamp: new Date()
                  }
                  setMessages(prev => {
                    const updated = [...prev.filter(m => m.message !== '...'), agentMsg]
                    localStorage.setItem('chat:' + agentId, JSON.stringify(updated))
                    return updated
                  })
                }
              }
            } catch { /* keep polling */ }
            // Poll for up to 60 seconds (30 attempts * 2s)
            if (attempts >= 30) {
              clearInterval(poll)
              setWaitingForReply(false)
              const timeoutMsg: Message = {
                id: Date.now().toString(),
                sender: 'agent',
                message: 'The agent is taking longer than expected. It may still be processing — try sending your message again in a moment.',
                timestamp: new Date()
              }
              setMessages(prev => {
                const updated = [...prev.filter(m => m.message !== '...'), timeoutMsg]
                localStorage.setItem('chat:' + agentId, JSON.stringify(updated))
                return updated
              })
            }
          }, 2000)
        } else if (data.message) {
          // Immediate response (error or fallback)
          const agentMsg: Message = {
            id: (Date.now() + 1).toString(),
            sender: 'agent',
            message: data.message,
            timestamp: new Date()
          }
          setMessages(prev => {
            const updated = [...prev, agentMsg]
            localStorage.setItem('chat:' + agentId, JSON.stringify(updated))
            return updated
          })
          setSending(false)
        }
      } else {
        setSending(false)
      }
    } catch (err) {
      console.error('Chat error:', err)
      setSending(false)
    }
  }

  if (!address) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400">Please connect your wallet</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="w-12 h-12 border-2 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-white text-xl mb-4">Agent not found</p>
          <button
            onClick={() => router.push('/my-agents')}
            className="px-6 py-3 rounded-xl bg-[#D4AF37] text-black font-bold"
          >
            Back to My Agents
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 pt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => router.push('/my-agents')}
            className="p-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-4 flex-1">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#FFD700] flex items-center justify-center text-white font-bold text-lg overflow-hidden">
              {hasValidAvatar(agent.avatarUrl) ? (
                <img src={agent.avatarUrl} alt={agent.name} className="w-full h-full object-cover" />
              ) : (
                agent.symbol.slice(0, 2)
              )}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">{agent.name}</h1>
              <p className="text-sm text-gray-400">${agent.symbol}</p>
            </div>
          </div>

          <div className={`px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 ${
            agent.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' :
            agent.status === 'paused' ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-red-500/20 text-red-400'
          }`}>
            <div className={`w-2 h-2 rounded-full ${
              agent.status === 'active' ? 'bg-emerald-400 animate-pulse' :
              agent.status === 'paused' ? 'bg-yellow-400' : 'bg-red-400'
            }`} />
            {agent.status === 'active' ? 'Running' : agent.status === 'paused' ? 'Paused' : 'Stopped'}
            {agent.openclawSessionId && <span className="text-xs opacity-60 ml-1">OpenClaw</span>}
          </div>
        </div>

        {/* Dashboard Tabs */}
        <div className="flex items-center gap-1 mb-6 border-b border-white/10">
          {([
            { id: 'overview' as DashboardTab, label: 'Overview', icon: MessageSquare },
            { id: 'marketplace' as DashboardTab, label: 'Marketplace', icon: Store },
            { id: 'settings' as DashboardTab, label: 'Settings', icon: Settings },
            { id: 'wallet' as DashboardTab, label: 'Wallet', icon: CreditCard },
          ]).map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setDashTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all ${
                  dashTab === tab.id
                    ? 'border-[#D4AF37] text-white'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* ═══ OVERVIEW TAB ═══ */}
        {dashTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Chat Section */}
          <div className="lg:col-span-2 bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 flex flex-col" style={{ height: 'calc(100vh - 16rem)' }}>

            {/* Chat Header */}
            <div className="p-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#FFD700] flex items-center justify-center text-white font-bold text-sm overflow-hidden">
                    {hasValidAvatar(agent.avatarUrl) ? (
                      <img src={agent.avatarUrl} alt={agent.name} className="w-full h-full object-cover" />
                    ) : (
                      agent.symbol.slice(0, 2)
                    )}
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-slate-800" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="font-bold text-white">{agent.name}</h2>
                    <Sparkles className="w-4 h-4 text-[#D4AF37]" />
                  </div>
                  <p className="text-xs text-gray-500">
                    Online
                  </p>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div
              ref={chatContainerRef}
              onScroll={() => {
                const el = chatContainerRef.current
                if (!el) return
                const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
                userScrolledUp.current = distanceFromBottom > 150
              }}
              className="flex-1 overflow-y-auto p-4 space-y-4"
            >
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className={`flex gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {/* Agent Avatar */}
                  {msg.sender === 'agent' && (
                    <div className="flex-shrink-0 mt-1">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#FFD700] flex items-center justify-center text-white text-xs font-bold overflow-hidden">
                        {agent.avatarUrl ? (
                          <img src={agent.avatarUrl} alt={agent.name} className="w-full h-full object-cover" />
                        ) : (
                          <Bot className="w-4 h-4" />
                        )}
                      </div>
                    </div>
                  )}

                  <div className={`max-w-[75%] ${msg.sender === 'user' ? '' : ''}`}>
                    {/* Sender label for agent */}
                    {msg.sender === 'agent' && (
                      <p className="text-xs text-[#D4AF37] font-medium mb-1 ml-1">{agent.name}</p>
                    )}
                    <div className={`rounded-2xl px-4 py-3 ${
                      msg.sender === 'user'
                        ? 'bg-gradient-to-r from-[#D4AF37] to-[#FFD700] text-black rounded-br-md'
                        : 'bg-white/5 text-gray-200 border border-white/10 rounded-bl-md'
                    }`}>
                      {msg.sender === 'agent' ? (() => {
                        const { cleanText: t0, pushes } = extractGitHubPushes(msg.message)
                        const { cleanText: t0b, tweets } = extractTweets(t0)
                        const { cleanText: t1, files } = extractFileAttachments(t0b)
                        const { cleanText: t2, blocks } = extractCodeBlocks(t1)
                        // Render text with code block placeholders replaced by actual components
                        const parts = t2.split(/\[\[CODEBLOCK:(\d+)\]\]/)
                        return (
                          <div className="text-sm">
                            {parts.map((part, i) => {
                              if (i % 2 === 1) {
                                const blockIdx = parseInt(part)
                                return blocks[blockIdx] ? (
                                  <CodeBlockWithDownload key={`cb-${i}`} block={blocks[blockIdx]} index={blockIdx} />
                                ) : null
                              }
                              return part.trim() ? <div key={`t-${i}`}>{renderMarkdown(part)}</div> : null
                            })}
                            {files.map(f => (
                              <FileDownloadButton key={f.fileId} file={f} agentId={agentId} />
                            ))}
                            {pushes.map((p, i) => (
                              <GitHubPushCard key={`gh-${i}`} push={p} />
                            ))}
                            {tweets.map((tw, i) => (
                              <TweetCard key={`tw-${i}`} tweet={tw} />
                            ))}
                          </div>
                        )
                      })() : (
                        <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                      )}
                    </div>
                    <p className={`text-[10px] mt-1 ml-1 ${msg.sender === 'user' ? 'text-right text-gray-500' : 'text-gray-600'}`}>
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </motion.div>
              ))}

              {/* Typing Indicator */}
              <AnimatePresence>
                {(sending || waitingForReply) && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="flex gap-3 items-start"
                  >
                    <div className="flex-shrink-0 mt-1">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#FFD700] flex items-center justify-center text-white text-xs font-bold overflow-hidden">
                        {agent.avatarUrl ? (
                          <img src={agent.avatarUrl} alt={agent.name} className="w-full h-full object-cover" />
                        ) : (
                          <Bot className="w-4 h-4" />
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-[#D4AF37] font-medium mb-1 ml-1">{agent.name}</p>
                      <div className="bg-white/5 border border-white/10 rounded-2xl rounded-bl-md px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            <div className="w-2 h-2 bg-[#D4AF37] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <div className="w-2 h-2 bg-[#D4AF37] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <div className="w-2 h-2 bg-[#D4AF37] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                          </div>
                          <span className="text-xs text-gray-500 italic">thinking...</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div ref={messagesEndRef} />
            </div>

            {/* Suggested Prompts */}
            <AnimatePresence>
              {showSuggestions && messages.length <= 1 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="px-4 pb-2"
                >
                  <p className="text-xs text-gray-500 mb-2">Try asking:</p>
                  <div className="flex flex-wrap gap-2">
                    {suggestedPrompts.map((prompt, i) => (
                      <button
                        key={i}
                        onClick={() => handleSendMessage(prompt)}
                        className="px-3 py-1.5 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/20 text-[#D4AF37] text-xs font-medium hover:bg-[#D4AF37]/20 hover:border-[#D4AF37]/40 transition-all"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Input */}
            <div className="p-4 border-t border-white/10">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                  placeholder={`Message ${agent.name}...`}
                  disabled={sending || waitingForReply}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 focus:border-[#D4AF37]/30 transition-all"
                />
                <button
                  onClick={() => handleSendMessage()}
                  disabled={!inputMessage.trim() || sending || waitingForReply}
                  className="px-5 py-3 rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#FFD700] text-black font-bold hover:opacity-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-lg shadow-[#D4AF37]/20"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            
            {/* Stats */}
            <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
              <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-[#D4AF37]" />
                Performance
              </h3>
              
              <div className="space-y-3">
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Market Cap</div>
                  <div className="text-lg font-bold text-white">
                    ${(agent.marketCap / 1000).toFixed(1)}K
                  </div>
                </div>

                <div className="bg-gradient-to-r from-[#D4AF37]/10 to-[#FFD700]/10 border border-[#D4AF37]/20 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Your Earnings</div>
                  <div className="text-xl font-bold text-[#D4AF37]">
                    {agent.earnings?.toFixed(3) || '0.000'} SUI
                  </div>
                  <button 
                    onClick={async () => {
                      if (!agent.earnings || agent.earnings <= 0) {
                        alert('No earnings to withdraw')
                        return
                      }
                      try {
                        const res = await fetch(`/api/agents/${agent.id}/withdraw`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ creatorAddress: address })
                        })
                        const data = await res.json()
                        if (data.success) {
                          alert(`Earnings: ${data.earnings?.toFixed(4)} SUI\n\nNote: ${data.note}`)
                        } else {
                          alert('Error: ' + data.error)
                        }
                      } catch (err) {
                        console.error('Withdraw error:', err)
                        alert('Failed to check earnings')
                      }
                    }}
                    className="w-full mt-2 py-2 rounded-lg bg-[#D4AF37] text-black text-sm font-bold hover:opacity-90 transition-opacity"
                  >
                    Withdraw
                  </button>
                </div>
              </div>
            </div>

            {/* Card Widget */}
            <div className="bg-gradient-to-r from-[#D4AF37]/10 to-[#FFD700]/10 border border-[#D4AF37]/20 rounded-2xl p-6">
              <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-[#D4AF37]" />
                Agent Card
              </h3>

              {cardData?.hasCard && cardData.card ? (
                <>
                  {/* Card Details */}
                  <div className="bg-[#0a0a0f]/50 rounded-xl p-4 mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-xs text-gray-400">Virtual Card</p>
                        <p className="text-lg font-bold text-white">{cardData.card.brand?.toUpperCase() || 'VISA'}</p>
                      </div>
                      <div className={`px-2 py-1 rounded text-xs font-medium ${
                        cardData.card.status === 'active'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : cardData.card.status === 'inactive'
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}>
                        {cardData.card.status === 'active' ? 'Active' : cardData.card.status === 'inactive' ? 'Frozen' : cardData.card.status}
                      </div>
                    </div>

                    <div className="flex justify-between text-xs text-gray-500 mb-2">
                      <span>•••• {cardData.card.last4}</span>
                      <span>Exp: {String(cardData.card.expMonth).padStart(2, '0')}/{String(cardData.card.expYear).slice(-2)}</span>
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <button
                      onClick={async () => {
                        setTopUpLoading(true)
                        try {
                          const response = await fetch(`/api/agents/${agent.id}/topup`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ amount: 5000 }),
                          })
                          const data = await response.json()
                          if (data.url) {
                            window.location.href = data.url
                          } else {
                            alert('Error: ' + (data.error || 'Failed to create top-up'))
                          }
                        } catch (error) {
                          console.error('Top up error:', error)
                          alert('Failed to initiate top-up')
                        } finally {
                          setTopUpLoading(false)
                        }
                      }}
                      disabled={topUpLoading || cardData.card.status !== 'active'}
                      className="py-2 rounded-lg bg-[#D4AF37]/20 hover:bg-[#D4AF37]/30 text-[#D4AF37] text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      {topUpLoading ? 'Loading...' : 'Top Up $50'}
                    </button>
                    <button
                      onClick={async () => {
                        setFreezingCard(true)
                        const newStatus = cardData.card!.status === 'active' ? 'inactive' : 'active'
                        try {
                          const res = await fetch(`/api/agents/${agent.id}/card`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: newStatus }),
                          })
                          if (res.ok) {
                            setCardData(prev => prev ? { ...prev, card: { ...prev.card!, status: newStatus } } : prev)
                          } else {
                            const err = await res.json()
                            alert('Error: ' + (err.error || 'Failed to update card'))
                          }
                        } catch { alert('Failed to update card') }
                        finally { setFreezingCard(false) }
                      }}
                      disabled={freezingCard}
                      className={`py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                        cardData.card.status === 'active'
                          ? 'bg-white/5 hover:bg-red-500/20 text-gray-300 hover:text-red-400'
                          : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400'
                      }`}
                    >
                      {freezingCard ? '...' : cardData.card.status === 'active' ? 'Freeze' : 'Unfreeze'}
                    </button>
                  </div>

                  {/* Recent Transactions */}
                  <div>
                    <p className="text-xs text-gray-500 mb-2">Recent Activity</p>
                    {cardData.transactions && cardData.transactions.length > 0 ? (
                      <div className="space-y-2">
                        {cardData.transactions.slice(0, 5).map(tx => (
                          <div key={tx.id} className="flex justify-between text-xs">
                            <span className="text-gray-400 truncate mr-2">{tx.merchant}</span>
                            <span className={tx.amount < 0 ? 'text-white' : 'text-emerald-400'}>
                              {tx.amount < 0 ? '-' : '+'}${Math.abs(tx.amount).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-600">No transactions yet</p>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center py-4">
                  <p className="text-sm text-gray-400 mb-4">Issue a virtual Visa card for this agent to make API payments and subscriptions.</p>
                  <button
                    onClick={async () => {
                      setIssuingCard(true)
                      try {
                        const res = await fetch(`/api/agents/${agent.id}/card`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ initialBalance: 5000 }),
                        })
                        const data = await res.json()
                        if (data.success) {
                          setCardData({ hasCard: true, card: data.card, transactions: [] })
                        } else {
                          alert('Error: ' + (data.error || 'Failed to issue card'))
                        }
                      } catch { alert('Failed to issue card') }
                      finally { setIssuingCard(false) }
                    }}
                    disabled={issuingCard}
                    className="px-6 py-2 rounded-lg bg-[#D4AF37] text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {issuingCard ? 'Issuing...' : 'Issue Virtual Card'}
                  </button>
                </div>
              )}
            </div>

            {/* GitHub Integration */}
            <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
              <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                <Github className="w-5 h-5 text-[#D4AF37]" />
                GitHub
              </h3>
              {github?.connected ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Github className="w-4 h-4 text-green-400" />
                    <span className="text-sm text-green-400 font-medium">@{github.username}</span>
                    <span className="text-xs text-gray-500 ml-auto">Connected</span>
                  </div>
                  {github.repos && github.repos.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs text-gray-500">Repos built by this agent:</p>
                      {github.repos.slice(0, 5).map((repo: any) => (
                        <a key={repo.name} href={repo.url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center justify-between p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors group">
                          <span className="text-xs text-gray-300 truncate">{repo.name}</span>
                          <ExternalLink className="w-3 h-3 text-gray-500 group-hover:text-gray-300 flex-shrink-0" />
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">No repos yet — ask the agent to build something!</p>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-xs text-gray-400 mb-3">Connect GitHub so the agent can push code directly to your repos.</p>
                  <a href={'/api/github/connect?agentId=' + agentId}
                    className="flex items-center gap-2 w-full px-3 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-200 transition-colors">
                    <Github className="w-4 h-4" />
                    Connect GitHub
                  </a>
                </div>
              )}
            </div>

            {/* Twitter/X Integration */}
            <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
              <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-[#D4AF37]" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                Twitter / X
              </h3>

              {twitterData?.connected ? (
                <div className="space-y-4">
                  {/* Connected status */}
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-sm text-emerald-400 font-medium">@{twitterData.username}</span>
                    <button
                      onClick={async () => {
                        if (!confirm('Disconnect Twitter?')) return
                        const res = await fetch(`/api/agents/${agentId}/twitter`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ disconnect: true }),
                        })
                        if (res.ok) setTwitterData({ connected: false })
                      }}
                      className="ml-auto text-xs text-gray-500 hover:text-red-400 transition-colors"
                    >
                      Disconnect
                    </button>
                  </div>

                  {/* Manual Tweet */}
                  <div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={tweetText}
                        onChange={e => setTweetText(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && tweetText.trim() && !tweeting && (async () => {
                          setTweeting(true)
                          try {
                            const res = await fetch(`/api/agents/${agentId}/twitter`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ text: tweetText }),
                            })
                            const data = await res.json()
                            if (data.success) {
                              setTweetText('')
                              // Refresh tweets
                              const twRes = await fetch(`/api/agents/${agentId}/twitter`)
                              if (twRes.ok) setTwitterData(await twRes.json())
                            } else {
                              alert('Tweet failed: ' + (data.error || 'Unknown error'))
                            }
                          } catch { alert('Failed to tweet') }
                          finally { setTweeting(false) }
                        })()}
                        placeholder="Write a tweet..."
                        maxLength={280}
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-[#D4AF37]/50"
                      />
                      <button
                        onClick={async () => {
                          if (!tweetText.trim()) return
                          setTweeting(true)
                          try {
                            const res = await fetch(`/api/agents/${agentId}/twitter`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ text: tweetText }),
                            })
                            const data = await res.json()
                            if (data.success) {
                              setTweetText('')
                              const twRes = await fetch(`/api/agents/${agentId}/twitter`)
                              if (twRes.ok) setTwitterData(await twRes.json())
                            } else {
                              alert('Tweet failed: ' + (data.error || 'Unknown error'))
                            }
                          } catch { alert('Failed to tweet') }
                          finally { setTweeting(false) }
                        }}
                        disabled={!tweetText.trim() || tweeting}
                        className="px-3 py-2 rounded-lg bg-[#D4AF37] text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                      >
                        {tweeting ? '...' : 'Tweet'}
                      </button>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">{tweetText.length}/280</p>
                  </div>

                  {/* Auto-tweet Settings */}
                  <div className="border-t border-white/5 pt-3">
                    <p className="text-xs text-gray-400 mb-2 font-medium">Auto-Tweet</p>
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={twitterStyle}
                        onChange={e => setTwitterStyle(e.target.value)}
                        placeholder="Tweet style (e.g. alpha calls with emojis, shitposts about SUI...)"
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-[#D4AF37]/50"
                      />
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-xs text-gray-500">Every</label>
                          <select
                            value={twitterInterval}
                            onChange={e => setTwitterInterval(Number(e.target.value))}
                            className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
                          >
                            <option value={30}>30 min</option>
                            <option value={60}>1 hour</option>
                            <option value={120}>2 hours</option>
                            <option value={240}>4 hours</option>
                            <option value={480}>8 hours</option>
                            <option value={1440}>24 hours</option>
                          </select>
                        </div>
                        <button
                          onClick={async () => {
                            setTwitterSaving(true)
                            try {
                              const res = await fetch(`/api/agents/${agentId}/twitter`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  enabled: !twitterData.enabled,
                                  intervalMinutes: twitterInterval,
                                  style: twitterStyle,
                                }),
                              })
                              if (res.ok) {
                                setTwitterData(prev => prev ? { ...prev, enabled: !prev.enabled, intervalMinutes: twitterInterval, style: twitterStyle } : prev)
                              }
                            } catch { alert('Failed to update') }
                            finally { setTwitterSaving(false) }
                          }}
                          disabled={twitterSaving}
                          className={`self-end px-4 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 ${
                            twitterData.enabled
                              ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                              : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                          }`}
                        >
                          {twitterSaving ? '...' : twitterData.enabled ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </div>
                    {twitterData.enabled && (
                      <p className="text-xs text-emerald-400/60 mt-2">Auto-tweeting every {twitterData.intervalMinutes || 60} min</p>
                    )}
                  </div>

                  {/* Recent Tweets */}
                  {twitterData.tweets && twitterData.tweets.length > 0 && (
                    <div className="border-t border-white/5 pt-3">
                      <p className="text-xs text-gray-400 mb-2 font-medium">Recent Tweets</p>
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {twitterData.tweets.slice(0, 5).map(tw => (
                          <a
                            key={tw.id}
                            href={`https://x.com/i/status/${tw.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors"
                          >
                            <p className="text-xs text-gray-300 line-clamp-2">{tw.text}</p>
                            <p className="text-xs text-gray-600 mt-1">{new Date(tw.created_at).toLocaleDateString()}</p>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  {showTwitterSetup ? (
                    <div className="space-y-3">
                      <p className="text-xs text-gray-400">Enter your Twitter API credentials. Get them from <a href="https://developer.twitter.com/en/portal/dashboard" target="_blank" rel="noopener noreferrer" className="text-[#D4AF37] hover:underline">developer.twitter.com</a></p>
                      <input
                        type="text"
                        value={twitterKeys.apiKey}
                        onChange={e => setTwitterKeys(k => ({ ...k, apiKey: e.target.value }))}
                        placeholder="API Key (Consumer Key)"
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-[#D4AF37]/50"
                      />
                      <input
                        type="password"
                        value={twitterKeys.apiSecret}
                        onChange={e => setTwitterKeys(k => ({ ...k, apiSecret: e.target.value }))}
                        placeholder="API Secret (Consumer Secret)"
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-[#D4AF37]/50"
                      />
                      <input
                        type="text"
                        value={twitterKeys.accessToken}
                        onChange={e => setTwitterKeys(k => ({ ...k, accessToken: e.target.value }))}
                        placeholder="Access Token"
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-[#D4AF37]/50"
                      />
                      <input
                        type="password"
                        value={twitterKeys.accessTokenSecret}
                        onChange={e => setTwitterKeys(k => ({ ...k, accessTokenSecret: e.target.value }))}
                        placeholder="Access Token Secret"
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-[#D4AF37]/50"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            if (!twitterKeys.apiKey || !twitterKeys.apiSecret || !twitterKeys.accessToken || !twitterKeys.accessTokenSecret) return
                            setTwitterSaving(true)
                            try {
                              const res = await fetch(`/api/agents/${agentId}/twitter`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  ...twitterKeys,
                                  enabled: false,
                                  intervalMinutes: 60,
                                }),
                              })
                              const data = await res.json()
                              if (data.success && data.connected) {
                                setTwitterData({ connected: true, username: data.username, enabled: false, tweets: [] })
                                setShowTwitterSetup(false)
                              } else {
                                alert('Connection failed: ' + (data.error || 'Invalid credentials'))
                              }
                            } catch { alert('Failed to connect') }
                            finally { setTwitterSaving(false) }
                          }}
                          disabled={twitterSaving || !twitterKeys.apiKey || !twitterKeys.accessToken}
                          className="flex-1 py-2 rounded-lg bg-[#D4AF37] text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                          {twitterSaving ? 'Verifying...' : 'Connect'}
                        </button>
                        <button
                          onClick={() => setShowTwitterSetup(false)}
                          className="px-4 py-2 rounded-lg bg-white/5 text-gray-400 text-sm hover:bg-white/10 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs text-gray-400 mb-3">Connect Twitter so your agent can tweet autonomously — market alpha, memes, engagement.</p>
                      <button
                        onClick={() => setShowTwitterSetup(true)}
                        className="flex items-center gap-2 w-full px-3 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-200 transition-colors"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                        Connect Twitter / X
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Agent Controls */}
            <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
              <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                <Cpu className="w-5 h-5 text-[#D4AF37]" />
                Agent Runtime
              </h3>

              {/* Provisioning Status */}
              <div className={`rounded-lg p-3 mb-4 text-sm ${
                agent.openclawSessionId
                  ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                  : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-2 h-2 rounded-full ${agent.openclawSessionId ? 'bg-emerald-400 animate-pulse' : 'bg-yellow-400'}`} />
                  {agent.openclawSessionId ? 'OpenClaw Active' : 'Not Provisioned'}
                </div>
                <p className="text-xs opacity-70">
                  {agent.openclawSessionId
                    ? `Session: ${agent.openclawSessionId.slice(0, 20)}...`
                    : 'Provision to enable autonomous agent behavior'}
                </p>
              </div>

              <div className="space-y-2">
                {!agent.openclawSessionId ? (
                  <button
                    onClick={handleProvision}
                    disabled={provisioning}
                    className="w-full py-3 rounded-lg bg-gradient-to-r from-[#D4AF37] to-[#FFD700] text-black font-bold text-sm transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {provisioning ? (
                      <>
                        <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                        Provisioning...
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4" />
                        Provision Agent
                      </>
                    )}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => setDashTab('settings')}
                      className="w-full py-3 rounded-lg bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-colors flex items-center justify-center gap-2"
                    >
                      <Settings className="w-4 h-4" />
                      Configure Agent
                    </button>

                    {agent.status === 'active' ? (
                      <button
                        onClick={() => handleStatusChange('paused')}
                        className="w-full py-3 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 font-medium text-sm transition-colors flex items-center justify-center gap-2"
                      >
                        <Pause className="w-4 h-4" />
                        Pause Agent
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStatusChange('active')}
                        className="w-full py-3 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 font-medium text-sm transition-colors flex items-center justify-center gap-2"
                      >
                        <Play className="w-4 h-4" />
                        Resume Agent
                      </button>
                    )}

                    <button
                      onClick={handleDeprovision}
                      className="w-full py-3 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 font-medium text-sm transition-colors flex items-center justify-center gap-2"
                    >
                      <Square className="w-4 h-4" />
                      Stop & Deprovision
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        )}

        {/* ═══ MARKETPLACE TAB ═══ */}
        {dashTab === 'marketplace' && (
        <div className="max-w-6xl mx-auto space-y-6">

          {/* Marketplace Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-4">
              <p className="text-xs text-gray-400 mb-1">My Services</p>
              <p className="text-2xl font-bold text-white">{myServices.length}</p>
            </div>
            <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-4">
              <p className="text-xs text-gray-400 mb-1">Pending Requests</p>
              <p className="text-2xl font-bold text-[#D4AF37]">{incomingRequests.filter(r => r.status === 'pending').length}</p>
            </div>
            <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-4">
              <p className="text-xs text-gray-400 mb-1">Delivered</p>
              <p className="text-2xl font-bold text-emerald-400">{incomingRequests.filter(r => r.status === 'delivered').length}</p>
            </div>
            <div className="bg-gradient-to-r from-[#D4AF37]/10 to-[#FFD700]/10 border border-[#D4AF37]/20 rounded-2xl p-4">
              <p className="text-xs text-gray-400 mb-1">Marketplace Earnings</p>
              <p className="text-2xl font-bold text-[#D4AF37]">{marketplaceEarnings.toFixed(2)} USDC</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* ── My Services ─────────────────────────── */}
            <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-white flex items-center gap-2">
                  <Package className="w-5 h-5 text-[#D4AF37]" />
                  My Services
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      setProposeLoading(true)
                      setProposeError(null)
                      try {
                        const res = await fetch(`/api/agents/${agentId}/services/propose`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ count: 3 }),
                        })
                        const data = await res.json()
                        if (!res.ok || !data.drafts?.length) {
                          setProposeError(data.error || 'Agent could not draft services')
                        } else {
                          setServiceDrafts(data.drafts)
                        }
                      } catch {
                        setProposeError('Network error — try again')
                      } finally {
                        setProposeLoading(false)
                      }
                    }}
                    disabled={proposeLoading}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 text-gray-300 text-xs font-medium hover:bg-white/10 transition-colors disabled:opacity-50"
                    title={`Let ${agent?.name || 'your agent'} propose services based on its skills`}
                  >
                    {proposeLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <span>✨</span>}
                    {proposeLoading ? 'Drafting…' : 'Propose with AI'}
                  </button>
                  <button
                    onClick={() => setAddingService(!addingService)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#D4AF37]/10 text-[#D4AF37] text-xs font-medium hover:bg-[#D4AF37]/20 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Add Service
                  </button>
                </div>
              </div>

              {/* Propose error banner */}
              {proposeError && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                  {proposeError}
                  <button onClick={() => setProposeError(null)} className="ml-2 underline">dismiss</button>
                </div>
              )}

              {/* Agent-proposed drafts — reviewable before publishing */}
              {serviceDrafts.length > 0 && (
                <div className="mb-4 p-4 bg-[#D4AF37]/5 rounded-xl border border-[#D4AF37]/20 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-[#D4AF37] flex items-center gap-1.5">
                      <span>✨</span> Drafts from your agent — review before publishing
                    </div>
                    <button
                      onClick={() => setServiceDrafts([])}
                      className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      Dismiss all
                    </button>
                  </div>
                  {serviceDrafts.map((d, i) => (
                    <div key={i} className="p-3 bg-black/30 rounded-lg border border-white/5 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-white truncate">{d.name}</p>
                          <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{d.description}</p>
                          {d.reasoning && (
                            <p className="text-[10px] text-gray-500 mt-1.5 italic">Why: {d.reasoning}</p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-0.5 shrink-0">
                          <span className="text-sm font-bold text-[#D4AF37] tabular-nums">{d.price} USDC</span>
                          <span className="text-[10px] text-gray-500 uppercase">{d.category}</span>
                        </div>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={async () => {
                            setPublishingDraftIdx(i)
                            try {
                              const res = await fetch(`/api/agents/${agentId}/services`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ name: d.name, description: d.description, price: d.price, category: d.category }),
                              })
                              const data = await res.json()
                              if (data.success) {
                                setMyServices(data.services)
                                setServiceDrafts(prev => prev.filter((_, j) => j !== i))
                              } else {
                                alert('Error: ' + (data.error || 'Failed to publish'))
                              }
                            } catch {
                              alert('Failed to publish')
                            } finally {
                              setPublishingDraftIdx(null)
                            }
                          }}
                          disabled={publishingDraftIdx !== null}
                          className="px-3 py-1.5 rounded-lg bg-[#D4AF37] text-black text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                          {publishingDraftIdx === i ? 'Publishing…' : 'Publish'}
                        </button>
                        <button
                          onClick={() => {
                            setNewService({ name: d.name, description: d.description, price: String(d.price), category: d.category })
                            setAddingService(true)
                            setServiceDrafts(prev => prev.filter((_, j) => j !== i))
                          }}
                          className="px-3 py-1.5 rounded-lg bg-white/5 text-gray-300 text-xs font-medium hover:bg-white/10 transition-colors"
                        >
                          Edit first
                        </button>
                        <button
                          onClick={() => setServiceDrafts(prev => prev.filter((_, j) => j !== i))}
                          className="px-3 py-1.5 rounded-lg text-gray-500 text-xs hover:text-gray-300 transition-colors"
                        >
                          Skip
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Service Form */}
              {addingService && (
                <div className="mb-4 p-4 bg-white/5 rounded-xl border border-white/10 space-y-3">
                  <input
                    type="text"
                    placeholder="Service name (e.g. Market Analysis)"
                    value={newService.name}
                    onChange={e => setNewService(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-[#D4AF37]/50"
                  />
                  <textarea
                    placeholder="What does this service do?"
                    value={newService.description}
                    onChange={e => setNewService(prev => ({ ...prev, description: e.target.value }))}
                    rows={2}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm resize-none focus:outline-none focus:border-[#D4AF37]/50"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Price (USDC)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.5"
                        value={newService.price}
                        onChange={e => setNewService(prev => ({ ...prev, price: e.target.value }))}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-[#D4AF37]/50"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Category</label>
                      <select
                        value={newService.category}
                        onChange={e => setNewService(prev => ({ ...prev, category: e.target.value }))}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-[#D4AF37]/50"
                      >
                        {SERVICE_CATEGORIES.map(c => (
                          <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        if (!newService.name || !newService.description || !newService.price) return
                        try {
                          const res = await fetch(`/api/agents/${agentId}/services`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(newService),
                          })
                          const data = await res.json()
                          if (data.success) {
                            setMyServices(data.services)
                            setNewService({ name: '', description: '', price: '', category: 'analysis' })
                            setAddingService(false)
                          } else {
                            alert('Error: ' + (data.error || 'Failed to add service'))
                          }
                        } catch { alert('Failed to add service') }
                      }}
                      className="flex-1 py-2 rounded-lg bg-[#D4AF37] text-black text-sm font-bold hover:opacity-90 transition-opacity"
                    >
                      Add Service
                    </button>
                    <button
                      onClick={() => { setAddingService(false); setNewService({ name: '', description: '', price: '', category: 'analysis' }) }}
                      className="px-4 py-2 rounded-lg bg-white/5 text-gray-400 text-sm hover:bg-white/10 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Services List */}
              {myServices.length === 0 ? (
                <div className="text-center py-8">
                  <Store className="w-10 h-10 text-gray-600 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No services yet</p>
                  <p className="text-xs text-gray-600 mt-1">Add services so other agents can hire yours</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {myServices.map(svc => (
                    <div key={svc.id} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white">{svc.name}</span>
                          <span className="text-xs px-2 py-0.5 bg-white/10 rounded text-gray-400">{svc.category}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 truncate">{svc.description}</p>
                      </div>
                      <div className="flex items-center gap-3 ml-3">
                        <span className="text-sm font-bold text-[#D4AF37]">{svc.price} USDC</span>
                        <button
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/agents/${agentId}/services`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ serviceId: svc.id, enabled: !svc.enabled }),
                              })
                              const data = await res.json()
                              if (data.success) setMyServices(data.services)
                            } catch { /* ignore */ }
                          }}
                          className={`w-8 h-5 rounded-full transition-colors relative ${svc.enabled ? 'bg-emerald-500' : 'bg-gray-600'}`}
                        >
                          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${svc.enabled ? 'left-3.5' : 'left-0.5'}`} />
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm('Remove this service?')) return
                            try {
                              const res = await fetch(`/api/agents/${agentId}/services`, {
                                method: 'DELETE',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ serviceId: svc.id }),
                              })
                              const data = await res.json()
                              if (data.success) setMyServices(data.services)
                            } catch { /* ignore */ }
                          }}
                          className="text-gray-600 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Incoming Requests ───────────────────── */}
            <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
              <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-[#D4AF37]" />
                Incoming Requests
              </h3>

              {incomingRequests.length === 0 ? (
                <div className="text-center py-8">
                  <MessageCircle className="w-10 h-10 text-gray-600 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No requests yet</p>
                  <p className="text-xs text-gray-600 mt-1">Requests from other agents will appear here</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {incomingRequests.map(req => (
                    <div key={req.id} className="p-3 bg-white/5 rounded-xl border border-white/5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-white">{req.requesterName}</span>
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                          req.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                          req.status === 'delivered' ? 'bg-emerald-500/20 text-emerald-400' :
                          req.status === 'processing' ? 'bg-blue-500/20 text-blue-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          {req.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 line-clamp-2">{req.prompt}</p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-gray-500">{new Date(req.createdAt).toLocaleDateString()}</span>
                        <span className="text-xs font-medium text-[#D4AF37]">{req.price} USDC</span>
                      </div>
                      {req.status === 'pending' && (
                        <button
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/marketplace/${req.id}/fulfill`, { method: 'POST' })
                              const data = await res.json()
                              if (data.success) {
                                setIncomingRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'delivered' } : r))
                                setMarketplaceEarnings(prev => prev + req.price)
                              } else {
                                alert('Error: ' + (data.error || 'Failed to fulfill'))
                              }
                            } catch { alert('Failed to fulfill request') }
                          }}
                          className="w-full mt-2 py-2 rounded-lg bg-[#D4AF37] text-black text-xs font-bold hover:opacity-90 transition-opacity"
                        >
                          Fulfill Request
                        </button>
                      )}
                      {req.status === 'delivered' && req.resultPreview && (
                        <div className="mt-2 p-2 bg-white/5 rounded-lg">
                          <p className="text-xs text-gray-400 line-clamp-3">{req.resultPreview}</p>
                          {req.resultBlobId && req.resultBlobId !== 'none' && (
                            <p className="text-[10px] text-gray-600 mt-1 font-mono">Walrus: {req.resultBlobId.slice(0, 16)}...</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Browse Marketplace ─────────────────── */}
          <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
            <h3 className="font-bold text-white mb-4 flex items-center gap-2">
              <Globe className="w-5 h-5 text-[#D4AF37]" />
              Browse Agent Services
            </h3>
            <p className="text-xs text-gray-400 mb-4">Hire other agents to perform tasks for yours. Results are stored on Walrus decentralized storage.</p>

            {marketplaceServices.length === 0 ? (
              <div className="text-center py-8">
                <Store className="w-10 h-10 text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No services available yet</p>
                <p className="text-xs text-gray-600 mt-1">Be the first to list a service!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {marketplaceServices
                  .filter(s => s.agentId !== agentId)
                  .map(svc => (
                  <div key={`${svc.agentId}-${svc.serviceId}`} className="p-4 bg-white/5 rounded-xl border border-white/5 hover:border-[#D4AF37]/20 transition-colors">
                    <div className="flex items-center gap-2 mb-2">
                      {svc.agentAvatar ? (
                        <img src={svc.agentAvatar} alt="" className="w-8 h-8 rounded-full" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#FFD700] flex items-center justify-center text-xs font-bold text-black">
                          {svc.agentSymbol?.slice(0, 2) || '??'}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{svc.agentName}</p>
                        <p className="text-[10px] text-gray-500">${svc.agentSymbol}</p>
                      </div>
                    </div>
                    <p className="text-sm font-medium text-white">{svc.name}</p>
                    <p className="text-xs text-gray-400 mt-1 line-clamp-2">{svc.description}</p>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-xs px-2 py-0.5 bg-white/10 rounded text-gray-400">{svc.category}</span>
                      <span className="text-sm font-bold text-[#D4AF37]">{svc.price} USDC</span>
                    </div>

                    {hiringAgent === svc.serviceId ? (
                      <div className="mt-3 space-y-2">
                        <textarea
                          placeholder="What do you need? Be specific..."
                          value={hirePrompt}
                          onChange={e => setHirePrompt(e.target.value)}
                          rows={2}
                          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-xs resize-none focus:outline-none focus:border-[#D4AF37]/50"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              if (!hirePrompt.trim()) return
                              setHiring(true)
                              try {
                                const res = await fetch('/api/marketplace', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    serviceId: svc.serviceId,
                                    providerId: svc.agentId,
                                    requesterId: agentId,
                                    requesterType: 'agent',
                                    prompt: hirePrompt,
                                  }),
                                })
                                const data = await res.json()
                                if (data.success) {
                                  setHiringAgent(null)
                                  setHirePrompt('')
                                  alert('Request submitted! The provider agent will fulfill it shortly.')
                                } else {
                                  alert('Error: ' + (data.error || 'Failed to create request'))
                                }
                              } catch { alert('Failed to hire agent') }
                              finally { setHiring(false) }
                            }}
                            disabled={hiring || !hirePrompt.trim()}
                            className="flex-1 py-2 rounded-lg bg-[#D4AF37] text-black text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                          >
                            {hiring ? 'Submitting...' : `Hire for ${svc.price} USDC`}
                          </button>
                          <button
                            onClick={() => { setHiringAgent(null); setHirePrompt('') }}
                            className="px-3 py-2 rounded-lg bg-white/5 text-gray-400 text-xs hover:bg-white/10 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setHiringAgent(svc.serviceId); setHirePrompt('') }}
                        className="w-full mt-3 py-2 rounded-lg bg-white/5 hover:bg-[#D4AF37]/10 text-gray-300 hover:text-[#D4AF37] text-xs font-medium transition-colors"
                      >
                        Hire Agent
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        )}

        {/* ═══ SETTINGS TAB ═══ */}
        {dashTab === 'settings' && (
        <div className="max-w-4xl mx-auto space-y-6">

          {/* Success Banner */}
          <AnimatePresence>
            {saveSuccess && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-emerald-500/20 border border-emerald-500/30 rounded-lg p-3 flex items-center gap-2 text-emerald-400 text-sm"
              >
                <Check className="w-4 h-4" />
                {saveSuccess === 'provisioned' ? 'Agent provisioned on OpenClaw worker!' :
                 saveSuccess === 'general' ? 'General settings saved & synced to worker' :
                 saveSuccess === 'soul' ? 'SOUL.md updated & synced to worker' :
                 saveSuccess === 'model' ? 'Model updated & synced to worker' :
                 saveSuccess === 'reset' ? 'Chat history cleared' :
                 'Settings saved'}
              </motion.div>
            )}
          </AnimatePresence>

          {/* General Settings */}
          <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
            <h3 className="font-bold text-white mb-4 flex items-center gap-2">
              <Edit className="w-5 h-5 text-[#D4AF37]" />
              General
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Agent Name</label>
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Description</label>
                <textarea
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 resize-none"
                />
              </div>
              <button
                onClick={handleSaveGeneral}
                disabled={saving}
                className="px-6 py-2.5 rounded-lg bg-[#D4AF37] text-black font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save General'}
              </button>
            </div>
          </div>

          {/* SOUL.md / Personality */}
          <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
            <h3 className="font-bold text-white mb-2 flex items-center gap-2">
              <Brain className="w-5 h-5 text-[#D4AF37]" />
              SOUL.md
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Define your agent&apos;s personality, voice, and behavior. This becomes the agent&apos;s SOUL.md on OpenClaw.
            </p>
            <textarea
              value={editPersonality}
              onChange={e => setEditPersonality(e.target.value)}
              rows={8}
              placeholder="You are a bold, data-driven trading agent. You speak with confidence and back up every claim with numbers..."
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 resize-none"
            />
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-gray-500">{editPersonality.length} characters</span>
              <button
                onClick={handleSavePersonality}
                disabled={saving}
                className="px-6 py-2.5 rounded-lg bg-[#D4AF37] text-black font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save SOUL.md'}
              </button>
            </div>
          </div>

          {/* Skills (max 7) */}
          <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
            <h3 className="font-bold text-white mb-2 flex items-center gap-2">
              <Zap className="w-5 h-5 text-[#D4AF37]" />
              Skills
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Select up to 7 skills for your agent. Skills determine what your agent can do autonomously.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {AVAILABLE_SKILLS.map(skill => {
                const active = editSkills.includes(skill.id)
                return (
                  <button
                    key={skill.id}
                    onClick={() => handleToggleSkill(skill.id)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      active
                        ? 'bg-[#D4AF37]/10 border-[#D4AF37]/40 text-white'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{skill.icon}</span>
                      <span className="text-sm font-medium">{skill.label}</span>
                      {active && <Check className="w-3.5 h-3.5 text-[#D4AF37] ml-auto" />}
                    </div>
                    <p className="text-xs opacity-60">{skill.desc}</p>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-gray-500 mt-3">{editSkills.length}/7 skills selected</p>
          </div>

          {/* Model Selection */}
          <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6 relative z-20 overflow-visible">
            <h3 className="font-bold text-white mb-4 flex items-center gap-2">
              <Cpu className="w-5 h-5 text-[#D4AF37]" />
              Model
            </h3>
            <div className="relative">
              <button
                onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-left flex items-center justify-between hover:border-white/20 transition-colors"
              >
                <div>
                  <span className="text-white text-sm font-medium">
                    {MODEL_OPTIONS.find(m => m.id === editModel)?.name || editModel}
                  </span>
                  <span className="text-xs text-gray-500 ml-2">
                    {MODEL_OPTIONS.find(m => m.id === editModel)?.provider}
                  </span>
                </div>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${modelDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {modelDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="absolute z-30 w-full mt-2 bg-slate-800 border border-white/10 rounded-xl overflow-hidden shadow-xl"
                  >
                    {MODEL_OPTIONS.map(model => (
                      <button
                        key={model.id}
                        onClick={() => handleSaveModel(model.id)}
                        className={`w-full px-4 py-3 text-left flex items-center justify-between hover:bg-white/5 transition-colors ${
                          model.id === editModel ? 'bg-[#D4AF37]/10' : ''
                        }`}
                      >
                        <div>
                          <span className="text-white text-sm">{model.name}</span>
                          <span className="text-xs text-gray-500 ml-2">{model.provider}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">{model.speed}</span>
                          {model.tier === 'pro' && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#D4AF37]/20 text-[#D4AF37]">PRO</span>
                          )}
                          {model.id === editModel && <Check className="w-4 h-4 text-[#D4AF37]" />}
                        </div>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Channels */}
          <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
            <h3 className="font-bold text-white mb-2 flex items-center gap-2">
              <Globe className="w-5 h-5 text-[#D4AF37]" />
              Channels
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Deploy your agent to external channels. Each channel runs as an autonomous OpenClaw session.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Telegram */}
              <div className={`p-4 rounded-xl border ${agent.telegramConfig?.enabled ? 'bg-white/5 border-emerald-500/30' : 'bg-white/5 border-white/10'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <MessageCircle className="w-5 h-5 text-blue-400" />
                  <span className="text-sm text-white font-medium">Telegram</span>
                </div>
                {agent.telegramConfig?.enabled && (
                  <p className="text-[10px] text-emerald-400 mb-2">@{agent.telegramConfig.botUsername || 'connected'}</p>
                )}
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => setShowTelegramSetup(true)}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                      agent.telegramConfig?.enabled
                        ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                        : 'bg-white/5 hover:bg-white/10 text-gray-400'
                    }`}
                  >
                    {agent.telegramConfig?.enabled ? 'Connected' : 'Connect'}
                  </button>
                  {agent.telegramConfig?.enabled && (
                    <button
                      onClick={async () => {
                        if (!confirm('Disconnect the Telegram bot?')) return
                        setTelegramDisconnecting(true)
                        try {
                          await fetch(`/api/agents/${agent.id}/telegram/setup`, { method: 'DELETE' })
                          setAgent((a: any) => ({ ...a, telegramConfig: undefined }))
                        } finally {
                          setTelegramDisconnecting(false)
                        }
                      }}
                      disabled={telegramDisconnecting}
                      className="px-3 py-2 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      {telegramDisconnecting ? '…' : 'Disconnect'}
                    </button>
                  )}
                </div>
              </div>

              {/* Twitter / X */}
              <div className={`p-4 rounded-xl border ${!!agent.twitter ? 'bg-white/5 border-emerald-500/30' : 'bg-white/5 border-white/10'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <ExternalLink className="w-5 h-5 text-sky-400" />
                  <span className="text-sm text-white font-medium">Twitter / X</span>
                </div>
                <button className={`w-full py-2 rounded-lg text-xs font-medium transition-colors ${!!agent.twitter ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 hover:bg-white/10 text-gray-400'}`}>
                  {!!agent.twitter ? 'Connected' : 'Connect'}
                </button>
              </div>

              {/* Discord */}
              <div className="p-4 rounded-xl border bg-white/5 border-white/10">
                <div className="flex items-center gap-2 mb-2">
                  <Hash className="w-5 h-5 text-indigo-400" />
                  <span className="text-sm text-white font-medium">Discord</span>
                </div>
                <button className="w-full py-2 rounded-lg text-xs font-medium bg-white/5 hover:bg-white/10 text-gray-400 transition-colors">
                  Connect
                </button>
              </div>
            </div>
          </div>

          {/* Telegram Setup Modal */}
          {showTelegramSetup && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
              <div className="bg-[#0d0f1a] border border-white/10 rounded-2xl p-6 w-full max-w-md">
                <h3 className="text-white font-bold text-lg mb-1">Connect Telegram Bot</h3>
                <p className="text-gray-400 text-sm mb-4">
                  Create a bot via <span className="text-blue-400">@BotFather</span> on Telegram, copy the token, and paste it below. Your agent will respond to anyone who messages the bot.
                </p>

                <ol className="text-xs text-gray-500 mb-4 space-y-1 list-decimal list-inside">
                  <li>Open Telegram → search <span className="text-white">@BotFather</span></li>
                  <li>Send <code className="bg-white/5 px-1 rounded">/newbot</code> and follow the prompts</li>
                  <li>Copy the API token BotFather gives you</li>
                  <li>Paste it below and click Save</li>
                </ol>

                <label className="text-xs text-gray-400 mb-1 block">Bot Token</label>
                <input
                  type="text"
                  value={telegramBotToken}
                  onChange={e => { setTelegramBotToken(e.target.value); setTelegramError(null) }}
                  placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50 mb-3 font-mono"
                />

                <label className="text-xs text-gray-400 mb-1 block">Channel IDs <span className="text-gray-600">(optional — for proactive posts)</span></label>
                {telegramChannelIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {telegramChannelIds.map(cid => (
                      <span key={cid} className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-md px-2 py-1 text-xs text-gray-300 font-mono">
                        {cid}
                        <button onClick={() => setTelegramChannelIds(ids => ids.filter(i => i !== cid))} className="text-gray-500 hover:text-red-400 transition-colors">×</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={telegramChannelInput}
                    onChange={e => setTelegramChannelInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault()
                        const val = telegramChannelInput.trim()
                        if (val && !telegramChannelIds.includes(val)) setTelegramChannelIds(ids => [...ids, val])
                        setTelegramChannelInput('')
                      }
                    }}
                    placeholder="-1001234567890  or  @yourchannel"
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50 font-mono"
                  />
                  <button
                    onClick={() => {
                      const val = telegramChannelInput.trim()
                      if (val && !telegramChannelIds.includes(val)) setTelegramChannelIds(ids => [...ids, val])
                      setTelegramChannelInput('')
                    }}
                    className="px-3 py-2 rounded-lg text-sm bg-white/5 text-gray-400 hover:bg-white/10 transition-colors"
                  >Add</button>
                </div>

                {telegramError && (
                  <p className="text-red-400 text-xs mb-3">{telegramError}</p>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowTelegramSetup(false); setTelegramBotToken(''); setTelegramChannelIds([]); setTelegramChannelInput(''); setTelegramError(null) }}
                    className="flex-1 py-2 rounded-lg text-sm text-gray-400 bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      if (!telegramBotToken.trim()) return
                      setTelegramSaving(true)
                      setTelegramError(null)
                      try {
                        const res = await fetch(`/api/agents/${agent.id}/telegram/setup`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ botToken: telegramBotToken.trim(), channelIds: telegramChannelIds }),
                        })
                        const data = await res.json()
                        if (!res.ok) {
                          setTelegramError(data.error || 'Setup failed')
                          return
                        }
                        // Refresh agent data so UI shows connected state
                        const agentRes = await fetch(`/api/agents/${agent.id}`)
                        if (agentRes.ok) setAgent(await agentRes.json())
                        setShowTelegramSetup(false)
                        setTelegramBotToken('')
                        setTelegramChannelIds([])
                        setTelegramChannelInput('')
                      } catch (e: any) {
                        setTelegramError(e.message)
                      } finally {
                        setTelegramSaving(false)
                      }
                    }}
                    disabled={telegramSaving || !telegramBotToken.trim()}
                    className="flex-1 py-2 rounded-lg text-sm font-medium bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50 transition-colors"
                  >
                    {telegramSaving ? 'Connecting…' : 'Save & Connect'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* API Keys */}
          <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
            <h3 className="font-bold text-white mb-2 flex items-center gap-2">
              <Key className="w-5 h-5 text-[#D4AF37]" />
              API Connections
              {saveSuccess === 'apikey' && <span className="text-xs text-green-400 ml-auto">Saved!</span>}
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Add API credentials so your agent can interact with external services (exchanges, protocols, webhooks).
              Keys are stored encrypted and never shown in chat.
            </p>

            {/* Existing API Keys */}
            {(agent.apiKeys || []).map((key: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-3 bg-white/5 rounded-lg mb-2 border border-white/5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#D4AF37]/10 flex items-center justify-center">
                    <Key className="w-4 h-4 text-[#D4AF37]" />
                  </div>
                  <div>
                    <p className="text-sm text-white font-medium">{key.name}</p>
                    <p className="text-xs text-gray-500">{key.baseUrl}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveApiKey(i)}
                  className="p-1.5 text-gray-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}

            {/* Add New API Key Form */}
            {showApiKeyForm ? (
              <div className="mt-3 p-4 bg-white/5 rounded-xl border border-white/10 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Name</label>
                    <input
                      type="text"
                      value={newApiKey.name}
                      onChange={e => setNewApiKey(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g. Hyperliquid"
                      className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600 focus:border-[#D4AF37]/50 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Base URL</label>
                    <input
                      type="text"
                      value={newApiKey.baseUrl}
                      onChange={e => setNewApiKey(prev => ({ ...prev, baseUrl: e.target.value }))}
                      placeholder="https://api.hyperliquid.xyz"
                      className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600 focus:border-[#D4AF37]/50 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Header Name</label>
                    <input
                      type="text"
                      value={newApiKey.headerKey}
                      onChange={e => setNewApiKey(prev => ({ ...prev, headerKey: e.target.value }))}
                      placeholder="Authorization"
                      className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600 focus:border-[#D4AF37]/50 focus:outline-none"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-gray-400 mb-1 block">Header Value (API Key)</label>
                    <input
                      type="password"
                      value={newApiKey.headerValue}
                      onChange={e => setNewApiKey(prev => ({ ...prev, headerValue: e.target.value }))}
                      placeholder="Bearer sk-..."
                      className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600 focus:border-[#D4AF37]/50 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleAddApiKey}
                    disabled={!newApiKey.name || !newApiKey.baseUrl || !newApiKey.headerValue}
                    className="px-4 py-2 bg-[#D4AF37] text-black font-medium text-sm rounded-lg hover:bg-[#FFD700] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Save Key
                  </button>
                  <button
                    onClick={() => { setShowApiKeyForm(false); setNewApiKey({ name: '', baseUrl: '', headerKey: 'Authorization', headerValue: '' }) }}
                    className="px-4 py-2 bg-white/5 text-gray-400 text-sm rounded-lg hover:bg-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowApiKeyForm(true)}
                className="mt-2 flex items-center gap-2 px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-300 hover:bg-white/10 transition-colors w-full"
              >
                <Plus className="w-4 h-4" />
                Add API Connection
              </button>
            )}
          </div>

          {/* Trading Configuration */}
          <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
            <h3 className="font-bold text-white mb-2 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-[#D4AF37]" />
              Autonomous Trading
              {saveSuccess === 'trading' && <span className="text-xs text-green-400 ml-auto">Saved!</span>}
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Enable autonomous trading. The agent will analyze markets and execute trades on the configured interval.
              Requires an API connection to an exchange (e.g. Hyperliquid).
            </p>

            {!(agent.apiKeys || []).length ? (
              <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <div className="flex items-center gap-2 text-yellow-400 text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  Add an exchange API connection above first
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Exchange</label>
                    <select
                      value={tradingConfig.exchange}
                      onChange={e => setTradingConfig(prev => ({ ...prev, exchange: e.target.value }))}
                      className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-sm text-white focus:border-[#D4AF37]/50 focus:outline-none"
                    >
                      <option value="hyperliquid">Hyperliquid</option>
                      <option value="bluefin">Bluefin</option>
                      <option value="cetus">Cetus</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Check Interval</label>
                    <select
                      value={tradingConfig.intervalSeconds}
                      onChange={e => setTradingConfig(prev => ({ ...prev, intervalSeconds: Number(e.target.value) }))}
                      className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-sm text-white focus:border-[#D4AF37]/50 focus:outline-none"
                    >
                      <option value={15}>Every 15s</option>
                      <option value={30}>Every 30s</option>
                      <option value={60}>Every 1m</option>
                      <option value={300}>Every 5m</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Max Position Size (USD)</label>
                    <input
                      type="number"
                      value={tradingConfig.maxPositionSize}
                      onChange={e => setTradingConfig(prev => ({ ...prev, maxPositionSize: Number(e.target.value) }))}
                      className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-sm text-white focus:border-[#D4AF37]/50 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block flex items-center gap-1">
                      <Shield className="w-3 h-3" /> Max Loss Kill Switch (USD)
                    </label>
                    <input
                      type="number"
                      value={tradingConfig.maxLoss}
                      onChange={e => setTradingConfig(prev => ({ ...prev, maxLoss: Number(e.target.value) }))}
                      className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-sm text-white focus:border-[#D4AF37]/50 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Trading Strategy (instructions for the AI)</label>
                  <textarea
                    value={tradingConfig.strategy}
                    onChange={e => setTradingConfig(prev => ({ ...prev, strategy: e.target.value }))}
                    placeholder="e.g. Trade BTC/USDC on Hyperliquid. Go long when RSI < 30, short when RSI > 70. Use 2x leverage max. Always set a 3% stop loss."
                    rows={3}
                    className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600 focus:border-[#D4AF37]/50 focus:outline-none resize-none"
                  />
                </div>
                <button
                  onClick={handleSaveTradingConfig}
                  disabled={!tradingConfig.strategy}
                  className="w-full py-2.5 bg-gradient-to-r from-[#D4AF37] to-[#FFD700] text-black font-bold text-sm rounded-lg hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {agent.tradingEnabled ? 'Update Trading Config' : 'Enable Autonomous Trading'}
                </button>
                {agent.tradingEnabled && (
                  <button
                    onClick={async () => {
                      try {
                        const res = await signAndPatch({ tradingEnabled: false })
                        if (res.ok) setAgent((prev: any) => ({ ...prev, tradingEnabled: false }))
                      } catch (err) { console.error('Disable trading error:', err) }
                    }}
                    className="w-full py-2 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg hover:bg-red-500/20 transition-colors"
                  >
                    Disable Trading
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Danger Zone */}
          <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-6">
            <h3 className="font-bold text-red-400 mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Danger Zone
            </h3>
            <div className="space-y-3">
              <button
                onClick={handleResetChat}
                className="w-full py-3 rounded-lg bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-colors flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Reset Chat History
              </button>

              {!showDeleteConfirm ? (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full py-3 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 font-medium text-sm transition-colors flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Agent
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={handleDeleteAgent}
                    className="flex-1 py-3 rounded-lg bg-red-600 text-white font-bold text-sm hover:bg-red-700 transition-colors"
                  >
                    Confirm Delete
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 py-3 rounded-lg bg-white/10 text-gray-300 font-medium text-sm hover:bg-white/15 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        )}

        {/* ═══ WALLET TAB ═══ */}
        {dashTab === 'wallet' && (
        <div className="max-w-4xl mx-auto space-y-6">

          {/* Earnings Overview */}
          <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
            <h3 className="font-bold text-white mb-4 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-[#D4AF37]" />
              Agent Earnings
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-gradient-to-r from-[#D4AF37]/10 to-[#FFD700]/10 border border-[#D4AF37]/20 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">Creator Earnings (40%)</p>
                <p className="text-2xl font-bold text-[#D4AF37]">{agent.earnings?.toFixed(3) || '0.000'} SUI</p>
              </div>
              <div className="bg-white/5 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">Market Cap</p>
                <p className="text-2xl font-bold text-white">${(agent.marketCap / 1000).toFixed(1)}K</p>
              </div>
              <div className="bg-white/5 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">24h Volume</p>
                <p className="text-2xl font-bold text-white">${((agent.volume24h || 0) / 1000).toFixed(1)}K</p>
              </div>
            </div>
            <button
              onClick={async () => {
                if (!agent.earnings || agent.earnings <= 0) {
                  alert('No earnings to withdraw')
                  return
                }
                try {
                  const res = await fetch(`/api/agents/${agent.id}/withdraw`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ creatorAddress: address }),
                  })
                  const data = await res.json()
                  if (data.success) {
                    alert(`Earnings: ${data.earnings?.toFixed(4)} SUI\n\nNote: ${data.note}`)
                  } else {
                    alert('Error: ' + data.error)
                  }
                } catch (err) {
                  console.error('Withdraw error:', err)
                  alert('Failed to check earnings')
                }
              }}
              className="w-full mt-4 py-3 rounded-lg bg-[#D4AF37] text-black font-bold hover:opacity-90 transition-opacity"
            >
              Withdraw Earnings
            </button>
          </div>

          {/* Agent Card */}
          <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
            <h3 className="font-bold text-white mb-4 flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-[#D4AF37]" />
              Agent Virtual Card
            </h3>

            {cardData?.hasCard && cardData.card ? (
              <>
                {/* Live Card Display */}
                <div className="bg-gradient-to-br from-[#D4AF37]/10 to-[#FFD700]/5 border border-[#D4AF37]/20 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-xs text-gray-400">{cardData.card.brand?.toUpperCase() || 'VISA'} Virtual Card</p>
                      <p className="text-lg font-bold text-white mt-1">•••• •••• •••• {cardData.card.last4}</p>
                    </div>
                    <div className={`px-2 py-1 rounded text-xs font-medium ${
                      cardData.card.status === 'active'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : cardData.card.status === 'inactive'
                        ? 'bg-yellow-500/20 text-yellow-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}>
                      {cardData.card.status === 'active' ? 'Active' : cardData.card.status === 'inactive' ? 'Frozen' : cardData.card.status}
                    </div>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{agent.name}</span>
                    <span>Exp: {String(cardData.card.expMonth).padStart(2, '0')}/{String(cardData.card.expYear).slice(-2)}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 gap-2 mt-4">
                  <button
                    onClick={async () => {
                      setTopUpLoading(true)
                      try {
                        const res = await fetch(`/api/agents/${agent.id}/topup`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ amount: 5000 }),
                        })
                        const data = await res.json()
                        if (data.url) {
                          window.location.href = data.url
                        } else {
                          alert('Error: ' + (data.error || 'Failed to create top-up'))
                        }
                      } catch { alert('Top-up failed') }
                      finally { setTopUpLoading(false) }
                    }}
                    disabled={topUpLoading || cardData.card.status !== 'active'}
                    className="py-3 rounded-lg bg-[#D4AF37] text-black font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {topUpLoading ? 'Processing...' : 'Top Up $50'}
                  </button>
                  <button
                    onClick={async () => {
                      setFreezingCard(true)
                      const newStatus = cardData.card!.status === 'active' ? 'inactive' : 'active'
                      try {
                        const res = await fetch(`/api/agents/${agent.id}/card`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ status: newStatus }),
                        })
                        if (res.ok) {
                          setCardData(prev => prev ? { ...prev, card: { ...prev.card!, status: newStatus } } : prev)
                        } else {
                          const err = await res.json()
                          alert('Error: ' + (err.error || 'Failed to update card'))
                        }
                      } catch { alert('Failed to update card') }
                      finally { setFreezingCard(false) }
                    }}
                    disabled={freezingCard}
                    className={`py-3 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 ${
                      cardData.card.status === 'active'
                        ? 'bg-white/5 hover:bg-red-500/20 text-gray-300 hover:text-red-400'
                        : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400'
                    }`}
                  >
                    {freezingCard ? 'Processing...' : cardData.card.status === 'active' ? 'Freeze Card' : 'Unfreeze Card'}
                  </button>
                </div>

                {/* Transactions */}
                {cardData.transactions && cardData.transactions.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-gray-500 mb-3">Recent Transactions</p>
                    <div className="space-y-2">
                      {cardData.transactions.slice(0, 10).map(tx => (
                        <div key={tx.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                          <div>
                            <p className="text-sm text-white">{tx.merchant}</p>
                            <p className="text-xs text-gray-500">{new Date(tx.created).toLocaleDateString()}</p>
                          </div>
                          <span className={`text-sm font-medium ${tx.amount < 0 ? 'text-white' : 'text-emerald-400'}`}>
                            {tx.amount < 0 ? '-' : '+'}${Math.abs(tx.amount).toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-6">
                <div className="w-16 h-10 mx-auto mb-4 rounded-lg bg-gradient-to-br from-[#D4AF37]/20 to-[#FFD700]/10 border border-[#D4AF37]/30 flex items-center justify-center">
                  <CreditCard className="w-6 h-6 text-[#D4AF37]/60" />
                </div>
                <p className="text-sm text-gray-400 mb-2">No card issued yet</p>
                <p className="text-xs text-gray-600 mb-4">Issue a virtual Visa card so your agent can pay for APIs, services, and subscriptions autonomously.</p>
                <button
                  onClick={async () => {
                    setIssuingCard(true)
                    try {
                      const res = await fetch(`/api/agents/${agent.id}/card`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ initialBalance: 5000 }),
                      })
                      const data = await res.json()
                      if (data.success) {
                        setCardData({ hasCard: true, card: data.card, transactions: [] })
                      } else {
                        alert('Error: ' + (data.error || 'Failed to issue card'))
                      }
                    } catch { alert('Failed to issue card') }
                    finally { setIssuingCard(false) }
                  }}
                  disabled={issuingCard}
                  className="px-8 py-3 rounded-lg bg-[#D4AF37] text-black font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {issuingCard ? 'Issuing...' : 'Issue Virtual Card'}
                </button>
              </div>
            )}
          </div>

          {/* Agent Sui Wallet */}
          <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
            <h3 className="font-bold text-white mb-4 flex items-center gap-2">
              <Wallet className="w-5 h-5 text-[#D4AF37]" />
              Agent Sui Wallet
            </h3>
            {agentWallet ? (
              <div className="space-y-4">
                {/* Address row */}
                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-400 mb-1">Wallet Address</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs text-white font-mono truncate flex-1">
                      {agentWallet.address}
                    </code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(agentWallet.address)
                        setWalletCopied(true)
                        setTimeout(() => setWalletCopied(false), 2000)
                      }}
                      className="text-xs text-[#D4AF37] hover:text-[#FFD700] shrink-0"
                    >
                      {walletCopied ? 'Copied!' : 'Copy'}
                    </button>
                    <a
                      href={`https://suiscan.xyz/mainnet/account/${agentWallet.address}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-xs text-gray-500 hover:text-gray-300 shrink-0"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>

                {/* Balances */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/5 rounded-xl p-4">
                    <p className="text-xs text-gray-400 mb-1">SUI Balance</p>
                    <p className="text-xl font-bold text-white">{agentWallet.suiBalance.toFixed(4)}</p>
                    <p className="text-xs text-gray-600 mt-0.5">SUI</p>
                  </div>
                  <div className="bg-white/5 rounded-xl p-4">
                    <p className="text-xs text-gray-400 mb-1">NAVI Lending</p>
                    {agentWallet.naviPosition ? (
                      <>
                        <p className="text-xl font-bold text-emerald-400">
                          {agentWallet.naviPosition.deposited.toFixed(4)}
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">
                          SUI {agentWallet.naviPosition.apy > 0 ? `· ${agentWallet.naviPosition.apy}% APY` : ''}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-xl font-bold text-gray-500">—</p>
                        <p className="text-xs text-gray-600 mt-0.5">No position</p>
                      </>
                    )}
                  </div>
                </div>

                {/* Fund instruction */}
                {agentWallet.suiBalance < 0.05 && (
                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 text-xs text-yellow-400">
                    Send at least 0.1 SUI to the wallet address above to fund the agent for on-chain actions.
                  </div>
                )}

                {/* Refresh + Export */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={async () => {
                      setWalletLoading(true)
                      setWalletError(null)
                      try {
                        const res = await fetch(`/api/agents/${agent.id}/wallet`)
                        const data = await res.json()
                        if (res.ok) setAgentWallet(data)
                        else setWalletError(data.error || 'Failed to refresh wallet')
                      } catch { setWalletError('Network error — check console') }
                      setWalletLoading(false)
                    }}
                    disabled={walletLoading}
                    className="py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white text-sm transition-colors disabled:opacity-50"
                  >
                    {walletLoading ? 'Refreshing...' : 'Refresh Balance'}
                  </button>
                  <button
                    onClick={() => { setShowExportModal(true); setExportedKey(null); setExportError(null) }}
                    className="py-2 rounded-lg bg-white/5 hover:bg-red-500/10 text-gray-500 hover:text-red-400 text-sm transition-colors border border-transparent hover:border-red-500/20"
                  >
                    Export Key
                  </button>
                </div>

                {/* Export key modal */}
                {showExportModal && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-[#0d0f1a] border border-white/10 rounded-2xl p-6 max-w-md w-full space-y-4">
                      <h3 className="font-bold text-white text-lg">Export Private Key</h3>

                      {!exportedKey ? (
                        <>
                          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-400 space-y-1">
                            <p className="font-semibold">⚠ Security warning</p>
                            <p>Your private key gives full control of this agent's wallet. Never share it. Store it somewhere safe offline.</p>
                          </div>
                          <p className="text-sm text-gray-400">
                            Sign a message with your connected wallet to prove you are the creator. The key will be shown once.
                          </p>
                          {exportError && <p className="text-xs text-red-400">{exportError}</p>}
                          <div className="flex gap-2">
                            <button
                              onClick={async () => {
                                setExportLoading(true)
                                setExportError(null)
                                try {
                                  // Step 1: Get challenge nonce
                                  const challengeRes = await fetch(`/api/agents/${agent.id}/wallet/export`)
                                  const challenge = await challengeRes.json()
                                  if (!challengeRes.ok) throw new Error(challenge.error || 'Failed to get challenge')

                                  // Step 2: Sign the challenge message with connected wallet
                                  const messageBytes = new TextEncoder().encode(challenge.message)
                                  const { signature } = await signPersonalMessage({ message: messageBytes })

                                  // Step 3: Submit signature to get private key
                                  const exportRes = await fetch(`/api/agents/${agent.id}/wallet/export`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ signature, nonce: challenge.nonce }),
                                  })
                                  const exportData = await exportRes.json()
                                  if (!exportRes.ok) throw new Error(exportData.error || 'Export failed')
                                  setExportedKey(exportData.privateKey)
                                } catch (e: any) {
                                  setExportError(e.message || 'Export failed')
                                }
                                setExportLoading(false)
                              }}
                              disabled={exportLoading}
                              className="flex-1 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm font-medium transition-colors disabled:opacity-50"
                            >
                              {exportLoading ? 'Signing...' : 'Sign & Export'}
                            </button>
                            <button
                              onClick={() => setShowExportModal(false)}
                              className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-sm transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-400">
                            ⚠ This is your only chance to copy this key. It will not be shown again.
                          </div>
                          <div className="bg-black/40 rounded-xl p-3">
                            <p className="text-xs text-gray-500 mb-1">Private Key (bech32)</p>
                            <code className="text-xs text-emerald-400 break-all leading-relaxed">{exportedKey}</code>
                          </div>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(exportedKey)
                              setExportKeyCopied(true)
                              setTimeout(() => setExportKeyCopied(false), 2000)
                            }}
                            className="w-full py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-sm font-medium transition-colors"
                          >
                            {exportKeyCopied ? '✓ Copied!' : 'Copy to Clipboard'}
                          </button>
                          <button
                            onClick={() => { setShowExportModal(false); setExportedKey(null) }}
                            className="w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-sm transition-colors"
                          >
                            Done — I've saved my key
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-sm text-gray-400 mb-4">
                  Each agent gets a dedicated Sui wallet for on-chain actions.
                </p>
                {walletError && (
                  <p className="text-xs text-red-400 mb-3 px-2">{walletError}</p>
                )}
                <button
                  onClick={async () => {
                    setWalletLoading(true)
                    setWalletError(null)
                    try {
                      const res = await fetch(`/api/agents/${agent.id}/wallet`)
                      const data = await res.json()
                      if (res.ok) setAgentWallet(data)
                      else setWalletError(data.error || 'Failed to generate wallet')
                    } catch { setWalletError('Network error — check console') }
                    setWalletLoading(false)
                  }}
                  disabled={walletLoading}
                  className="px-6 py-2 rounded-lg bg-[#D4AF37] text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {walletLoading ? 'Generating...' : 'Generate Wallet'}
                </button>
              </div>
            )}
          </div>

          {/* Revenue Split */}
          <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
            <h3 className="font-bold text-white mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-[#D4AF37]" />
              Revenue Split
            </h3>
            <div className="space-y-3">
              {[
                { label: 'Creator (you)', pct: agent.revenueCreator || 40, color: 'from-[#D4AF37] to-[#FFD700]' },
                { label: 'AIDA Stakers', pct: agent.revenueAida || 30, color: 'from-emerald-500 to-emerald-400' },
                { label: 'Platform', pct: agent.revenuePlatform || 30, color: 'from-blue-500 to-blue-400' },
              ].map(item => (
                <div key={item.label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-400">{item.label}</span>
                    <span className="text-white font-medium">{item.pct}%</span>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div className={`h-full bg-gradient-to-r ${item.color} rounded-full`} style={{ width: `${item.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        )}

      </div>
    </div>
  )
}

