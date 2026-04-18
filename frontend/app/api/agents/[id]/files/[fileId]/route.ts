import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

const MIME_TYPES: Record<string, string> = {
  '.py': 'text/x-python',
  '.js': 'application/javascript',
  '.ts': 'application/typescript',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.sh': 'application/x-sh',
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml',
  '.toml': 'application/toml',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.css': 'text/css',
  '.sql': 'application/sql',
  '.move': 'text/plain',
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const { fileId } = await params

  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return NextResponse.json({ error: 'Storage not configured' }, { status: 500 })
  }

  if (!/^file_\d+_[a-z0-9]+$/.test(fileId)) {
    return NextResponse.json({ error: 'Invalid file ID' }, { status: 400 })
  }

  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['GET', `file:${fileId}`]),
    cache: 'no-store',
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'Storage error' }, { status: 500 })
  }

  const data = await res.json()
  if (!data?.result) {
    return NextResponse.json({ error: 'File not found or expired' }, { status: 404 })
  }

  let file: { filename: string; content: string }
  try {
    file = JSON.parse(data.result)
  } catch {
    return NextResponse.json({ error: 'Corrupt file data' }, { status: 500 })
  }

  const ext = '.' + (file.filename.split('.').pop() || 'txt')
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'

  return new NextResponse(file.content, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': 'no-cache',
    },
  })
}
