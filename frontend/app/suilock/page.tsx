'use client'

import { useState, useEffect } from 'react'
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit'
import { Lock, TrendingUp, Clock, AlertCircle, CheckCircle, ExternalLink, Loader2, Info, Coins, Globe } from 'lucide-react'
import { Transaction } from '@mysten/sui/transactions'
import { SUI_CLOCK_OBJECT_ID } from '@mysten/sui/utils'

const VESTING_PKG = process.env.NEXT_PUBLIC_VESTING_PKG || '0x93d1a123f8955c344d83d571048cf2d53ab790ba9c202391e4ef54e467574558'
const PLATFORM_FEE = 1_000_000_000
const SUI_COIN_TYPE = '0x2::sui::SUI'

function coinType(t: string) { const m = t.match(/<(.+)>$/); return m ? m[1] : SUI_COIN_TYPE }
function num(v: unknown) { return typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v) : 0 }
function fmtD(ms: number) { return ms && !isNaN(ms) ? new Date(ms).toLocaleString() : '—' }
function tl(ms: number) { if (!ms || isNaN(ms)) return '—'; const d = ms - Date.now(); if (d <= 0) return 'Unlocked'; const h = Math.floor(d / 3600000); return h > 24 ? Math.floor(h/24)+'d '+(h%24)+'h' : h+'h' }
function fmtAmt(raw: string, d = 9) { const v = parseInt(raw) / 10**d; return isNaN(v) ? '—' : v >= 1e6 ? (v/1e6).toFixed(2)+'M' : v >= 1e3 ? (v/1e3).toFixed(2)+'K' : v.toFixed(2) }

interface Lk { id: string; type: 'lock'|'vesting'; tokenType: string; balance: string; decimals: number; beneficiary: string; creator: string; unlockTime?: number; cliffTime?: number; endTime?: number }

function fmtAddr(a: string) { return a ? `${a.slice(0,6)}...${a.slice(-4)}` : '—' }
function fmtToken(t: string) {
  const parts = t.split('::')
  return parts.length >= 3 ? parts[parts.length - 1] : t.slice(0, 12) + '...'
}

export default function SuiLockPage() {
  const account = useCurrentAccount()
  const suiClient = useSuiClient()
  const { mutate: signAndExec, isPending: txPending } = useSignAndExecuteTransaction()
  const [tab, setTab] = useState<'lock'|'vesting'|'mylocks'|'public'>('lock')
  const [tok, setTok] = useState(''); const [amt, setAmt] = useState(''); const [ben, setBen] = useState('')
  const [tokDecimals, setTokDecimals] = useState(9) // 9 for SUI, fetched for others
  const [unlockD, setUnlockD] = useState(''); const [cliffD, setCliffD] = useState(''); const [endD, setEndD] = useState('')
  const [txDig, setTxDig] = useState(''); const [err, setErr] = useState(''); const [bal, setBal] = useState(0)
  const [locks, setLocks] = useState<Lk[]>([]); const [loadLks, setLoadLks] = useState(false)
  const [pubLocks, setPubLocks] = useState<Lk[]>([]); const [loadPub, setLoadPub] = useState(false)
  const [claiming, setClaiming] = useState<string|null>(null); const [txDs, setTxDs] = useState<Record<string,string>>({})

  useEffect(() => {
    if (!account?.address) return
    suiClient.getBalance({ owner: account.address, coinType: SUI_COIN_TYPE })
      .then(b => setBal(Number(b.totalBalance) / 1e9))
      .catch(() => {})
  }, [account, suiClient])

  // Shared helper: fetch lock/vest entries from events, optionally filter by beneficiary
  async function fetchLockEntries(filterAddr?: string): Promise<Lk[]> {
    const lockEvts = await suiClient.queryEvents({
      query: { MoveEventType: `${VESTING_PKG}::token_locker::TokensLocked` },
      limit: 50, order: 'descending',
    })
    const vestEvts = await suiClient.queryEvents({
      query: { MoveEventType: `${VESTING_PKG}::vesting_schedule::VestingScheduleCreated` },
      limit: 50, order: 'descending',
    })
    const res: Lk[] = []
    const decimalsCache = new Map<string, number>()
    const getDecimals = async (tokenType: string): Promise<number> => {
      if (tokenType === SUI_COIN_TYPE) return 9
      const cached = decimalsCache.get(tokenType)
      if (cached != null) return cached
      try {
        const meta = await suiClient.getCoinMetadata({ coinType: tokenType })
        const d = meta?.decimals ?? 6
        decimalsCache.set(tokenType, d)
        return d
      } catch { return 6 }
    }

    for (const evt of lockEvts.data) {
      try {
        const f = evt.parsedJson as Record<string, unknown>
        if (!f) continue
        if (filterAddr && (f.beneficiary as string).toLowerCase() !== filterAddr.toLowerCase()) continue
        const txBlock = await suiClient.getTransactionBlock({ digest: evt.id.txDigest, options: { showEffects: true } })
        const shared = (txBlock.effects?.created ?? []).find(o => o.owner && typeof o.owner === 'object' && 'Shared' in o.owner)
        if (!shared) continue
        const objId = shared.reference.objectId
        const obj = await suiClient.getObject({ id: objId, options: { showType: true, showContent: true } })
        const objType = obj.data?.type ?? ''
        const content = obj.data?.content
        const liveBalance = content && 'fields' in content ? String((content.fields as Record<string, unknown>).balance ?? f.amount ?? '0') : String(f.amount ?? '0')
        // Skip fully claimed locks (zero balance)
        if (parseInt(liveBalance) <= 0) continue
        const tokenType = coinType(objType)
        res.push({
          id: objId, type: 'lock', tokenType, balance: liveBalance, decimals: await getDecimals(tokenType),
          beneficiary: f.beneficiary as string, creator: (f.creator as string) ?? '',
          unlockTime: num(f.unlock_time),
        })
      } catch (e) { console.error('[SuiLock] Error processing lock event:', evt.id.txDigest, e) }
    }

    for (const evt of vestEvts.data) {
      try {
        const f = evt.parsedJson as Record<string, unknown>
        if (!f) continue
        if (filterAddr && (f.beneficiary as string).toLowerCase() !== filterAddr.toLowerCase()) continue
        const txBlock = await suiClient.getTransactionBlock({ digest: evt.id.txDigest, options: { showEffects: true } })
        const shared = (txBlock.effects?.created ?? []).find(o => o.owner && typeof o.owner === 'object' && 'Shared' in o.owner)
        if (!shared) continue
        const objId = shared.reference.objectId
        const obj = await suiClient.getObject({ id: objId, options: { showType: true, showContent: true } })
        const objType = obj.data?.type ?? ''
        const content = obj.data?.content
        const fields = content && 'fields' in content ? content.fields as Record<string, unknown> : {}
        const liveBalance = String(fields.balance ?? f.total_amount ?? '0')
        // Skip fully claimed vesting wallets (zero balance)
        if (parseInt(liveBalance) <= 0) continue
        const tokenType = coinType(objType)
        res.push({
          id: objId, type: 'vesting', tokenType, balance: liveBalance, decimals: await getDecimals(tokenType),
          beneficiary: f.beneficiary as string, creator: (f.creator as string) ?? '',
          cliffTime: num(f.cliff_time), endTime: num(f.end_time),
        })
      } catch (e) { console.error('[SuiLock] Error processing vest event:', evt.id.txDigest, e) }
    }
    return res
  }

  async function loadLocks() {
    if (!account) return; setLoadLks(true); setErr('')
    try { setLocks(await fetchLockEntries(account.address)) }
    catch (e) { console.error('[SuiLock] loadLocks error:', e); setErr('Failed to load your locks. Check console for details.') }
    finally { setLoadLks(false) }
  }

  async function loadPublicLocks() {
    setLoadPub(true); setErr('')
    try { setPubLocks(await fetchLockEntries()) }
    catch (e) { console.error('[SuiLock] loadPublicLocks error:', e); setErr('Failed to load public locks. Check console for details.') }
    finally { setLoadPub(false) }
  }

  function changeTab(t: 'lock'|'vesting'|'mylocks'|'public') {
    setTab(t); setTxDig(''); setErr('')
    if (t === 'mylocks' && account) { setLoadLks(true); loadLocks() }
    if (t === 'public') { setLoadPub(true); loadPublicLocks() }
  }

  // Fetch coin decimals when token type changes
  useEffect(() => {
    if (!tok || tok === SUI_COIN_TYPE) { setTokDecimals(9); return }
    suiClient.getCoinMetadata({ coinType: tok })
      .then(meta => { if (meta?.decimals != null) setTokDecimals(meta.decimals) })
      .catch(() => setTokDecimals(6)) // default to 6 for unknown tokens
  }, [tok])

  async function submit(e: React.FormEvent, typ: 'lock'|'vesting') {
    e.preventDefault(); setErr('')
    if (!account) return
    const tx = new Transaction()
    const base = BigInt(Math.floor(parseFloat(amt) * 10 ** tokDecimals))
    const isSui = tok === SUI_COIN_TYPE

    if (typ === 'lock') {
      const ums = new Date(unlockD).getTime()
      if (ums <= Date.now()) { setErr('Unlock must be in future'); return }
      if (isSui) {
        const [coin, fee] = tx.splitCoins(tx.gas, [tx.pure.u64(base + BigInt(PLATFORM_FEE)), tx.pure.u64(BigInt(PLATFORM_FEE))])
        tx.moveCall({ target: `${VESTING_PKG}::token_locker::lock`, arguments: [coin, fee, tx.object(SUI_CLOCK_OBJECT_ID), tx.pure.address(ben), tx.pure.u64(BigInt(ums))], typeArguments: [tok] })
      } else {
        // Fetch all coins of this type using dapp-kit suiClient
        console.log('[SuiLock] Fetching coins for', tok)
        let allCoins: { coinType: string; coinObjectId: string }[] = []
        try {
          const resp = await suiClient.getCoins({ owner: account.address, coinType: tok })
          allCoins = resp.data
          console.log('[SuiLock] Found coins:', allCoins.length)
        } catch (e) {
          console.error('[SuiLock] getCoins error:', e)
          setErr('Failed to fetch coins. Check the token address format (e.g. 0x...::module::TYPE).')
          return
        }
        if (!allCoins.length) { setErr('No tokens found for this type in your wallet'); return }

        // Merge all matching coin objects, then split the desired amount
        const primaryCoin = tx.object(allCoins[0].coinObjectId)
        if (allCoins.length > 1) {
          tx.mergeCoins(primaryCoin, allCoins.slice(1).map(c => tx.object(c.coinObjectId)))
        }
        const coinToSend = tx.splitCoins(primaryCoin, [tx.pure.u64(base)])
        const fee = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(PLATFORM_FEE))])
        tx.moveCall({ target: `${VESTING_PKG}::token_locker::lock`, arguments: [coinToSend, fee, tx.object(SUI_CLOCK_OBJECT_ID), tx.pure.address(ben), tx.pure.u64(BigInt(ums))], typeArguments: [tok] })
      }
      signAndExec({ transaction: tx as never }, { onSuccess: (r) => { setTxDig(r.digest); setAmt(''); setUnlockD('') }, onError: (r: unknown) => setErr((r as Error).message) })
    } else {
      const cms = new Date(cliffD).getTime(); const ems = new Date(endD).getTime()
      if (cms <= Date.now() || ems <= cms) { setErr('Invalid cliff/end dates'); return }
      if (isSui) {
        const [coin, fee] = tx.splitCoins(tx.gas, [tx.pure.u64(base + BigInt(PLATFORM_FEE)), tx.pure.u64(BigInt(PLATFORM_FEE))])
        tx.moveCall({ target: `${VESTING_PKG}::vesting_schedule::new`, arguments: [coin, fee, tx.object(SUI_CLOCK_OBJECT_ID), tx.pure.address(ben), tx.pure.u64(BigInt(cms)), tx.pure.u64(BigInt(ems))], typeArguments: [tok] })
      } else {
        // Fetch all coins of this type using dapp-kit suiClient
        console.log('[SuiLock] Fetching coins for vesting', tok)
        let allCoins: { coinType: string; coinObjectId: string }[] = []
        try {
          const resp = await suiClient.getCoins({ owner: account.address, coinType: tok })
          allCoins = resp.data
          console.log('[SuiLock] Found coins:', allCoins.length)
        } catch (e) {
          console.error('[SuiLock] getCoins error:', e)
          setErr('Failed to fetch coins. Check the token address format (e.g. 0x...::module::TYPE).')
          return
        }
        if (!allCoins.length) { setErr('No tokens found for this type in your wallet'); return }

        // Merge all matching coin objects, then split the desired amount
        const primaryCoin = tx.object(allCoins[0].coinObjectId)
        if (allCoins.length > 1) {
          tx.mergeCoins(primaryCoin, allCoins.slice(1).map(c => tx.object(c.coinObjectId)))
        }
        const coinToSend = tx.splitCoins(primaryCoin, [tx.pure.u64(base)])
        const fee = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(PLATFORM_FEE))])
        tx.moveCall({ target: `${VESTING_PKG}::vesting_schedule::new`, arguments: [coinToSend, fee, tx.object(SUI_CLOCK_OBJECT_ID), tx.pure.address(ben), tx.pure.u64(BigInt(cms)), tx.pure.u64(BigInt(ems))], typeArguments: [tok] })
      }
      signAndExec({ transaction: tx as never }, { onSuccess: (r) => { setTxDig(r.digest); setAmt(''); setCliffD(''); setEndD('') }, onError: (r: unknown) => setErr((r as Error).message) })
    }
  }

  function claim(l: Lk) {
    if (!account) return; setClaiming(l.id)
    const tx = new Transaction()
    const [res] = tx.moveCall({ target: `${VESTING_PKG}::${l.type==='lock'?'token_locker':'vesting_schedule'}::claim`, arguments: [tx.object(l.id), tx.object(SUI_CLOCK_OBJECT_ID)], typeArguments: [l.tokenType] })
    tx.transferObjects([res], tx.pure.address(account.address))
    signAndExec({ transaction: tx as never }, { onSuccess: (r) => { setTxDs(p => ({...p, [l.id]: r.digest })); setClaiming(null); setTimeout(loadLocks, 3000) }, onError: (r: unknown) => { setErr((r as Error).message); setClaiming(null) } })
  }

  const needsWallet = tab === 'lock' || tab === 'vesting' || tab === 'mylocks'

  const tabs = [{k:'lock',l:'Lock Tokens',i:Lock},{k:'vesting',l:'Vesting',i:TrendingUp},{k:'mylocks',l:'My Locks',i:Coins},{k:'public',l:'All Locks',i:Globe}] as const

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white pt-20">
      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* Branding */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[#D4AF37] tracking-wide" style={{ background: "linear-gradient(135deg, #D4AF37 0%, #F5E7A3 25%, #D4AF37 50%, #AA7C11 75%, #D4AF37 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Sui's Official Token &amp; Vesting Locker</h1>
        </div>

        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-lg bg-[#a855f7]/20 flex items-center justify-center"><Lock className="w-5 h-5 text-[#a855f7]" /></div>
          <div><h1 className="text-2xl font-bold">SuiLock</h1><p className="text-[#9ca3af] text-sm">Token Lock & Vesting Platform</p></div>
        </div>

        <div className="flex gap-1 mb-6 bg-[#131320] p-1 rounded-lg w-fit">
          {tabs.map(({k,l,i:Icon}) => (
            <button key={k} onClick={() => changeTab(k)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab===k?'bg-[#a855f7] text-white':'text-[#9ca3af] hover:text-white'}`}>
              <Icon className="w-4 h-4" />{l}
            </button>))}
        </div>

        <div className="flex items-center gap-2 mb-6 text-sm text-[#9ca3af]">
          <Info className="w-4 h-4 text-[#a855f7]" />
          <span>1 SUI platform fee + gas &nbsp;•&nbsp; Balance: </span>
          <span className="text-[#22c55e] font-medium">{bal.toFixed(2)} SUI</span>
        </div>

        {txDig && <div className="mb-6 p-4 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/20 text-center">
          <CheckCircle className="w-8 h-8 text-[#22c55e] mx-auto mb-2" />
          <p className="font-medium">Transaction submitted!</p>
          <a href={`https://suivision.xyz/txblock/${txDig}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#22c55e] hover:underline flex items-center justify-center gap-1">
            View on Suivision <ExternalLink className="w-3 h-3" /></a>
        </div>}

        {err && <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />{err}</div>}

        {tab === 'lock' && <form onSubmit={e => submit(e,'lock')} className="bg-[#131320] border border-[#1e1e30] rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-bold">Lock Tokens</h2>
          <div><label className="block text-sm text-[#9ca3af] mb-1.5">Token Address</label>
            <input value={tok} onChange={e=>setTok(e.target.value)} placeholder="0x2::sui::SUI" required
              className="w-full px-4 py-2.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e30] text-white placeholder:text-[#4b5563] focus:outline-none focus:border-[#a855f7]/50 font-mono text-sm" /></div>
          <div><label className="block text-sm text-[#9ca3af] mb-1.5">Amount to Lock</label>
            <input type="number" step="any" value={amt} onChange={e=>setAmt(e.target.value)} placeholder="e.g. 10000" required
              className="w-full px-4 py-2.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e30] text-white placeholder:text-[#4b5563] focus:outline-none focus:border-[#a855f7]/50" /></div>
          <div><label className="block text-sm text-[#9ca3af] mb-1.5">Beneficiary Address</label>
            <input value={ben} onChange={e=>setBen(e.target.value)} placeholder="0x... (who claims after unlock)" required
              className="w-full px-4 py-2.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e30] text-white placeholder:text-[#4b5563] focus:outline-none focus:border-[#a855f7]/50 font-mono text-sm" /></div>
          <div><label className="block text-sm text-[#9ca3af] mb-1.5">Unlock Date & Time</label>
            <input type="datetime-local" value={unlockD} onChange={e=>setUnlockD(e.target.value)} required
              className="w-full px-4 py-2.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e30] text-white focus:outline-none focus:border-[#a855f7]/50" /></div>
          <button type="submit" disabled={txPending}
            className="w-full py-3 rounded-lg bg-[#a855f7] hover:bg-[#9333ea] disabled:opacity-50 font-semibold transition-all flex items-center justify-center gap-2">
            {txPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : 'Lock Tokens'}</button>
        </form>}

        {tab === 'vesting' && <form onSubmit={e => submit(e,'vesting')} className="bg-[#131320] border border-[#1e1e30] rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-bold">Create Vesting Schedule</h2>
          <div><label className="block text-sm text-[#9ca3af] mb-1.5">Token Address</label>
            <input value={tok} onChange={e=>setTok(e.target.value)} placeholder="0x2::sui::SUI" required
              className="w-full px-4 py-2.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e30] text-white placeholder:text-[#4b5563] focus:outline-none focus:border-[#a855f7]/50 font-mono text-sm" /></div>
          <div><label className="block text-sm text-[#9ca3af] mb-1.5">Total Amount to Vest</label>
            <input type="number" step="any" value={amt} onChange={e=>setAmt(e.target.value)} placeholder="e.g. 1000000" required
              className="w-full px-4 py-2.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e30] text-white placeholder:text-[#4b5563] focus:outline-none focus:border-[#a855f7]/50" /></div>
          <div><label className="block text-sm text-[#9ca3af] mb-1.5">Beneficiary Address</label>
            <input value={ben} onChange={e=>setBen(e.target.value)} placeholder="0x... (who receives tokens)" required
              className="w-full px-4 py-2.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e30] text-white placeholder:text-[#4b5563] focus:outline-none focus:border-[#a855f7]/50 font-mono text-sm" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm text-[#9ca3af] mb-1.5">Cliff Date</label>
              <input type="datetime-local" value={cliffD} onChange={e=>setCliffD(e.target.value)} required
                className="w-full px-4 py-2.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e30] text-white focus:outline-none focus:border-[#a855f7]/50" />
              <p className="text-xs text-[#6b7280] mt-1">When first tokens unlock</p></div>
            <div><label className="block text-sm text-[#9ca3af] mb-1.5">End Date</label>
              <input type="datetime-local" value={endD} onChange={e=>setEndD(e.target.value)} required
                className="w-full px-4 py-2.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e30] text-white focus:outline-none focus:border-[#a855f7]/50" />
              <p className="text-xs text-[#6b7280] mt-1">When all tokens vested</p></div>
          </div>
          <button type="submit" disabled={txPending}
            className="w-full py-3 rounded-lg bg-[#a855f7] hover:bg-[#9333ea] disabled:opacity-50 font-semibold transition-all flex items-center justify-center gap-2">
            {txPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : 'Create Vesting Schedule'}</button>
        </form>}

        {tab === 'mylocks' && (loadLks ? <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 text-[#a855f7] animate-spin" /></div>
          : locks.length === 0 ? <div className="text-center py-20 bg-[#131320] border border-[#1e1e30] rounded-xl"><Lock className="w-12 h-12 text-[#4b5563] mx-auto mb-4" /><p className="text-[#9ca3af]">No locks found where you are the beneficiary.</p></div>
          : <div className="space-y-3">{locks.map(l => (
            <div key={l.id} className="p-4 bg-[#131320] border border-[#1e1e30] rounded-xl">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    {l.type==='lock' ? <Lock className="w-4 h-4 text-[#a855f7]" /> : <TrendingUp className="w-4 h-4 text-[#22c55e]" />}
                    <span className="text-xs font-medium px-2 py-0.5 rounded bg-[#a855f7]/10 text-[#a855f7]">{l.type==='lock'?'Token Lock':'Vesting'}</span>
                    <span className="text-xs text-[#6b7280] font-mono">{l.tokenType.slice(0,10)}...</span>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div><span className="text-[#6b7280] text-xs">Balance</span><div className="font-medium">{fmtAmt(l.balance, l.decimals)}</div></div>
                    {l.type==='lock' ? <><div><span className="text-[#6b7280] text-xs">Unlocks</span><div className="font-medium text-xs">{fmtD(l.unlockTime??0)}</div></div><div><span className="text-[#6b7280] text-xs">Time left</span><div className="font-medium text-xs">{tl(l.unlockTime??0)}</div></div></>
                      : <><div><span className="text-[#6b7280] text-xs">Cliff</span><div className="font-medium text-xs">{fmtD(l.cliffTime??0)}</div></div><div><span className="text-[#6b7280] text-xs">Fully Vested</span><div className="font-medium text-xs">{fmtD(l.endTime??0)}</div></div></>}
                  </div>
                </div>
                <div>{txDs[l.id] ? <a href={`https://suivision.xyz/txblock/${txDs[l.id]}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-[#22c55e]"><CheckCircle className="w-3 h-3" /> Claimed</a>
                  : l.type==='lock' && l.unlockTime && l.unlockTime > Date.now() ? <span className="flex items-center gap-1 text-xs text-[#6b7280]"><Clock className="w-3 h-3" /> {tl(l.unlockTime)}</span>
                  : l.type==='vesting' && l.cliffTime && l.cliffTime > Date.now() ? <span className="flex items-center gap-1 text-xs text-[#6b7280]"><Clock className="w-3 h-3" /> Cliff: {tl(l.cliffTime)}</span>
                  : <button onClick={() => claim(l)} disabled={claiming===l.id}
                    className="px-4 py-1.5 rounded-lg bg-[#a855f7] hover:bg-[#9333ea] disabled:opacity-50 text-sm font-medium transition-all flex items-center gap-1.5">
                      {claiming===l.id?<Loader2 className="w-3 h-3 animate-spin" />:<CheckCircle className="w-3 h-3" />} Claim</button>}</div>
              </div>
            </div>))}</div>)}

        {tab === 'public' && (loadPub ? <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 text-[#a855f7] animate-spin" /></div>
          : pubLocks.length === 0 ? <div className="text-center py-20 bg-[#131320] border border-[#1e1e30] rounded-xl"><Globe className="w-12 h-12 text-[#4b5563] mx-auto mb-4" /><p className="text-[#9ca3af]">No public locks or vesting schedules found.</p></div>
          : <div className="space-y-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-[#9ca3af]">{pubLocks.length} lock{pubLocks.length !== 1 ? 's' : ''} found</p>
              <button onClick={loadPublicLocks} className="text-xs text-[#a855f7] hover:text-[#9333ea] transition-colors">Refresh</button>
            </div>
            {pubLocks.map(l => (
            <div key={l.id} className="p-4 bg-[#131320] border border-[#1e1e30] rounded-xl">
              <div className="flex items-center gap-2 mb-3">
                {l.type==='lock' ? <Lock className="w-4 h-4 text-[#a855f7]" /> : <TrendingUp className="w-4 h-4 text-[#22c55e]" />}
                <span className={`text-xs font-medium px-2 py-0.5 rounded ${l.type==='lock' ? 'bg-[#a855f7]/10 text-[#a855f7]' : 'bg-[#22c55e]/10 text-[#22c55e]'}`}>{l.type==='lock'?'Token Lock':'Vesting'}</span>
                <span className="text-xs text-[#D4AF37] font-semibold">{fmtToken(l.tokenType)}</span>
                <span className="ml-auto text-xs text-[#6b7280]">
                  {l.type==='lock'
                    ? (l.unlockTime && l.unlockTime <= Date.now() ? <span className="text-[#22c55e]">Unlocked</span> : tl(l.unlockTime??0))
                    : (l.endTime && l.endTime <= Date.now() ? <span className="text-[#22c55e]">Fully Vested</span> : `Cliff: ${tl(l.cliffTime??0)}`)}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div><span className="text-[#6b7280] text-xs block">Balance</span><div className="font-medium">{fmtAmt(l.balance, l.decimals)}</div></div>
                <div><span className="text-[#6b7280] text-xs block">{l.type==='lock' ? 'Unlocks' : 'Cliff'}</span><div className="font-medium text-xs">{fmtD(l.type==='lock' ? l.unlockTime??0 : l.cliffTime??0)}</div></div>
                <div><span className="text-[#6b7280] text-xs block">Creator</span><div className="font-medium text-xs font-mono">{fmtAddr(l.creator)}</div></div>
                <div><span className="text-[#6b7280] text-xs block">Beneficiary</span><div className="font-medium text-xs font-mono">{fmtAddr(l.beneficiary)}</div></div>
              </div>
              <div className="mt-2 pt-2 border-t border-[#1e1e30] flex items-center justify-between">
                <span className="text-xs text-[#6b7280] font-mono">{l.tokenType.length > 30 ? l.tokenType.slice(0,20)+'...'+l.tokenType.slice(-10) : l.tokenType}</span>
                <a href={`https://suivision.xyz/object/${l.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#a855f7] hover:underline flex items-center gap-1">
                  View <ExternalLink className="w-3 h-3" /></a>
              </div>
            </div>))}</div>)}
      </div>
    </div>)
}
