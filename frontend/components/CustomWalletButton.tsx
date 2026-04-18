'use client'

import { useState, useEffect } from 'react'

function formatAddress(addr: string) {
  return addr ? addr.slice(0, 6) + '...' + addr.slice(-4) : ''
}

export default function CustomWalletButton() {
  const [connected, setConnected] = useState(false)
  const [account, setAccount] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [wallets, setWallets] = useState<Array<{ name: string; wallet: any }>>([])
  const [showModal, setShowModal] = useState(false)

  useEffect(function() {
    function getWallets() {
      const win = typeof window !== 'undefined' ? window as any : null
      const result: Array<{ name: string; wallet: any }> = []
      if (win) {
        // Try all known Sui wallet injections
        if (win.suiWallet) result.push({ name: 'Sui Wallet', wallet: win.suiWallet })
        if (win.sui) result.push({ name: 'Sui', wallet: win.sui })
        if (win.suiProvider) result.push({ name: 'Sui Provider', wallet: win.suiProvider })
        if (win.suilend) result.push({ name: 'Suilend', wallet: win.suilend })
        if (win.fluxwallet) result.push({ name: 'Flux Wallet', wallet: win.fluxwallet })
        if (win.eth_sui_wallet) result.push({ name: 'Eth Sui Wallet', wallet: win.eth_sui_wallet })
        if (win.slush) result.push({ name: 'Slush', wallet: win.slush })
        if (win.slushWallet) result.push({ name: 'Slush Wallet', wallet: win.slushWallet })
      }
      // Also try wallet-standard discovery API
      if (win?.navigator?.wallet?.getInstalled) {
        win.navigator.wallet.getInstalled().then(function(installed: any[]) {
          if (installed && installed.length > 0) {
            installed.forEach(function(w: any) {
              if (!result.find(function(r) { return r.name === w.name })) {
                result.push({ name: w.name || 'Unknown Wallet', wallet: w })
              }
            })
            setWallets([...result])
            console.log('[Wallet Debug] via navigator.wallet:', installed.map(function(w: any) { return w.name }))
          }
        }).catch(function() {})
      }
      return result
    }

    const detected = getWallets()
    setWallets(detected)
    console.log('[Wallet Debug] Detected wallets:', detected.map(function(w: any) { return w.name }))

    if (detected.length > 0) {
      detected[0].wallet.getAccounts().then(function(accounts: string[]) {
        if (accounts && accounts.length > 0) {
          setConnected(true)
          setAccount(accounts[0])
        }
      }).catch(function() {})
    }
  }, [])

  async function connect(wallet: any) {
    setLoading(true)
    try {
      const result = await wallet.connect()
      const accounts = Array.isArray(result) ? result : (result && (result as any).accounts) ? (result as any).accounts : []
      if (accounts.length > 0) {
        setConnected(true)
        setAccount(accounts[0])
        setShowModal(false)
      }
    } catch (e: any) {
      console.error('Connect error:', e)
    } finally {
      setLoading(false)
    }
  }

  async function disconnectWallet() {
    const win = typeof window !== 'undefined' ? window as any : null
    const detected = wallets.length > 0 ? wallets : (win ? [
      win.suiWallet && { name: 'Sui Wallet', wallet: win.suiWallet },
      win.sui && { name: 'Sui', wallet: win.sui },
    ].filter(Boolean) : [])
    if (detected.length > 0) {
      try {
        await detected[0].wallet.disconnect()
        setConnected(false)
        setAccount(null)
      } catch (e) {
        console.error('Disconnect error:', e)
      }
    }
  }

  if (connected && account) {
    return (
      <button
        onClick={disconnectWallet}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-500/20 border border-green-500/40 hover:bg-green-500/30 transition-all text-green-300 text-sm"
      >
        <span className="w-2 h-2 rounded-full bg-green-400" />
        {formatAddress(account)}
      </button>
    )
  }

  return (
    <div>
      <button
        onClick={function() { setShowModal(true) }}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-600/20 border border-purple-500/40 hover:bg-purple-500/20 transition-all text-purple-300 text-sm"
      >
        {loading ? 'Connecting...' : 'Connect Wallet'}
      </button>

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={function() { setShowModal(false) }}
        >
          <div
            className="bg-[#0f0f1a] border border-white/20 rounded-2xl p-6 w-80"
            onClick={function(e: any) { e.stopPropagation() }}
          >
            <h3 className="text-lg font-bold mb-4 text-white">Select Wallet</h3>

            {wallets.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-4">No Sui wallet detected.</p>
                <p className="text-sm text-muted-foreground">
                  Install{' '}
                  <a
                    href="https://chromewebstore.google.com/detail/sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 underline"
                  >
                    Sui Wallet
                  </a>
                  {' or '}
                  <a
                    href="https://chromewebstore.google.com/detail/suiet-wallet/fkmidolnhmlmbdlhnbpfhfbpbljepfck"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 underline"
                  >
                    Suiet
                  </a>
                  {' from Chrome Web Store, then refresh.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {wallets.map(function(w: any) {
                  return (
                    <button
                      key={w.name}
                      onClick={function() { connect(w.wallet) }}
                      className="w-full text-left px-4 py-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-white"
                    >
                      {w.name}
                    </button>
                  )
                })}
              </div>
            )}

            <button
              onClick={function() { setShowModal(false) }}
              className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
