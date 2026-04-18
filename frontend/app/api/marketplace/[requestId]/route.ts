import { NextRequest, NextResponse } from 'next/server'
import { getRequest } from '@/lib/marketplace'
import { retrieveBlob } from '@/lib/walrus'

export const dynamic = 'force-dynamic'

/**
 * GET /api/marketplace/:requestId
 * Get request status. If delivered, optionally fetch result from Walrus.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params
    const serviceRequest = await getRequest(requestId)

    if (!serviceRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    const includeResult = request.nextUrl.searchParams.get('result') === 'true'

    // If delivered and caller wants the full result, fetch from Walrus
    let result: string | undefined
    if (includeResult && serviceRequest.resultBlobId && serviceRequest.status === 'delivered') {
      const walrusResult = await retrieveBlob(serviceRequest.resultBlobId)
      if (walrusResult.success) {
        result = walrusResult.data
      }
    }

    return NextResponse.json({
      request: serviceRequest,
      ...(result !== undefined && { result }),
    })
  } catch (error: any) {
    console.error('Marketplace get error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
