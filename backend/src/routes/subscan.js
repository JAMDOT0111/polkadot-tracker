import { Router } from 'express'
import fetch from 'node-fetch'

export const subscanRouter = Router()

const SUBSCAN = {
  polkadot: 'https://polkadot.api.subscan.io',
  kusama: 'https://kusama.api.subscan.io'
}

const CACHE_TTL = 30

async function subscanPost(network, path, body, redis) {
  const base = SUBSCAN[network]
  if (!base) throw new Error(`未知網路: ${network}`)

  const cacheKey = `subscan:${network}:${path}:${JSON.stringify(body)}`

  if (redis?.isReady) {
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) return JSON.parse(cached)
  }

  const headers = { 'Content-Type': 'application/json' }
  if (process.env.SUBSCAN_API_KEY) {
    headers['X-API-Key'] = process.env.SUBSCAN_API_KEY
  }

  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })

  if (!res.ok) throw new Error(`Subscan API error: ${res.status}`)
  const data = await res.json()

  if (redis?.isReady) {
    redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(data)).catch(() => {})
  }

  return data
}

function handler(path, buildBody) {
  return async (req, res) => {
    const { network } = req.params
    const redis = req.app.locals.redis
    try {
      const data = await subscanPost(network, path, buildBody(req.body), redis)
      if (data.code !== 0) return res.status(400).json({ error: data.message || 'API error' })
      res.json(data.data || {})
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  }
}

subscanRouter.post('/:network/account', handler(
  '/api/v2/scan/search',
  b => ({ key: b.address })
))

subscanRouter.post('/:network/transfers', handler(
  '/api/v2/scan/transfers',
  b => ({ address: b.address, row: b.row || 20, page: b.page || 0 })
))

subscanRouter.post('/:network/staking', handler(
  '/api/scan/staking/validator',
  b => ({ stash: b.address })
))

subscanRouter.post('/:network/balance-history', handler(
  '/api/scan/account/balance_history',
  b => ({ address: b.address, start: '2024-01-01', end: todayStr() })
))

function todayStr() {
  return new Date().toISOString().split('T')[0]
}
