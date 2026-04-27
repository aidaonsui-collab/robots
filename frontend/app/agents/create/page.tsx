'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useCurrentWallet, useCurrentAccount } from '@mysten/dapp-kit'
import { ArrowLeft, Upload, Sparkles, Brain, Zap, DollarSign, Settings, Code, AlertCircle } from 'lucide-react'
import { motion } from 'framer-motion'

type Step = 'basics' | 'personality' | 'economics' | 'review'
type PairType = 'SUI' | 'AIDA'

// Per-pair launch defaults. Match the floors enforced on
// /bondingcurve/coins/create (MIN_AIDA = 20_000_000 for AIDA pairs;
// SUI pairs use the curve's hardcoded 1000-AIDA floor as the minimum
// graduation threshold). Toggling pair flips the form to these
// defaults — preserving the user's input across pairs is misleading
// (50 SUI ≈ $50 vs 50 AIDA ≈ pennies).
const PAIR_DEFAULTS: Record<PairType, { initialBuy: number; targetRaise: number; targetRaiseMin: number }> = {
  SUI:  { initialBuy: 50,    targetRaise: 2_000,       targetRaiseMin: 1_000 },
  AIDA: { initialBuy: 5_000, targetRaise: 20_000_000,  targetRaiseMin: 20_000_000 },
}

interface AgentForm {
  // Basics
  name: string
  symbol: string
  description: string
  imageUrl: string
  twitter: string
  telegram: string
  website: string

  // Personality
  personality: string
  skills: string[]
  model: 'minimax' | 'claude' | 'gpt4'

  // Economics
  pairType: PairType   // SUI = SUI-paired bonding curve; AIDA = AIDA-paired
  initialBuy: number   // denominated in pairType
  targetRaise: number  // denominated in pairType
  revenueShare: {
    stakers: number // %
    creator: number // %
    platform: number // %
  }
}

const AVAILABLE_SKILLS = [
  { id: 'trading', label: 'Trading', icon: '📈' },
  { id: 'research', label: 'Research', icon: '🔬' },
  { id: 'content', label: 'Content Creation', icon: '✍️' },
  { id: 'analysis', label: 'Data Analysis', icon: '📊' },
  { id: 'social', label: 'Social Media', icon: '💬' },
  { id: 'coding', label: 'Coding', icon: '💻' },
]

const MODEL_OPTIONS = [
  { id: 'minimax', name: 'MiniMax M2.7', cost: '$2/mo', speed: 'Fast', quality: 'Good' },
  { id: 'claude', name: 'Claude Sonnet 4.5', cost: '$10/mo', speed: 'Medium', quality: 'Excellent' },
  { id: 'gpt4', name: 'GPT-4', cost: '$15/mo', speed: 'Slow', quality: 'Excellent' },
]

export default function CreateAgentPage() {
  const router = useRouter()
  const currentWallet = useCurrentWallet()
  const account = useCurrentAccount()
  const address = account?.address
  const [step, setStep] = useState<Step>('basics')
  const [form, setForm] = useState<AgentForm>({
    name: '',
    symbol: '',
    description: '',
    imageUrl: '',
    twitter: '',
    telegram: '',
    website: '',
    personality: '',
    skills: [],
    model: 'minimax',
    pairType: 'SUI',
    initialBuy: PAIR_DEFAULTS.SUI.initialBuy,
    targetRaise: PAIR_DEFAULTS.SUI.targetRaise,
    revenueShare: {
      stakers: 30,
      creator: 40,
      platform: 30,
    }
  })

  const steps = [
    { id: 'basics', label: 'Basics', icon: Sparkles },
    { id: 'personality', label: 'Personality', icon: Brain },
    { id: 'economics', label: 'Economics', icon: DollarSign },
    { id: 'review', label: 'Review', icon: Settings },
  ]

  const currentStepIndex = steps.findIndex(s => s.id === step)
  const avatarFileRef = useRef<HTMLInputElement>(null)
  // Local data: URL kept only for preview while the Cloudinary upload is in
  // flight. form.imageUrl always holds a real https/ipfs URL — never a data:
  // URL — so it's safe to put on chain at mint time.
  const [imagePreview, setImagePreview] = useState('')
  const [imageUploading, setImageUploading] = useState(false)

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return

    // Instant preview from a data: URL — UI only, never persisted.
    const reader = new FileReader()
    reader.onload = () => setImagePreview(reader.result as string)
    reader.readAsDataURL(file)

    // Upload to Cloudinary so the URL stored in form.imageUrl is a real
    // https URL. Same upload preset/folder as /bondingcurve/coins/create.
    setImageUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('upload_preset', 'launchpad')
      fd.append('folder', 'launchpad')
      const res = await fetch('https://api.cloudinary.com/v1_1/dtgdfntom/image/upload', {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) throw new Error(`Cloudinary upload failed: ${res.status}`)
      const data = await res.json()
      if (!data.secure_url) throw new Error('Cloudinary response missing secure_url')
      setForm(prev => ({ ...prev, imageUrl: data.secure_url }))
    } catch (err) {
      console.error('[agent-create] avatar upload failed:', err)
      alert('Avatar upload failed. Please try a different image or paste a URL directly.')
      setImagePreview('')
    } finally {
      setImageUploading(false)
    }
  }

  const setPair = (next: PairType) => {
    if (next === form.pairType) return
    const d = PAIR_DEFAULTS[next]
    setForm(prev => ({
      ...prev,
      pairType: next,
      initialBuy: d.initialBuy,
      targetRaise: d.targetRaise,
    }))
  }

  const handleNext = () => {
    const currentIndex = steps.findIndex(s => s.id === step)
    if (currentIndex < steps.length - 1) {
      setStep(steps[currentIndex + 1].id as Step)
    }
  }

  const handleBack = () => {
    const currentIndex = steps.findIndex(s => s.id === step)
    if (currentIndex > 0) {
      setStep(steps[currentIndex - 1].id as Step)
    }
  }

  const handleSubmit = async () => {
    if (!currentWallet || !address) {
      alert('Please connect your wallet first')
      return
    }
    if (imageUploading) {
      alert('Avatar is still uploading — please wait a moment.')
      return
    }

    try {
      console.log('Starting agent creation...', form)
      
      // Phase 1: Token deployment (reusing existing token creation flow)
      // User needs to navigate to /bondingcurve/coins/create with pre-filled data
      // We'll store the form data in localStorage and redirect
      
      const agentData = {
        // Basic info
        name: form.name,
        ticker: form.symbol,
        description: form.description,
        image: form.imageUrl,
        
        // Social links
        twitter: form.twitter,
        telegram: form.telegram,
        website: form.website,
        
        // Agent-specific
        personality: form.personality,
        skills: form.skills,
        llmModel: form.model,
        
        // Economics
        pairType: form.pairType,
        initialBuy: form.initialBuy,
        targetRaise: form.targetRaise,
        revenueAida: form.revenueShare.stakers,
        revenueCreator: form.revenueShare.creator,
        revenuePlatform: form.revenueShare.platform,
        
        // Metadata
        isAgent: true,
        creatorAddress: address,
      }
      
      // Store in localStorage for token creation page to pick up
      localStorage.setItem('pendingAgentCreation', JSON.stringify(agentData))
      
      // Redirect to token creation page (pre-fills from localStorage)
      window.location.href = '/bondingcurve/coins/create?agent=true'
      
    } catch (error: any) {
      console.error('Agent creation error:', error)
      alert(error.message || 'Failed to create agent')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Header */}
      <div className="border-b border-white/10 bg-slate-950/50 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <button
            onClick={() => router.push('/agents')}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Agents
          </button>

          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-xl bg-[#D4AF37] flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-black" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Create AI Agent</h1>
              <p className="text-sm text-gray-400">Launch your tokenized AI agent on Sui</p>
            </div>
          </div>

          {/* Progress Steps */}
          <div className="flex items-center justify-between">
            {steps.map((s, i) => {
              const Icon = s.icon
              const isActive = s.id === step
              const isCompleted = i < currentStepIndex
              
              return (
                <div key={s.id} className="flex items-center flex-1">
                  <div className="flex flex-col items-center gap-2">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                      isActive 
                        ? 'bg-[#D4AF37] text-black shadow-lg shadow-[#D4AF37]/30'
                        : isCompleted
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-gray-500'
                    }`}>
                      {isCompleted ? '✓' : <Icon className="w-5 h-5" />}
                    </div>
                    <span className={`text-xs font-medium ${isActive ? 'text-white' : 'text-gray-500'}`}>
                      {s.label}
                    </span>
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`flex-1 h-px mx-2 ${
                      isCompleted ? 'bg-emerald-600' : 'bg-slate-800'
                    }`} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
        >
          {/* Step: Basics */}
          {step === 'basics' && (
            <div className="space-y-6">
              <div className="bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
                <h2 className="text-xl font-bold text-white mb-4">Agent Identity</h2>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Agent Name *</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g. Trading Bot Alpha"
                      className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Token Symbol *</label>
                    <input
                      type="text"
                      value={form.symbol}
                      onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
                      placeholder="e.g. ALPHA"
                      maxLength={10}
                      className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Description *</label>
                    <textarea
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="Describe what your agent does..."
                      rows={4}
                      className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 resize-none"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Avatar Image URL</label>
                    <div className="flex gap-3">
                      <input
                        type="text"
                        value={form.imageUrl}
                        onChange={(e) => {
                          setForm({ ...form, imageUrl: e.target.value })
                          setImagePreview('')
                        }}
                        placeholder={imageUploading ? 'Uploading…' : 'https://… or ipfs://…'}
                        className="flex-1 px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50"
                        readOnly={imageUploading}
                      />
                      <input
                        ref={avatarFileRef}
                        type="file"
                        accept="image/*"
                        onChange={handleAvatarUpload}
                        className="hidden"
                      />
                      <button
                        onClick={() => avatarFileRef.current?.click()}
                        disabled={imageUploading}
                        className="px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-gray-400 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Upload className="w-5 h-5" />
                      </button>
                    </div>
                    {(imagePreview || form.imageUrl) && (
                      <div className="mt-3 flex items-center gap-3">
                        <img src={imagePreview || form.imageUrl} alt="Preview" className="w-24 h-24 rounded-xl object-cover border border-white/10" />
                        {imageUploading && <span className="text-xs text-gray-400">Uploading to CDN…</span>}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Twitter</label>
                      <input
                        type="text"
                        value={form.twitter}
                        onChange={(e) => setForm({ ...form, twitter: e.target.value })}
                        placeholder="@username"
                        className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Telegram</label>
                      <input
                        type="text"
                        value={form.telegram}
                        onChange={(e) => setForm({ ...form, telegram: e.target.value })}
                        placeholder="@channel"
                        className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Website</label>
                      <input
                        type="text"
                        value={form.website}
                        onChange={(e) => setForm({ ...form, website: e.target.value })}
                        placeholder="https://..."
                        className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step: Personality */}
          {step === 'personality' && (
            <div className="space-y-6">
              <div className="bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
                <h2 className="text-xl font-bold text-white mb-4">Agent Personality & Skills</h2>
                
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Personality Prompt *</label>
                    <textarea
                      value={form.personality}
                      onChange={(e) => setForm({ ...form, personality: e.target.value })}
                      placeholder="You are a helpful trading agent that specializes in DeFi protocols..."
                      rows={6}
                      className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 resize-none font-mono text-sm"
                    />
                    <p className="text-xs text-gray-500 mt-2">This will be the agent's SOUL.md - its core personality and behavior</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-3">Skills & Capabilities</label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {AVAILABLE_SKILLS.map((skill) => (
                        <button
                          key={skill.id}
                          onClick={() => {
                            setForm({
                              ...form,
                              skills: form.skills.includes(skill.id)
                                ? form.skills.filter(s => s !== skill.id)
                                : [...form.skills, skill.id]
                            })
                          }}
                          className={`p-4 rounded-xl border transition-all ${
                            form.skills.includes(skill.id)
                              ? 'bg-[#D4AF37]/10 border-[#D4AF37] text-[#D4AF37]'
                              : 'bg-slate-800 border-white/10 text-gray-400 hover:border-white/20'
                          }`}
                        >
                          <div className="text-2xl mb-2">{skill.icon}</div>
                          <div className="text-sm font-medium">{skill.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-3">LLM Model *</label>
                    <div className="space-y-3">
                      {MODEL_OPTIONS.map((model) => (
                        <button
                          key={model.id}
                          onClick={() => setForm({ ...form, model: model.id as any })}
                          className={`w-full p-4 rounded-xl border transition-all text-left ${
                            form.model === model.id
                              ? 'bg-[#D4AF37]/10 border-[#D4AF37]'
                              : 'bg-slate-800 border-white/10 hover:border-white/20'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-bold text-white mb-1">{model.name}</div>
                              <div className="text-sm text-gray-400">
                                {model.cost} • Speed: {model.speed} • Quality: {model.quality}
                              </div>
                            </div>
                            {form.model === model.id && (
                              <div className="w-6 h-6 rounded-full bg-[#D4AF37] flex items-center justify-center">
                                <span className="text-black text-sm">✓</span>
                              </div>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step: Economics */}
          {step === 'economics' && (
            <div className="space-y-6">
              <div className="bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
                <h2 className="text-xl font-bold text-white mb-4">Tokenomics & Revenue</h2>

                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Quote Token (Pair)</label>
                    <div className="grid grid-cols-2 gap-3">
                      {(['SUI', 'AIDA'] as PairType[]).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPair(p)}
                          className={`px-4 py-3 rounded-xl border transition-all text-sm font-medium ${
                            form.pairType === p
                              ? 'bg-[#D4AF37]/10 border-[#D4AF37] text-[#D4AF37]'
                              : 'bg-slate-800 border-white/10 text-gray-400 hover:border-white/20'
                          }`}
                        >
                          {p === 'SUI' ? 'SUI pair' : 'AIDA pair'}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      Determines which token the bonding curve and DEX pool are denominated in. Switching resets the amounts below to {form.pairType === 'SUI' ? 'SUI' : 'AIDA'} defaults.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Initial Buy Amount ({form.pairType}) *</label>
                    <input
                      type="number"
                      value={form.initialBuy}
                      onChange={(e) => setForm({ ...form, initialBuy: parseFloat(e.target.value) })}
                      min={1}
                      step={1}
                      className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50"
                    />
                    <p className="text-xs text-gray-500 mt-2">Your first purchase to initialize the bonding curve</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Target Raise ({PAIR_DEFAULTS[form.pairType].targetRaiseMin.toLocaleString()} {form.pairType} minimum) *
                    </label>
                    <input
                      type="number"
                      value={form.targetRaise}
                      onChange={(e) => setForm({ ...form, targetRaise: parseFloat(e.target.value) })}
                      min={PAIR_DEFAULTS[form.pairType].targetRaiseMin}
                      step={form.pairType === 'AIDA' ? 1_000_000 : 100}
                      className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50"
                    />
                    <p className="text-xs text-gray-500 mt-2">Bonding curve graduates to DEX at this amount</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-3">Revenue Distribution (Fixed)</label>
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-400">AIDA Stakers</span>
                          </div>
                          <span className="text-sm font-bold text-white">30%</span>
                        </div>
                        <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-[#D4AF37]" style={{ width: '30%' }} />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Distributed to all AIDA token stakers</p>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-400">Creator (You)</span>
                          </div>
                          <span className="text-sm font-bold text-[#D4AF37]">40%</span>
                        </div>
                        <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-[#D4AF37]" style={{ width: '40%' }} />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Your earnings from agent's trading fees</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step: Review */}
          {step === 'review' && (
            <div className="space-y-6">
              <div className="bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
                <h2 className="text-xl font-bold text-white mb-4">Review & Launch</h2>
                
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <h3 className="text-sm font-medium text-gray-400 mb-3">Agent Identity</h3>
                      <div className="space-y-2 text-sm">
                        <div><span className="text-gray-500">Name:</span> <span className="text-white font-medium">{form.name}</span></div>
                        <div><span className="text-gray-500">Symbol:</span> <span className="text-white font-medium">${form.symbol}</span></div>
                        <div><span className="text-gray-500">Skills:</span> <span className="text-white font-medium">{form.skills.length} selected</span></div>
                        <div><span className="text-gray-500">Model:</span> <span className="text-white font-medium">{MODEL_OPTIONS.find(m => m.id === form.model)?.name}</span></div>
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-gray-400 mb-3">Economics</h3>
                      <div className="space-y-2 text-sm">
                        <div><span className="text-gray-500">Initial Buy:</span> <span className="text-white font-medium">{form.initialBuy} SUI</span></div>
                        <div><span className="text-gray-500">Target:</span> <span className="text-white font-medium">{form.targetRaise} SUI</span></div>
                        <div><span className="text-gray-500">Your Share:</span> <span className="text-[#D4AF37] font-medium">{form.revenueShare.creator}%</span></div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-white/10 pt-6">
                    <h3 className="text-sm font-medium text-gray-400 mb-3">Estimated Costs</h3>
                    <div className="bg-slate-800 rounded-xl p-4 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Token Contract Deployment</span>
                        <span className="text-white">~0.5 SUI</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Initial Buy</span>
                        <span className="text-white">{form.initialBuy} SUI</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Platform Fee</span>
                        <span className="text-white">1 SUI</span>
                      </div>
                      <div className="border-t border-white/10 pt-2 flex justify-between font-bold">
                        <span className="text-white">Total</span>
                        <span className="text-[#D4AF37]">~{(form.initialBuy + 1.5).toFixed(1)} SUI</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex gap-3">
                  <AlertCircle className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-gray-300">
                    <p className="text-gray-400">Smart contracts will be deployed to Sui mainnet. Make sure you have enough SUI in your wallet.</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </motion.div>

        {/* Navigation Buttons */}
        <div className="flex items-center justify-between mt-8">
          <button
            onClick={handleBack}
            disabled={currentStepIndex === 0}
            className="px-6 py-3 rounded-xl font-medium text-gray-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Back
          </button>
          
          {step === 'review' ? (
            <button
              onClick={handleSubmit}
              disabled={!form.name || !form.symbol || !form.description}
              className="px-8 py-3 rounded-xl font-bold bg-[#D4AF37] text-black hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#D4AF37]/30"
            >
              Launch Agent
            </button>
          ) : (
            <button
              onClick={handleNext}
              disabled={
                (step === 'basics' && (!form.name || !form.symbol || !form.description)) ||
                (step === 'personality' && (!form.personality || form.skills.length === 0))
              }
              className="px-8 py-3 rounded-xl font-bold bg-[#D4AF37] text-black hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#D4AF37]/30"
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
