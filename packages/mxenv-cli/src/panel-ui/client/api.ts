const token = window.location.pathname.split('/').filter(Boolean)[0] ?? ''
const profile = new URLSearchParams(window.location.search).get('profile') || ''

export class PanelApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'PanelApiError'
  }
}

export async function panelApi<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const requestUrl = new URL(path, window.location.origin)
  const method = (init.method || 'GET').toUpperCase()
  if (profile && method === 'GET') requestUrl.searchParams.set('profile', profile)
  let requestBody = init.body
  if (profile && method !== 'GET' && typeof requestBody === 'string') {
    const payload = JSON.parse(requestBody) as Record<string, unknown>
    if (!payload.profile) payload.profile = profile
    requestBody = JSON.stringify(payload)
  }
  const requestPath = `${requestUrl.pathname}${requestUrl.search}`
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/json')
  headers.set('authorization', `Bearer ${token}`)
  headers.set('x-mxenv-panel', '1')
  if (requestBody) headers.set('content-type', 'application/json')

  const response = await fetch(requestPath, {
    ...init,
    body: requestBody,
    headers,
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'manual',
    referrerPolicy: 'no-referrer',
  })
  if (response.status === 401 && path !== '/unlock') {
    window.location.assign('/')
    throw new PanelApiError(401, 'This panel session is no longer available.')
  }

  let body: unknown = {}
  try {
    body = await response.json()
  } catch {
    // Non-JSON errors are converted to a generic status message below.
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body && 'error' in body && typeof body.error === 'string'
      ? body.error
      : `Request failed (${response.status}).`
    throw new PanelApiError(response.status, message)
  }
  return body as T
}
