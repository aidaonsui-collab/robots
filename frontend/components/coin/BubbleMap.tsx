'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Users, RefreshCw, List, ZoomIn, ZoomOut, Network } from 'lucide-react'

interface Holder {
  address: string
  balance: number
  percentage: number
  name?: string
  image?: string
}

interface BubbleNode {
  id: string
  address: string
  balance: number
  percentage: number
  r: number
  x: number
  y: number
  vx: number
  vy: number
  color: string
  tier: 'whale' | 'dolphin' | 'fish' | 'shrimp'
  label: string
  name?: string
  image?: string
  clusterId?: number
}

const CLUSTER_PALETTE = ['#FF6B9D', '#C84B31', '#4ECDC4', '#45B7D1', '#DDA0DD', '#F7DC6F', '#BB8FCE', '#82E0AA', '#F39C12', '#1ABC9C']
const getClusterColor = (id: number) => CLUSTER_PALETTE[id % CLUSTER_PALETTE.length]

// Tier thresholds (% of supply)
const TIER = (pct: number): BubbleNode['tier'] => {
  if (pct >= 5) return 'whale'
  if (pct >= 1) return 'dolphin'
  if (pct >= 0.1) return 'fish'
  return 'shrimp'
}

// Tier-based color palettes — semantic meaning + variety within each tier
const TIER_COLORS: Record<BubbleNode['tier'], string[]> = {
  whale:   ['#FFD700', '#F59E0B', '#FB923C', '#EF4444', '#FBBF24'],
  dolphin: ['#06b6d4', '#3B82F6', '#0EA5E9', '#38BDF8', '#7DD3FC'],
  fish:    ['#10B981', '#34D399', '#22C55E', '#A3E635', '#4ADE80'],
  shrimp:  ['#8B5CF6', '#A855F7', '#EC4899', '#F43F5E', '#C084FC'],
}

const addrColor = (addr: string, tier: BubbleNode['tier']): string => {
  let h = 0
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) & 0xfffffff
  const palette = TIER_COLORS[tier]
  return palette[h % palette.length]
}

const shortenAddr = (addr: string) =>
  addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr

function buildNodes(holders: Holder[], w: number, h: number): BubbleNode[] {
  if (!holders.length) return []
  const maxPct = Math.max(...holders.map(x => x.percentage), 0.01)
  const MIN_R = 14, MAX_R = Math.min(w, h) * 0.16

  return holders.map((holder, i) => {
    const tier = TIER(holder.percentage)
    const norm = Math.sqrt(holder.percentage / maxPct)
    const r = MIN_R + norm * (MAX_R - MIN_R)
    // Spread nodes on a wider circle so physics needs less work
    const angle = (i / holders.length) * Math.PI * 2
    const spread = Math.min(w, h) * 0.38
    return {
      id: holder.address,
      address: holder.address,
      balance: holder.balance,
      percentage: holder.percentage,
      r,
      x: w / 2 + Math.cos(angle) * spread + (Math.random() - 0.5) * 30,
      y: h / 2 + Math.sin(angle) * spread + (Math.random() - 0.5) * 30,
      vx: 0,
      vy: 0,
      color: addrColor(holder.address, tier),
      tier,
      label: holder.name || (holder.percentage >= 0.5 ? shortenAddr(holder.address) : ''),
      name: holder.name,
      image: holder.image,
    }
  })
}

// Simple physics tick — repulsion + center attraction + damping
function tick(nodes: BubbleNode[], w: number, h: number): BubbleNode[] {
  const cx = w / 2, cy = h / 2
  const damping = 0.78
  const centerStrength = 0.012
  const repulsion = 2.2

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    // Center gravity
    a.vx += (cx - a.x) * centerStrength
    a.vy += (cy - a.y) * centerStrength

    // Node repulsion
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.001
      const minDist = a.r + b.r + 3
      if (dist < minDist) {
        const force = ((minDist - dist) / dist) * repulsion
        const fx = dx * force
        const fy = dy * force
        a.vx -= fx * 0.5
        a.vy -= fy * 0.5
        b.vx += fx * 0.5
        b.vy += fy * 0.5
      }
    }
  }

  return nodes.map(n => ({
    ...n,
    vx: n.vx * damping,
    vy: n.vy * damping,
    x: Math.max(n.r, Math.min(w - n.r, n.x + n.vx)),
    y: Math.max(n.r, Math.min(h - n.r, n.y + n.vy)),
  }))
}

export default function BubbleMap({
  coinType,
  symbol,
  poolId,
}: {
  coinType: string
  symbol: string
  poolId?: string
}) {
  const [holders, setHolders] = useState<Holder[]>([])
  const [total, setTotal] = useState(0)
  const [top10pct, setTop10pct] = useState(0)
  const [decimals, setDecimals] = useState(6)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [nodes, setNodes] = useState<BubbleNode[]>([])
  const [selected, setSelected] = useState<BubbleNode | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [showList, setShowList] = useState(false)
  const [clusters, setClusters] = useState<Record<string, number>>({})
  const [clusterCount, setClusterCount] = useState(0)
  const [clusterLoading, setClusterLoading] = useState(false)

  // Pan & zoom state
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const panRef = useRef<{ dragging: boolean; startX: number; startY: number; panX: number; panY: number }>({
    dragging: false, startX: 0, startY: 0, panX: 0, panY: 0,
  })

  const W = 780, H = 440
  const animRef = useRef<number | null>(null)
  const nodesRef = useRef<BubbleNode[]>([])
  const tickCount = useRef(0)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      // Use /api/holders (has Suiscan fallback) instead of the token-specific route
      const params = new URLSearchParams({ coinType })
      if (poolId) params.set('poolId', poolId)
      const res = await fetch(`/api/holders?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'failed')
      if (!data.holders?.length) throw new Error('No holder data available for this token')
      // /api/holders returns balance as a formatted string — parse to number for sizing
      const holders = (data.holders as any[]).map(h => ({
        ...h,
        balance: typeof h.balance === 'string' ? parseInt(h.balance.replace(/,/g, ''), 10) || 0 : Number(h.balance),
        percentage: Number(h.percentage ?? 0),
      }))
      setHolders(holders)
      setTotal(data.total)
      setTop10pct(holders.slice(0, 10).reduce((s: number, h: any) => s + h.percentage, 0))
      setDecimals(6)
      const initial = buildNodes(data.holders, W, H)
      nodesRef.current = initial
      setNodes(initial)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [coinType, symbol, poolId])

  useEffect(() => { load() }, [load])

  // Cluster detection — runs after holders load, non-blocking
  useEffect(() => {
    if (!holders.length || loading) return
    setClusters({})
    setClusterCount(0)
    setClusterLoading(true)
    const addresses = holders.map(h => h.address).join(',')
    fetch(`/api/tokens/${encodeURIComponent(symbol)}/clusters?addresses=${encodeURIComponent(addresses)}`)
      .then(r => r.json())
      .then(data => {
        setClusters(data.clusters ?? {})
        setClusterCount(data.clusterCount ?? 0)
      })
      .catch(() => {})
      .finally(() => setClusterLoading(false))
  }, [holders, loading, symbol])

  // Physics loop — runs until settled (~120 ticks)
  useEffect(() => {
    if (!nodes.length || loading) return
    tickCount.current = 0
    const step = () => {
      if (tickCount.current > 160) return
      nodesRef.current = tick(nodesRef.current, W, H)
      setNodes([...nodesRef.current])
      tickCount.current++
      animRef.current = requestAnimationFrame(step)
    }
    animRef.current = requestAnimationFrame(step)
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [loading, holders])

  // Cluster connection lines — recomputed as nodes move during physics
  const clusterLines = useMemo(() => {
    if (!Object.keys(clusters).length) return []
    const groups: Record<number, BubbleNode[]> = {}
    for (const n of nodes) {
      const cId = clusters[n.address.toLowerCase()]
      if (cId !== undefined) {
        if (!groups[cId]) groups[cId] = []
        groups[cId].push(n)
      }
    }
    const lines: [BubbleNode, BubbleNode][] = []
    for (const group of Object.values(groups)) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          lines.push([group[i], group[j]])
        }
      }
    }
    return lines
  }, [nodes, clusters])

  // Wheel zoom
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setZoom(z => Math.max(0.4, Math.min(3, z - e.deltaY * 0.001)))
  }
  // Pan drag
  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as SVGElement).tagName === 'circle') return
    panRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!panRef.current.dragging) return
    setPan({ x: panRef.current.panX + e.clientX - panRef.current.startX, y: panRef.current.panY + e.clientY - panRef.current.startY })
  }
  const onMouseUp = () => { panRef.current.dragging = false }

  const TIER_LEGEND = [
    { label: 'Whale ≥5%', color: '#FFD700' },
    { label: 'Dolphin ≥1%', color: '#06b6d4' },
    { label: 'Fish ≥0.1%', color: '#10B981' },
    { label: 'Shrimp <0.1%', color: '#8B5CF6' },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Holders', value: total ? total.toLocaleString() : '—' },
          { label: 'Top 10 Hold', value: top10pct ? `${top10pct.toFixed(1)}%` : '—' },
          { label: 'Showing', value: holders.length ? `Top ${holders.length}` : '—' },
          {
            label: 'Clusters',
            value: clusterLoading ? '…' : clusterCount > 0 ? `${clusterCount} found` : 'None',
            color: clusterCount > 0 ? '#FF6B9D' : undefined,
          },
        ].map(s => (
          <div key={s.label} className="card-lift bg-[#0d0f1a]/80 backdrop-blur-md border border-white/[0.06] rounded-xl p-3 text-center">
            <div className="text-xs text-gray-500 mb-1">{s.label}</div>
            <div className="text-lg font-bold text-white" style={{ fontVariantNumeric: 'tabular-nums', color: (s as any).color }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Canvas */}
      <div className="relative rounded-2xl overflow-hidden border border-white/[0.06] bg-[#080c14]" style={{ height: H }}>
        {/* Toolbar */}
        <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-[#0d0f1a]/90 backdrop-blur-md border border-white/[0.08] rounded-xl px-3 py-1.5">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#B8860B] flex items-center justify-center text-black text-[10px] font-black">
              {symbol.slice(0, 1)}
            </div>
            <span className="text-white text-xs font-semibold">{symbol}</span>
            {total > 0 && <span className="text-gray-500 text-[10px]">{total.toLocaleString()} holders</span>}
          </div>
        </div>
        <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
          <button onClick={() => setShowList(v => !v)} title="Address list"
            className="p-2 bg-[#0d0f1a]/90 backdrop-blur-md border border-white/[0.08] rounded-xl text-gray-400 hover:text-white transition-colors">
            <List className="w-4 h-4" />
          </button>
          <button onClick={() => setZoom(z => Math.min(3, z + 0.2))} title="Zoom in"
            className="p-2 bg-[#0d0f1a]/90 backdrop-blur-md border border-white/[0.08] rounded-xl text-gray-400 hover:text-white transition-colors">
            <ZoomIn className="w-4 h-4" />
          </button>
          <button onClick={() => setZoom(z => Math.max(0.4, z - 0.2))} title="Zoom out"
            className="p-2 bg-[#0d0f1a]/90 backdrop-blur-md border border-white/[0.08] rounded-xl text-gray-400 hover:text-white transition-colors">
            <ZoomOut className="w-4 h-4" />
          </button>
          <button onClick={load} title="Refresh"
            className="p-2 bg-[#0d0f1a]/90 backdrop-blur-md border border-white/[0.08] rounded-xl text-gray-400 hover:text-white transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
            <div className="w-10 h-10 border-2 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">Loading holders…</p>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
            <Users className="w-10 h-10 text-gray-600" />
            <p className="text-gray-500 text-sm">{error}</p>
            <button onClick={load} className="text-[#D4AF37] text-xs underline">Retry</button>
          </div>
        )}

        {/* SVG bubble map */}
        {!loading && !error && (
          <svg
            width="100%" height="100%"
            viewBox={`0 0 ${W} ${H}`}
            className="cursor-grab active:cursor-grabbing select-none"
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          >
            <defs>
              {nodes.map(n => (
                <radialGradient key={`g-${n.id}`} id={`g-${n.id}`} cx="35%" cy="30%" r="65%">
                  <stop offset="0%" stopColor={n.color} stopOpacity="0.9" />
                  <stop offset="60%" stopColor={n.color} stopOpacity="0.65" />
                  <stop offset="100%" stopColor={n.color} stopOpacity="0.25" />
                </radialGradient>
              ))}
              <filter id="bubble-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`} style={{ transformOrigin: `${W/2}px ${H/2}px` }}>
              {/* Cluster connection lines — drawn behind bubbles */}
              {clusterLines.map(([a, b], i) => {
                const color = getClusterColor(clusters[a.address.toLowerCase()] ?? 0)
                return (
                  <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={color} strokeWidth="1.5" strokeOpacity="0.4"
                    strokeDasharray="4 3" />
                )
              })}
              {nodes.map(n => {
                const isHov = hovered === n.id
                const isSel = selected?.id === n.id
                const dimmed = hovered && !isHov && !isSel
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x},${n.y})`}
                    style={{ opacity: dimmed ? 0.25 : 1, transition: 'opacity 0.2s' }}
                    onClick={() => setSelected(sel => sel?.id === n.id ? null : n)}
                    onMouseEnter={() => setHovered(n.id)}
                    onMouseLeave={() => setHovered(null)}
                    className="cursor-pointer"
                  >
                    {/* Cluster ring — dashed ring in cluster color */}
                    {clusters[n.address.toLowerCase()] !== undefined && (
                      <circle r={n.r + 5} fill="none"
                        stroke={getClusterColor(clusters[n.address.toLowerCase()])}
                        strokeWidth="1.5" strokeOpacity="0.65" strokeDasharray="4 3" />
                    )}
                    {/* Outer glow ring on hover/select */}
                    {(isHov || isSel) && (
                      <circle r={n.r + 4} fill="none" stroke={n.color} strokeWidth="1.5" strokeOpacity="0.5" />
                    )}
                    {/* Specular highlight */}
                    <circle r={n.r} fill={`url(#g-${n.id})`} filter="url(#bubble-glow)" />
                    {/* Glass gloss */}
                    <ellipse
                      cx={-n.r * 0.25} cy={-n.r * 0.3}
                      rx={n.r * 0.35} ry={n.r * 0.22}
                      fill="white" fillOpacity="0.18"
                    />
                    {/* Label for large bubbles */}
                    {(n.r > 22 || isHov) && (
                      <text
                        textAnchor="middle" dominantBaseline="middle"
                        fontSize={Math.max(8, Math.min(11, n.r * 0.32))}
                        fill="white" fillOpacity="0.9"
                        style={{ pointerEvents: 'none', fontFamily: 'monospace' }}
                      >
                        {isHov ? `${n.percentage.toFixed(2)}%` : n.label || shortenAddr(n.address)}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          </svg>
        )}

        {/* Tier legend */}
        <div className="absolute bottom-3 left-3 z-20 flex flex-col gap-1.5">
          <div className="flex items-center gap-3 bg-[#0d0f1a]/80 backdrop-blur-md border border-white/[0.06] rounded-xl px-3 py-2">
            {TIER_LEGEND.map(t => (
              <div key={t.label} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: t.color }} />
                <span className="text-[10px] text-gray-500">{t.label}</span>
              </div>
            ))}
          </div>
          {clusterCount > 0 && (
            <div className="flex items-center gap-2 bg-[#0d0f1a]/80 backdrop-blur-md border border-white/[0.06] rounded-xl px-3 py-1.5">
              <Network className="w-3 h-3 text-gray-500" />
              <span className="text-[10px] text-gray-500">Cluster</span>
              {Array.from({ length: Math.min(clusterCount, 5) }, (_, i) => (
                <div key={i} className="flex items-center gap-1">
                  <div className="w-4 h-0.5" style={{ background: getClusterColor(i), borderTop: `1px dashed ${getClusterColor(i)}` }} />
                  <span className="text-[9px]" style={{ color: getClusterColor(i) }}>#{i + 1}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Controls hint */}
        <div className="absolute bottom-3 right-3 z-20 flex items-center gap-3 text-[10px] text-gray-600">
          <span>🖱 Click bubble</span>
          <span>🔍 Scroll zoom</span>
          <span>✋ Drag to pan</span>
        </div>

        {/* Address list panel */}
        {showList && (
          <div className="absolute top-0 right-0 bottom-0 w-64 bg-[#0a0d16]/95 backdrop-blur-xl border-l border-white/[0.06] z-20 overflow-y-auto">
            <div className="p-3 border-b border-white/[0.06] flex items-center justify-between">
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Top Holders</p>
              <button onClick={() => setShowList(false)} className="text-gray-500 hover:text-white text-lg leading-none">×</button>
            </div>
            {holders.map((h, i) => (
              <div
                key={h.address}
                className="flex items-center gap-2 px-3 py-2 hover:bg-white/[0.03] cursor-pointer border-b border-white/[0.03]"
                onClick={() => setSelected(nodes.find(n => n.id === h.address) || null)}
              >
                <span className="text-gray-600 text-[10px] w-5 shrink-0">#{i + 1}</span>
                <div className="w-3 h-3 rounded-full shrink-0" style={{ background: addrColor(h.address, TIER(h.percentage)) }} />
                <span className="text-gray-300 text-[10px] font-mono truncate flex-1">{h.name || shortenAddr(h.address)}</span>
                <span className="text-[#D4AF37] text-[10px] font-semibold shrink-0">{h.percentage.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Selected wallet panel */}
      {selected && (
        <div className="card-lift bg-[#0d0f1a]/80 backdrop-blur-md border rounded-xl p-4" style={{ borderColor: `${selected.color}33` }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ background: `radial-gradient(circle at 35% 30%, ${selected.color}cc, ${selected.color}44)` }} />
              <div>
                {selected.name && <p className="text-[#D4AF37] text-xs font-semibold mb-0.5">{selected.name}</p>}
                <p className="text-white font-mono text-sm break-all">{selected.address}</p>
                <p className="text-gray-500 text-xs mt-0.5 capitalize">
                  {selected.tier} holder
                  {clusters[selected.address.toLowerCase()] !== undefined && (
                    <span className="ml-2 font-semibold" style={{ color: getClusterColor(clusters[selected.address.toLowerCase()]) }}>
                      · Cluster {clusters[selected.address.toLowerCase()] + 1}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <button onClick={() => setSelected(null)} className="text-gray-600 hover:text-white text-lg leading-none">×</button>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <div className="bg-white/[0.03] rounded-lg p-2.5 text-center">
              <div className="text-[10px] text-gray-500 mb-1">% of Supply</div>
              <div className="text-sm font-bold" style={{ color: selected.color }}>{selected.percentage.toFixed(3)}%</div>
            </div>
            <div className="bg-white/[0.03] rounded-lg p-2.5 text-center">
              <div className="text-[10px] text-gray-500 mb-1">Balance</div>
              <div className="text-sm font-bold text-white" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {(selected.balance / Math.pow(10, decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="bg-white/[0.03] rounded-lg p-2.5 text-center">
              <div className="text-[10px] text-gray-500 mb-1">Explorer</div>
              <a
                href={`https://suivision.xyz/address/${selected.address}`}
                target="_blank" rel="noopener noreferrer"
                className="text-sm font-bold text-[#D4AF37] hover:underline"
              >
                View ↗
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
