'use client'

import { useState } from 'react'

interface VideoEmbedProps {
  url?: string | null
  title?: string
  aspectRatio?: '16/9' | '21/9'
  autoplay?: boolean
}

interface ParsedVideo {
  platform: 'youtube' | 'twitch' | 'tiktok' | null
  videoId?: string
  channel?: string
  embedUrl?: string
  externalUrl?: string  // for platforms that can't be embedded (TikTok)
}

function parseStreamUrl(url: string): ParsedVideo {
  if (!url) return { platform: null }

  try {
    const u = new URL(url)

    // YouTube Live / YouTube video
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
      // youtube.com/live/VIDEO_ID
      if (u.pathname.includes('/live/')) {
        const videoId = u.pathname.split('/live/')[1]?.split('/')[0]
        return {
          platform: 'youtube',
          videoId,
          embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&rel=0&playsinline=1`,
        }
      }
      // youtube.com/watch?v=VIDEO_ID
      if (u.hostname.includes('youtube.com') && u.pathname === '/watch') {
        const videoId = u.searchParams.get('v')
        if (!videoId) return { platform: null }
        return {
          platform: 'youtube',
          videoId,
          embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&rel=0&playsinline=1`,
        }
      }
      // youtu.be/VIDEO_ID (short link)
      if (u.hostname === 'youtu.be') {
        const videoId = u.pathname.slice(1)
        return {
          platform: 'youtube',
          videoId,
          embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&rel=0&playsinline=1`,
        }
      }
      // youtube.com/embed/VIDEO_ID
      if (u.pathname.startsWith('/embed/')) {
        const videoId = u.pathname.split('/embed/')[1]?.split('?')[0]
        return {
          platform: 'youtube',
          videoId,
          embedUrl: url,
        }
      }
      // Generic youtube.com/VIDEO_ID
      const segments = u.pathname.split('/').filter(Boolean)
      if (segments.length > 0) {
        const last = segments[segments.length - 1]
        return {
          platform: 'youtube',
          videoId: last,
          embedUrl: `https://www.youtube.com/embed/${last}?autoplay=1&mute=1&rel=0&playsinline=1`,
        }
      }
    }

    // TikTok Live — can't be embedded, open externally
    if (u.hostname.includes('tiktok.com')) {
      // tiktok.com/@username/live  or  tiktok.com/@username
      const username = u.pathname.match(/@([^/]+)/)?.[1] ?? ''
      return {
        platform: 'tiktok',
        channel: username,
        externalUrl: username
          ? `https://www.tiktok.com/@${username}/live`
          : url,
      }
    }

    // Twitch channel or video
    if (u.hostname.includes('twitch.tv')) {
      const segments = u.pathname.split('/').filter(Boolean)
      if (segments.length === 1) {
        // twitch.tv/CHANNEL
        return {
          platform: 'twitch',
          channel: segments[0],
          embedUrl: `https://player.twitch.tv/?channel=${segments[0]}&parent=${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}&autoplay=true&muted=false`,
        }
      }
      if (segments.length >= 2) {
        if (segments[1] === 'video') {
          // twitch.tv/CHANNEL/video/VIDEO_ID
          return {
            platform: 'twitch',
            videoId: segments[2],
            embedUrl: `https://player.twitch.tv/?video=v${segments[2]}&parent=${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}&autoplay=true&muted=false`,
          }
        }
        // twitch.tv/CHANNEL/VIDEOID
        return {
          platform: 'twitch',
          channel: segments[0],
          embedUrl: `https://player.twitch.tv/?channel=${segments[0]}&parent=${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}&autoplay=true&muted=false`,
        }
      }
    }
  } catch {
    return { platform: null }
  }

  return { platform: null }
}

export function VideoEmbed({ url, title, aspectRatio = '16/9', autoplay = true }: VideoEmbedProps) {
  const [error, setError] = useState(false)

  if (!url) {
    return (
      <div
        className="w-full flex items-center justify-center"
        style={{ aspectRatio }}
      >
        <div className="text-center">
          <div className="text-4xl mb-3 opacity-30">📺</div>
          <p className="text-muted-foreground text-sm">No stream URL set</p>
        </div>
      </div>
    )
  }

  const parsed = parseStreamUrl(url)

  // TikTok: can't embed — show a branded external-link card
  if (parsed.platform === 'tiktok') {
    return (
      <div
        className="w-full flex items-center justify-center bg-[#010101]"
        style={{ aspectRatio }}
      >
        <div className="text-center px-6">
          <div className="text-5xl mb-4">🎵</div>
          <p className="text-white font-bold text-lg mb-1">TikTok Live</p>
          {parsed.channel && (
            <p className="text-gray-400 text-sm mb-4">@{parsed.channel}</p>
          )}
          <a
            href={parsed.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#fe2c55] hover:bg-[#e0203d] text-white font-bold text-sm transition-colors"
          >
            Watch Live on TikTok ↗
          </a>
          <p className="text-gray-600 text-xs mt-3">TikTok doesn't allow live embeds on external sites</p>
        </div>
      </div>
    )
  }

  if (!parsed.platform || error) {
    return (
      <div
        className="w-full flex items-center justify-center"
        style={{ aspectRatio }}
      >
        <div className="text-center">
          <div className="text-4xl mb-3 opacity-30">🔗</div>
          <p className="text-muted-foreground text-sm">Invalid stream URL</p>
          <p className="text-xs text-muted-foreground/50 mt-1 max-w-xs truncate">{url}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full" style={{ aspectRatio }}>
      <iframe
        key={url} // re-render on URL change
        src={parsed.embedUrl}
        title={title || 'Live Stream'}
        allow="autoplay; accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
        allowFullScreen
        onError={() => setError(true)}
        className="absolute inset-0 w-full h-full rounded-xl"
      />
    </div>
  )
}
