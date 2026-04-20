import { Metadata } from 'next'
export const metadata: Metadata = { title: 'Odyssey 2.0 — Deck' }
export default function DeckPage() {
  return (
    <html lang="en">
    <head><meta charSet="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>Odyssey 2.0 — AI Agent Launchpad</title></head>
    <body style="margin:0;padding:0;background:#07070e;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
      <iframe src="/deck.html" style="width:100vw;height:100vh;border:none;"/>
    </body>
    </html>
  )
}
