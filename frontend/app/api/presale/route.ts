import { NextResponse } from 'next/server'
import { fetchAllPresales } from '@/lib/presale'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const presales = await fetchAllPresales()
    return NextResponse.json(presales)
  } catch (error: any) {
    console.error('Error fetching presales:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
