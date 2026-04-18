const BASE = '/api'

async function request(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = payload?.error || payload?.message || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return payload || {}
}

export const api = {
  getAccount: (network, address) =>
    request(`/${network}/account`, { address }),

  getTransfers: (network, address, page = 0) =>
    request(`/${network}/transfers`, { address, page, row: 20 }),

  getStaking: (network, address) =>
    request(`/${network}/staking`, { address }),

  getBalanceHistory: (network, address) =>
    request(`/${network}/balance-history`, { address }),

  getRelatedAddresses: (network, address) =>
    request(`/${network}/related`, { address }),

  getAccountTags: (network, addresses) =>
    request(`/${network}/account-tags`, { addresses }),
}
