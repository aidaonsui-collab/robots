'use client'

import { useEffect, useRef, useMemo, useState, useCallback } from 'react'

export interface PricePoint {
  time: number; value: number; isBuy?: boolean; suiAmount?: number
}
export interface Candle {
  time: number; open: number; high: number; low: number
  close: number; volume: number; buyVolume: number
}

type Timeframe = '1M' | '5M' | '15M' | '1H' | '4H' | '1D'

const TF_RES: Record<Timeframe, string> = { '1M':'1','5M':'5','15M':'15','1H':'60','4H':'240','1D':'1D' }
const TF_SEC: Record<Timeframe, number>  = { '1M':60,'5M':300,'15M':900,'1H':3600,'4H':14400,'1D':86400 }

interface Props { poolId?: string; chartApiUrl?: string; priceHistory?: PricePoint[]; symbol?: string; onRefresh?: () => void }

function fp(v: number): string {
  if (v === 0) return '0'
  if (v < 0.0000001)  return v.toFixed(12)
  if (v < 0.000001)   return v.toFixed(10)
  if (v < 0.0001)     return v.toFixed(8)
  if (v < 0.01)       return v.toFixed(6)
  if (v < 1)          return v.toFixed(4)
  return v.toFixed(2)
}
function fmtTime(sec: number, tf: Timeframe) {
  const d = new Date(sec*1000), p = (n:number)=>String(n).padStart(2,'0')
  const date = `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`
  return tf==='1D' ? date : `${date} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function fmtAxisTime(sec: number, tf: Timeframe) {
  const d = new Date(sec*1000), p = (n:number)=>String(n).padStart(2,'0')
  if (tf==='1D') return `${d.getFullYear()}-${p(d.getMonth()+1)}`
  if (tf==='4H'||tf==='1H') return `${p(d.getMonth()+1)}-${p(d.getDate())}`
  return `${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function buildCandles(pts: PricePoint[], sec: number): Candle[] {
  if (!pts.length) return []
  const sorted = [...pts].map(p=>({time:Math.floor(p.time>1e12?p.time/1000:p.time),value:p.value,sui:p.suiAmount??0,buy:p.isBuy??true})).sort((a,b)=>a.time-b.time)
  const map = new Map<number,Candle>()
  for (const pt of sorted) {
    const b = Math.floor(pt.time/sec)*sec, ex = map.get(b)
    if (!ex) map.set(b,{time:b,open:pt.value,high:pt.value,low:pt.value,close:pt.value,volume:pt.sui,buyVolume:pt.buy?pt.sui:0})
    else { ex.high=Math.max(ex.high,pt.value); ex.low=Math.min(ex.low,pt.value); ex.close=pt.value; ex.volume+=pt.sui; if(pt.buy)ex.buyVolume+=pt.sui }
  }
  const res = Array.from(map.values()).sort((a,b)=>a.time-b.time)
  if (res.length===1) res.push({...res[0],time:res[0].time+sec,open:res[0].close,volume:0,buyVolume:0})
  return res
}

const BG='#0d1117', UP='#00e5a0', DN='#f03a6e', GRID='rgba(255,255,255,0.07)', AX='#4b5568', PL='#ef4444'
const PAD_L=8, PAD_R=108, PAD_T=12, PAD_B=28

export default function PriceChart({ poolId, chartApiUrl, priceHistory=[], symbol='', onRefresh }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const wrapRef    = useRef<HTMLDivElement>(null)

  const [tf, setTf]             = useState<Timeframe>('5M')
  const [apiCandles, setApi]    = useState<Candle[]|null>(null)
  const [loading, setLoading]   = useState(false)
  const [hovered, setHovered]   = useState<Candle|null>(null)
  const [mouseX, setMouseX]     = useState<number|null>(null)
  const [mouseY, setMouseY]     = useState<number|null>(null)

  // view: [startIdx, endIdx] — which candles are visible
  const allCandles = useMemo(()=>apiCandles!==null?apiCandles:buildCandles(priceHistory,TF_SEC[tf]),[apiCandles,priceHistory,tf])
  const [view, setView]         = useState<[number,number]>([0,0])

  // reset view when candles change
  useEffect(()=>{ if(allCandles.length) setView([0,allCandles.length]) },[allCandles])

  const candles = useMemo(()=>allCandles.slice(view[0],view[1]),[allCandles,view])

  const fetch_ = useCallback(async()=>{
    if(!poolId && !chartApiUrl) return
    setLoading(true)
    try {
      const url = chartApiUrl
        ? `${chartApiUrl}&resolution=${TF_RES[tf]}`
        : `/api/ohlcv?poolId=${poolId}&resolution=${TF_RES[tf]}`
      const r = await fetch(url)
      if(r.ok){ const data=await r.json(); setApi(data.candles??[]) }
    } catch {}
    finally { setLoading(false) }
  },[poolId,chartApiUrl,tf])

  useEffect(()=>{ fetch_() },[fetch_])
  useEffect(()=>{ if(!poolId && !chartApiUrl) return; const iv=setInterval(fetch_,30000); return()=>clearInterval(iv) },[fetch_,poolId,chartApiUrl])

  // ── Draw ──────────────────────────────────────────────────────────────────
  const draw = useCallback(()=>{
    const canvas=canvasRef.current, wrap=wrapRef.current
    if(!canvas||!wrap) return
    const dpr=window.devicePixelRatio||1
    const W=wrap.clientWidth, H=400
    canvas.width=W*dpr; canvas.height=H*dpr
    canvas.style.width=`${W}px`; canvas.style.height=`${H}px`
    const ctx=canvas.getContext('2d')!
    ctx.scale(dpr,dpr)

    ctx.fillStyle=BG; ctx.fillRect(0,0,W,H)

    if (!candles.length) {
      ctx.fillStyle='#374151'; ctx.font='13px monospace'; ctx.textAlign='center'
      ctx.fillText('No trades yet',W/2,H/2); return
    }

    const cW=W-PAD_L-PAD_R, cH=H-PAD_T-PAD_B
    const minP=Math.min(...candles.map(c=>c.low)), maxP=Math.max(...candles.map(c=>c.high))
    const range=maxP-minP||maxP*0.02
    const pMin=minP-range*0.08, pMax=maxP+range*0.08, pRange=pMax-pMin

    const toY=(p:number)=>PAD_T+cH-((p-pMin)/pRange)*cH
    const slotW=cW/candles.length
    const toX=(i:number)=>PAD_L+i*slotW+slotW/2

    // Grid horizontal
    ctx.setLineDash([4,4]); ctx.strokeStyle=GRID; ctx.lineWidth=1
    const HLINES=6
    for(let i=0;i<=HLINES;i++){
      const y=PAD_T+(i/HLINES)*cH
      ctx.beginPath(); ctx.moveTo(PAD_L,y); ctx.lineTo(W-PAD_R,y); ctx.stroke()
      ctx.setLineDash([]); ctx.fillStyle=AX; ctx.font='9px monospace'; ctx.textAlign='left'
      ctx.fillText(fp(pMax-(i/HLINES)*pRange),W-PAD_R+6,y+3)
      ctx.setLineDash([4,4])
    }

    // Grid vertical + time labels
    const VLINES=Math.min(7,candles.length)
    for(let i=0;i<=VLINES;i++){
      const idx=Math.floor((i/VLINES)*(candles.length-1))
      const x=toX(idx)
      ctx.beginPath(); ctx.moveTo(x,PAD_T); ctx.lineTo(x,PAD_T+cH); ctx.stroke()
      ctx.setLineDash([]); ctx.fillStyle=AX; ctx.font='9px monospace'; ctx.textAlign='center'
      ctx.fillText(fmtAxisTime(candles[idx].time,tf),x,H-8)
      ctx.setLineDash([4,4])
    }
    ctx.setLineDash([])

    // Candles
    const bodyW=Math.max(2,slotW*0.6)
    candles.forEach((c,i)=>{
      const cx=toX(i), color=c.close>=c.open?UP:DN
      ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=1
      ctx.beginPath(); ctx.moveTo(cx,toY(c.high)); ctx.lineTo(cx,toY(c.low)); ctx.stroke()
      const bTop=toY(Math.max(c.open,c.close)), bH=Math.max(1,Math.abs(toY(c.open)-toY(c.close)))
      ctx.fillRect(cx-bodyW/2,bTop,bodyW,bH)
    })

    // Current price dashed line + red pill
    const lastP=candles[candles.length-1].close, lastY=toY(lastP)
    ctx.setLineDash([5,4]); ctx.strokeStyle=PL; ctx.lineWidth=1
    ctx.beginPath(); ctx.moveTo(PAD_L,lastY); ctx.lineTo(W-PAD_R,lastY); ctx.stroke()
    ctx.setLineDash([])
    const pt=fp(lastP); ctx.font='9px monospace'
    const pw=ctx.measureText(pt).width+10
    ctx.fillStyle=PL; ctx.beginPath()
    if(ctx.roundRect) ctx.roundRect(W-PAD_R+2,lastY-8,pw,16,3)
    else ctx.rect(W-PAD_R+2,lastY-8,pw,16)
    ctx.fill(); ctx.fillStyle='#fff'; ctx.textAlign='left'; ctx.fillText(pt,W-PAD_R+7,lastY+4)

    // Crosshair
    if(mouseX!==null && mouseY!==null){
      ctx.setLineDash([3,3]); ctx.strokeStyle='rgba(255,255,255,0.2)'; ctx.lineWidth=1
      ctx.beginPath(); ctx.moveTo(mouseX,PAD_T); ctx.lineTo(mouseX,PAD_T+cH); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(PAD_L,mouseY); ctx.lineTo(W-PAD_R,mouseY); ctx.stroke()
      ctx.setLineDash([])
      const cp=pMin+(1-(mouseY-PAD_T)/cH)*pRange
      if(cp>=pMin&&cp<=pMax){
        const ct=fp(cp); const cw=ctx.measureText(ct).width+10
        ctx.fillStyle='#1f2937'
        if(ctx.roundRect) ctx.roundRect(W-PAD_R+2,mouseY-8,cw,16,3)
        else ctx.rect(W-PAD_R+2,mouseY-8,cw,16)
        ctx.fill(); ctx.fillStyle='#d1d5db'; ctx.textAlign='left'; ctx.fillText(ct,W-PAD_R+7,mouseY+4)
      }
    }
  },[candles,tf,mouseX,mouseY])

  useEffect(()=>{ draw() },[draw])

  // Resize
  useEffect(()=>{
    if(!wrapRef.current) return
    const ro=new ResizeObserver(()=>draw()); ro.observe(wrapRef.current); return()=>ro.disconnect()
  },[draw])

  // ── Mouse / wheel handlers ──────────────────────────────────────────────
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>)=>{
    const rect=e.currentTarget.getBoundingClientRect()
    const x=e.clientX-rect.left, y=e.clientY-rect.top
    setMouseX(x); setMouseY(y)
    if(!candles.length) return
    const cW=rect.width-PAD_L-PAD_R
    const slotW=cW/candles.length
    const idx=Math.max(0,Math.min(candles.length-1,Math.floor((x-PAD_L)/slotW)))
    setHovered(candles[idx])
  },[candles])

  const handleMouseLeave=()=>{ setMouseX(null); setMouseY(null); setHovered(null) }

  // Wheel zoom — keeps the hovered candle centred
  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>)=>{
    e.preventDefault()
    if(!allCandles.length) return
    const total=allCandles.length
    const [s,en]=view
    const visible=en-s
    const factor=e.deltaY<0?0.8:1.25          // zoom in / out
    const newVisible=Math.max(3,Math.min(total,Math.round(visible*factor)))
    // keep center stable
    const center=Math.round((s+en)/2)
    const half=Math.floor(newVisible/2)
    const newS=Math.max(0,center-half)
    const newE=Math.min(total,newS+newVisible)
    setView([newS,newE])
  },[allCandles,view])

  // Drag to pan
  const dragRef=useRef<{x:number,s:number,e:number}|null>(null)
  const handleMouseDown=(e: React.MouseEvent<HTMLCanvasElement>)=>{
    dragRef.current={x:e.clientX,s:view[0],e:view[1]}
  }
  const handleMouseMoveDrag=useCallback((e: React.MouseEvent<HTMLCanvasElement>)=>{
    handleMouseMove(e)
    if(!dragRef.current||!canvasRef.current) return
    const rect=canvasRef.current.getBoundingClientRect()
    const cW=rect.width-PAD_L-PAD_R
    const visible=dragRef.current.e-dragRef.current.s
    const dx=e.clientX-dragRef.current.x
    const dIdx=Math.round(-dx/(cW/visible))
    const newS=Math.max(0,Math.min(allCandles.length-visible,dragRef.current.s+dIdx))
    setView([newS,newS+visible])
  },[handleMouseMove,allCandles,view])
  const handleMouseUp=()=>{ dragRef.current=null }

  const displayCandle = hovered ?? (candles.length?candles[candles.length-1]:null)
  const isUp = displayCandle ? displayCandle.close>=displayCandle.open : true

  const zoomIn =()=>{
    const [s,en]=view, v=en-s, half=Math.floor(v*0.4/2)
    const ns=Math.min(s+half,en-3), ne=Math.max(en-half,ns+3)
    setView([ns,ne])
  }
  const zoomOut=()=>{
    const [s,en]=view, v=en-s, add=Math.ceil(v*0.5)
    setView([Math.max(0,s-Math.floor(add/2)),Math.min(allCandles.length,en+Math.ceil(add/2))])
  }
  const resetZoom=()=>{ if(allCandles.length) setView([0,allCandles.length]) }

  return (
    <div className="w-full rounded-xl overflow-hidden" style={{background:BG,border:'1px solid rgba(255,255,255,0.08)'}}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 py-2" style={{borderBottom:'1px solid rgba(255,255,255,0.07)'}}>
        <span className="text-[10px] font-mono" style={{color:AX}}>{symbol}/SUI</span>
        <div className="flex items-center gap-0.5 flex-wrap">
          {/* Timeframes */}
          {(['1M','5M','15M','1H','4H','1D'] as Timeframe[]).map(t=>(
            <button key={t} onClick={()=>setTf(t)}
              className="px-2 py-0.5 rounded text-[10px] font-mono transition-all"
              style={{color:tf===t?UP:AX, background:tf===t?'rgba(0,229,160,0.1)':'transparent'}}>
              {t}
            </button>
          ))}
          {/* Zoom controls */}
          <div className="flex items-center ml-2 rounded overflow-hidden" style={{border:'1px solid rgba(255,255,255,0.1)'}}>
            <button onClick={zoomIn}  className="px-2 py-0.5 text-[11px] transition-all hover:bg-white/5" style={{color:AX}} title="Zoom in">+</button>
            <button onClick={resetZoom} className="px-1.5 py-0.5 text-[9px] transition-all hover:bg-white/5" style={{color:AX}} title="Reset zoom">⊡</button>
            <button onClick={zoomOut} className="px-2 py-0.5 text-[11px] transition-all hover:bg-white/5" style={{color:AX}} title="Zoom out">−</button>
          </div>
          {/* Refresh */}
          <button onClick={()=>{ fetch_(); onRefresh?.() }} className="ml-1 p-1 rounded" style={{color:AX}} title="Refresh">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={loading?'animate-spin':''}>
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </button>
        </div>
      </div>

      {/* OHLCV overlay */}
      {displayCandle && (
        <div className="px-3 pt-1.5 pb-1" style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
          <p className="text-[11px] font-mono leading-5 flex flex-wrap gap-x-4" style={{color:'#6b7280'}}>
            <span><span style={{color:'#d1d5db'}}>Time: </span>{fmtTime(displayCandle.time,tf)}</span>
            <span><span style={{color:'#d1d5db'}}>Open: </span>{fp(displayCandle.open)}</span>
            <span><span style={{color:'#d1d5db'}}>High: </span><span style={{color:UP}}>{fp(displayCandle.high)}</span></span>
            <span><span style={{color:'#d1d5db'}}>Low: </span><span style={{color:DN}}>{fp(displayCandle.low)}</span></span>
            <span><span style={{color:'#d1d5db'}}>Close: </span><span style={{color:isUp?UP:DN}}>{fp(displayCandle.close)}</span></span>
            {displayCandle.volume>0 && <span><span style={{color:'#d1d5db'}}>Vol: </span>{displayCandle.volume.toFixed(4)} SUI</span>}
          </p>
        </div>
      )}

      {/* Canvas */}
      <div ref={wrapRef} className="w-full select-none">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMoveDrag}
          onMouseLeave={handleMouseLeave}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          style={{display:'block',cursor:'crosshair'}}
        />
      </div>

      {/* Hint */}
      <div className="px-3 py-1.5 flex items-center gap-3 text-[9px] font-mono" style={{color:'#374151',borderTop:'1px solid rgba(255,255,255,0.04)'}}>
        <span>scroll to zoom</span>
        <span>drag to pan</span>
        {allCandles.length>0 && view[1]-view[0]<allCandles.length && (
          <span style={{color:AX}}>showing {view[1]-view[0]} of {allCandles.length} candles</span>
        )}
      </div>
    </div>
  )
}
