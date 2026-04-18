import { NextResponse } from 'next/server'
import { fetchPresale, getUserContribution } from '@/lib/presale'

export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const userAddress = searchParams.get('user')

    const presale = await fetchPresale(id)
    if (!presale) {
      return NextResponse.json({ error: 'Presale not found' }, { status: 404 })
    }

    let userContribution = 0
    if (userAddress) {
      userContribution = await getUserContribution(id, userAddress)
    }

    return NextResponse.json({ ...presale, userContribution })
  } catch (error: any) {
    console.error('Error fetching presale:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
