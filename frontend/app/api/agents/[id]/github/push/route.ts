import { NextRequest, NextResponse } from 'next/server'
import { getAgent } from '@/lib/agents-db'

interface FileEntry {
  path:    string
  content: string  // raw file content (not base64)
}

/**
 * POST /api/agents/[id]/github/push
 * Body: { repoName: string, description: string, files: FileEntry[] }
 *
 * Creates a new GitHub repo (or pushes to existing) and commits all files.
 * Uses the agent's stored GitHub token.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params

  const agent = await getAgent(agentId) as any
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const token    = agent.githubToken
  const username = agent.githubUsername

  if (!token || !username) {
    return NextResponse.json(
      { error: 'GitHub not connected — connect GitHub from the agent dashboard first' },
      { status: 400 }
    )
  }

  const { repoName, description, files } = await request.json() as {
    repoName:    string
    description: string
    files:       FileEntry[]
  }

  if (!repoName || !files?.length) {
    return NextResponse.json({ error: 'repoName and files required' }, { status: 400 })
  }

  const ghHeaders = {
    'Authorization': `Bearer ${token}`,
    'Accept':        'application/vnd.github+json',
    'Content-Type':  'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  try {
    // ── Step 1: Create repo (ignore if already exists) ────────────────────
    let repoUrl = ''
    const createRes = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: ghHeaders,
      body: JSON.stringify({
        name:        repoName,
        description: description || `Built by ${agent.name} on Odyssey`,
        private:     false,
        auto_init:   true,   // creates initial commit so we can push immediately
      }),
    })

    const createData = await createRes.json() as any

    if (createRes.ok) {
      repoUrl = createData.html_url
    } else if (createData.errors?.[0]?.message?.includes('already exists')) {
      // Repo already exists — fetch its URL
      const existingRes = await fetch(`https://api.github.com/repos/${username}/${repoName}`, {
        headers: ghHeaders,
      })
      const existing = await existingRes.json() as any
      repoUrl = existing.html_url
    } else {
      return NextResponse.json(
        { error: `Failed to create repo: ${createData.message}` },
        { status: 500 }
      )
    }

    // ── Step 2: Get current HEAD SHA ──────────────────────────────────────
    await new Promise(r => setTimeout(r, 1500)) // wait for repo init

    const refRes  = await fetch(
      `https://api.github.com/repos/${username}/${repoName}/git/ref/heads/main`,
      { headers: ghHeaders }
    )
    const refData = await refRes.json() as any
    const baseSha = refData.object?.sha

    if (!baseSha) {
      return NextResponse.json({ error: 'Could not get repo HEAD SHA' }, { status: 500 })
    }

    // ── Step 3: Create blobs for each file ───────────────────────────────
    const treeItems = await Promise.all(
      files.map(async (file) => {
        const blobRes = await fetch(
          `https://api.github.com/repos/${username}/${repoName}/git/blobs`,
          {
            method:  'POST',
            headers: ghHeaders,
            body:    JSON.stringify({
              content:  Buffer.from(file.content).toString('base64'),
              encoding: 'base64',
            }),
          }
        )
        const blob = await blobRes.json() as any
        return {
          path:    file.path,
          mode:    '100644',
          type:    'blob',
          sha:     blob.sha,
        }
      })
    )

    // ── Step 4: Create tree ───────────────────────────────────────────────
    const treeRes = await fetch(
      `https://api.github.com/repos/${username}/${repoName}/git/trees`,
      {
        method:  'POST',
        headers: ghHeaders,
        body:    JSON.stringify({ base_tree: baseSha, tree: treeItems }),
      }
    )
    const tree = await treeRes.json() as any

    // ── Step 5: Create commit ─────────────────────────────────────────────
    const commitRes = await fetch(
      `https://api.github.com/repos/${username}/${repoName}/git/commits`,
      {
        method:  'POST',
        headers: ghHeaders,
        body:    JSON.stringify({
          message: `🤖 Built by ${agent.name} via Odyssey`,
          tree:    tree.sha,
          parents: [baseSha],
        }),
      }
    )
    const commit = await commitRes.json() as any

    // ── Step 6: Update main branch ref ───────────────────────────────────
    await fetch(
      `https://api.github.com/repos/${username}/${repoName}/git/refs/heads/main`,
      {
        method:  'PATCH',
        headers: ghHeaders,
        body:    JSON.stringify({ sha: commit.sha }),
      }
    )

    return NextResponse.json({
      success:  true,
      repoUrl,
      repoName,
      commitSha: commit.sha,
      files:    files.map(f => f.path),
    })
  } catch (err: any) {
    console.error('GitHub push error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/**
 * GET /api/agents/[id]/github/push
 * Returns the agent's connected GitHub username and recent repos
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params
  const agent = await getAgent(agentId) as any
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const token    = agent.githubToken
  const username = agent.githubUsername

  if (!token) return NextResponse.json({ connected: false })

  try {
    // Fetch repos created by this agent (repos starting with known prefix or all)
    const reposRes  = await fetch(
      `https://api.github.com/users/${username}/repos?sort=created&per_page=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const repos = await reposRes.json() as any[]
    return NextResponse.json({
      connected: true,
      username,
      repos: repos.map(r => ({
        name:        r.name,
        url:         r.html_url,
        description: r.description,
        createdAt:   r.created_at,
      })),
    })
  } catch {
    return NextResponse.json({ connected: true, username, repos: [] })
  }
}
