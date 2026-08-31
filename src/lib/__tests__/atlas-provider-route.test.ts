import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/ai/test-provider/route'

afterEach(() => vi.restoreAllMocks())

describe('Atlas Cloud server-side connection probe', () => {
  it('calls the official read-only balance endpoint and returns the real balance', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      object: 'balance',
      available: { value: '12.340000', currency: 'usd' },
    }), { status: 200 }))
    const request = new NextRequest('http://localhost/api/ai/test-provider', {
      method: 'POST',
      body: JSON.stringify({ name: 'atlas-cloud', apiKey: 'apikey-test' }),
      headers: { 'content-type': 'application/json' },
    })
    const response = await POST(request)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.atlascloud.ai/public/v1/balance',
      expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer apikey-test' } })
    )
    expect(await response.json()).toMatchObject({
      status: 'ok',
      code: 'CONNECTED',
      balance: { value: '12.340000', currency: 'usd' },
    })
  })

  it('does not falsely accept a rejected Atlas key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 }))
    const request = new NextRequest('http://localhost/api/ai/test-provider', {
      method: 'POST',
      body: JSON.stringify({ name: 'atlas-cloud', apiKey: 'bad-key' }),
      headers: { 'content-type': 'application/json' },
    })
    const response = await POST(request)
    expect(await response.json()).toMatchObject({ status: 'invalid', code: 'INVALID_KEY' })
  })

  it('validates generation access when a team key cannot read account balance', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"error":"forbidden"}', { status: 403 }))
      .mockResolvedValueOnce(new Response('{"code":404,"msg":"prediction not found"}', { status: 404 }))
    const request = new NextRequest('http://localhost/api/ai/test-provider', {
      method: 'POST',
      body: JSON.stringify({ name: 'atlas-cloud', apiKey: 'apikey-team-video-only' }),
      headers: { 'content-type': 'application/json' },
    })
    const response = await POST(request)
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.atlascloud.ai/api/v1/model/prediction/mora-connection-probe-does-not-exist')
    expect(await response.json()).toMatchObject({ status: 'ok', code: 'CONNECTED_NO_BALANCE_SCOPE' })
  })
})
