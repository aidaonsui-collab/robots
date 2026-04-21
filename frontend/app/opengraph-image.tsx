import { ImageResponse } from 'next/og'

// Auto-generated Open Graph card rendered by Satori via Next's ImageResponse.
// Rendering lives on the edge so Telegram / X / Discord fetches are fast.
// Same file is re-used for the Twitter card (see ./twitter-image.tsx).
export const runtime = 'edge'
export const alt = 'Odyssey 2.0 — AI Agent Launchpad'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const GOLD = '#D4AF37'
const GOLD_LIGHT = '#F5E7A3'

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#07070e',
          backgroundImage:
            'radial-gradient(ellipse at center, #1a1409 0%, #07070e 55%, #000000 100%)',
          color: GOLD,
          fontFamily: 'sans-serif',
          padding: 40,
        }}
      >
        {/* Viking longship — mirrors components/Navbar.tsx VikingBoatIcon */}
        <svg width="440" height="385" viewBox="0 0 80 70" fill="none">
          {/* Hull */}
          <path
            d="M 10,45 Q 5,50 3,52 Q 40,58 77,52 Q 75,50 70,45 Z"
            fill={GOLD}
            stroke={GOLD}
            strokeWidth="1.5"
            opacity="0.9"
          />
          {/* Hull upper edge */}
          <path
            d="M 10,45 L 15,35 L 65,35 L 70,45"
            fill={GOLD}
            stroke={GOLD}
            strokeWidth="1.5"
            opacity="0.95"
          />
          {/* Hull planking */}
          <line x1="17" y1="37" x2="63" y2="37" stroke={GOLD} strokeWidth="0.8" opacity="0.4" />
          <line x1="18" y1="40" x2="62" y2="40" stroke={GOLD} strokeWidth="0.8" opacity="0.4" />
          {/* Dragon-head bow */}
          <g transform="translate(70, 40)">
            <path d="M 0,0 Q 5,-5 10,-8" stroke={GOLD} strokeWidth="2" fill="none" />
            <ellipse cx="12" cy="-10" rx="4" ry="5" fill={GOLD} stroke={GOLD} strokeWidth="1.5" />
            <circle cx="13" cy="-11" r="1" fill="#07070e" />
            <path d="M 14,-8 L 17,-7 L 16,-9 Z" fill={GOLD} />
            <path d="M 11,-14 L 10,-18 L 12,-15" fill={GOLD} />
          </g>
          {/* Stern */}
          <g transform="translate(10, 40)">
            <path d="M 0,0 Q -4,-3 -7,-6" stroke={GOLD} strokeWidth="2" fill="none" />
            <circle cx="-8" cy="-7" r="2.5" fill={GOLD} stroke={GOLD} strokeWidth="1.5" />
          </g>
          {/* Mast */}
          <line x1="40" y1="35" x2="40" y2="-5" stroke={GOLD} strokeWidth="2.5" />
          {/* Sail */}
          <path
            d="M 40,-3 Q 55,5 60,15 Q 58,20 40,30 Z"
            fill={GOLD}
            stroke={GOLD}
            strokeWidth="1.8"
            opacity="0.75"
          />
          <line x1="40" y1="5" x2="57" y2="8" stroke={GOLD} strokeWidth="0.8" opacity="0.4" />
          <line x1="40" y1="12" x2="58" y2="15" stroke={GOLD} strokeWidth="0.8" opacity="0.4" />
          {/* Shields */}
          <g opacity="0.85">
            <circle cx="22" cy="38" r="3" fill="#8B4513" stroke={GOLD} strokeWidth="0.8" />
            <circle cx="32" cy="38" r="3" fill="#654321" stroke={GOLD} strokeWidth="0.8" />
            <circle cx="42" cy="38" r="3" fill="#8B4513" stroke={GOLD} strokeWidth="0.8" />
            <circle cx="52" cy="38" r="3" fill="#654321" stroke={GOLD} strokeWidth="0.8" />
            <circle cx="62" cy="38" r="3" fill="#8B4513" stroke={GOLD} strokeWidth="0.8" />
          </g>
          {/* Oars */}
          <g stroke={GOLD} strokeWidth="2" opacity="0.6" strokeLinecap="round">
            <line x1="25" y1="40" x2="15" y2="55" />
            <line x1="45" y1="40" x2="40" y2="58" />
            <line x1="55" y1="40" x2="52" y2="57" />
          </g>
        </svg>

        <div
          style={{
            display: 'flex',
            fontSize: 140,
            fontWeight: 900,
            letterSpacing: -4,
            lineHeight: 1,
            marginTop: 12,
          }}
        >
          Odyssey
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 40,
            fontWeight: 500,
            color: GOLD_LIGHT,
            opacity: 0.9,
            marginTop: 16,
            letterSpacing: 1,
          }}
        >
          AI Agent Launchpad
        </div>
      </div>
    ),
    { ...size },
  )
}
