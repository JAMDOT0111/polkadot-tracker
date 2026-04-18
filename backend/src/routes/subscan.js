import { Router } from 'express'
import fetch from 'node-fetch'
import { SUBSCAN_LIVE_NETWORKS_FOR_PORTFOLIO } from '../config/subscanPortfolioNetworks.js'

export const subscanRouter = Router()

const SUBSCAN = {
  polkadot: 'https://polkadot.api.subscan.io',
  kusama: 'https://kusama.api.subscan.io'
}

/** Extra Subscan hosts (e.g. Asset Hub) merged into Relay-style views */
const SUBSCAN_EXTRA = {
  polkadot: ['https://assethub-polkadot.api.subscan.io'],
  kusama: ['https://assethub-kusama.api.subscan.io']
}

/** 官方 live 列表中排除「本請求已在 tokens_relay／tokens_assethub_full 取過」的站台，避免重複請求 */
function portfolioTokenSourcesExcludingMerged(networkKey) {
  const skip = new Set([SUBSCAN[networkKey], ...(SUBSCAN_EXTRA[networkKey] || [])])
  return SUBSCAN_LIVE_NETWORKS_FOR_PORTFOLIO.filter(([, base]) => !skip.has(base))
}

/** account/tokens 是否在任一代幣上有正餘額 */
function tokenDataHasPositiveBalance(data) {
  if (!data || typeof data !== 'object') return false
  for (const key of ['native', 'builtin', 'assets', 'ERC20']) {
    const arr = data[key]
    if (!Array.isArray(arr)) continue
    for (const t of arr) {
      try {
        if (BigInt(String(t?.balance ?? '0')) > 0n) return true
      } catch {
        /* skip */
      }
    }
  }
  return false
}

/**
 * 分批並行請求其餘 live 網路 account/tokens（與 Subscan Portfolio 涵蓋範圍一致；失敗略過）
 */
async function fetchPortfolioParachainTokens(networkKey, address, redis) {
  const list = portfolioTokenSourcesExcludingMerged(networkKey)
  if (!Array.isArray(list) || list.length === 0) return []
  const out = []
  const batchSize = 8
  for (let i = 0; i < list.length; i += batchSize) {
    const chunk = list.slice(i, i + batchSize)
    const settled = await Promise.all(
      chunk.map(async ([chain, base]) => {
        const tok = await subscanPostOptional(base, '/api/scan/account/tokens', { address }, redis)
        if (!tok || tok.code !== 0 || !tok.data) return null
        if (!tokenDataHasPositiveBalance(tok.data)) return null
        return { chain, tokens: tok.data }
      })
    )
    for (const r of settled) {
      if (r) out.push(r)
    }
  }
  return out
}

const CACHE_TTL = 30

/** API host → 瀏覽器網址（polkadot.api.subscan.io → polkadot.subscan.io） */
function apiHostToExplorerOrigin(apiBase) {
  try {
    const u = new URL(apiBase)
    const host = u.hostname.replace(/\.api\./, '.')
    return `${u.protocol}//${host}`
  } catch {
    return 'https://polkadot.subscan.io'
  }
}

async function subscanPostRaw(base, path, body, redis, cacheNs) {
  const cacheKey = `${cacheNs}:${base}${path}:${JSON.stringify(body)}`

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

  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    if (!res.ok) {
      throw new Error(
        `Subscan API error: ${res.status}${text ? ` — ${text.slice(0, 300)}` : ''}`
      )
    }
    throw new Error('Subscan 回應不是有效 JSON')
  }

  if (!res.ok) {
    const msg = data?.message || data?.msg || data?.error || text?.slice(0, 300) || ''
    throw new Error(`Subscan API error: ${res.status}${msg ? ` — ${msg}` : ''}`)
  }

  if (redis?.isReady) {
    redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(data)).catch(() => {})
  }

  return data
}

async function subscanPost(network, path, body, redis) {
  const base = SUBSCAN[network]
  if (!base) throw new Error(`未知網路: ${network}`)
  return subscanPostRaw(base, path, body, redis, `subscan:${network}`)
}

async function subscanPostOptional(base, path, body, redis) {
  try {
    return await subscanPostRaw(base, path, body, redis, `subscan_opt:${base}`)
  } catch {
    return null
  }
}

async function subscanPostAttempt(base, path, body, redis) {
  try {
    const data = await subscanPostRaw(base, path, body, redis, `subscan_try:${base}`)
    return { ok: true, data, error: null }
  } catch (e) {
    return { ok: false, data: null, error: e?.message || 'unknown error' }
  }
}

function pickNative(list, symbol) {
  if (!Array.isArray(list)) return null
  const want = String(symbol || '').toUpperCase()
  return list.find(t => String(t.symbol || '').toUpperCase() === want) || null
}

function addPlanck(a, b) {
  try {
    return (BigInt(a || '0') + BigInt(b || '0')).toString()
  } catch {
    return a || '0'
  }
}

function maxPlanck(a, b) {
  try {
    const ba = BigInt(a || '0')
    const bb = BigInt(b || '0')
    return ba >= bb ? ba.toString() : bb.toString()
  } catch {
    return a || '0'
  }
}

/** Subscan `/api/scan/account/tokens` 各分類筆數（Portfolio 統計用） */
function tokenBucketCounts(data) {
  if (!data || typeof data !== 'object') return null
  return {
    native: Array.isArray(data.native) ? data.native.length : 0,
    builtin: Array.isArray(data.builtin) ? data.builtin.length : 0,
    assets: Array.isArray(data.assets) ? data.assets.length : 0,
    erc20: Array.isArray(data.ERC20) ? data.ERC20.length : 0
  }
}

function toFiniteNumber(v) {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function pickFirstNumber(obj, keys) {
  if (!obj || typeof obj !== 'object') return null
  for (const k of keys) {
    const n = toFiniteNumber(obj[k])
    if (n !== null) return n
  }
  return null
}

function uniqueUpperSymbolsFromTokens(raw) {
  if (!raw || typeof raw !== 'object') return []
  const out = new Set()
  for (const key of ['native', 'builtin', 'assets', 'ERC20']) {
    const arr = raw[key]
    if (!Array.isArray(arr)) continue
    for (const t of arr) {
      const s = String(t?.symbol ?? '').trim().toUpperCase()
      const u = String(t?.unique_id ?? '').trim().toUpperCase()
      if (s) out.add(s)
      else if (u) out.add(u)
    }
  }
  return Array.from(out)
}

function collectAllTokenSymbols(relayTokens, assethubTokens, paraList) {
  const out = new Set()
  for (const s of uniqueUpperSymbolsFromTokens(relayTokens)) out.add(s)
  for (const s of uniqueUpperSymbolsFromTokens(assethubTokens)) out.add(s)
  if (Array.isArray(paraList)) {
    for (const p of paraList) {
      for (const s of uniqueUpperSymbolsFromTokens(p?.tokens)) out.add(s)
    }
  }
  return Array.from(out)
}

function extractNextDataJson(html) {
  if (typeof html !== 'string' || !html) return null
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i)
  if (!m || !m[1]) return null
  try {
    return JSON.parse(m[1])
  } catch {
    return null
  }
}

function buildPriceMapFromNextData(priceObj) {
  const map = {}
  if (!priceObj || typeof priceObj !== 'object') return map
  for (const [sym, val] of Object.entries(priceObj)) {
    if (!sym) continue
    let p = null
    if (Array.isArray(val)) p = toFiniteNumber(val[0])
    else p = toFiniteNumber(val)
    if (p !== null && p > 0) map[String(sym).toUpperCase()] = p
  }
  return map
}

function buildPriceIndexByUniqueIdFromAssets(assets, fallbackPriceMap) {
  const out = {}
  if (!Array.isArray(assets)) return out
  for (const a of assets) {
    const fromAsset = toFiniteNumber(a?.price)
    const sym = String(a?.symbol || '').trim().toUpperCase()
    const p = (fromAsset !== null && fromAsset > 0) ? fromAsset : (fallbackPriceMap[sym] ?? null)
    if (p === null || p <= 0) continue

    const uid = String(a?.token_unique_id || a?.unique_id || '').trim().toUpperCase()
    const net = String(a?.network || '').trim().toUpperCase()
    if (uid) {
      out[uid] = p
      if (net) out[`${net}:${uid}`] = p
    }
    if (sym && net) out[`${net}:${sym}`] = p
  }
  return out
}

function planckToNumber(balance, decimals) {
  try {
    const dec = Math.max(0, Math.min(18, Number(decimals || 0)))
    const n = BigInt(String(balance || '0'))
    return Number(n) / 10 ** dec
  } catch {
    return 0
  }
}

function calcWalletUsdFromAssets(assets, fallbackPriceMap) {
  if (!Array.isArray(assets)) return null
  let sum = 0
  for (const a of assets) {
    const sym = String(a?.symbol || '').toUpperCase()
    const fromAsset = toFiniteNumber(a?.price)
    const p = (fromAsset !== null && fromAsset > 0) ? fromAsset : (fallbackPriceMap[sym] ?? null)
    if (p === null || p <= 0) continue
    const qty = planckToNumber(a?.balance, a?.decimal)
    if (!Number.isFinite(qty) || qty <= 0) continue
    sum += qty * p
  }
  return sum > 0 ? sum : null
}

async function fetchPortfolioNextData(address, redis) {
  const url = `https://portfolio.subscan.io/account/${encodeURIComponent(String(address || '').trim())}`
  const cacheKey = `subscan_portfolio_next:${url}`
  if (redis?.isReady) {
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) {
      try {
        return JSON.parse(cached)
      } catch {
        /* ignore invalid cache */
      }
    }
  }

  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const html = await res.text()
    const next = extractNextDataJson(html)
    if (!next?.props?.pageProps) return null
    const pp = next.props.pageProps
    const priceMap = buildPriceMapFromNextData(pp.price)
    const uniqueIdPriceIndex = buildPriceIndexByUniqueIdFromAssets(pp.account?.assets, priceMap)
    const walletUsd = calcWalletUsdFromAssets(pp.account?.assets, priceMap)
    const out = {
      token_usd_prices: priceMap,
      token_usd_price_by_unique_id: uniqueIdPriceIndex,
      portfolio_assets: Array.isArray(pp.account?.assets) ? pp.account.assets : [],
      portfolio_value: walletUsd !== null ? {
        total_value: walletUsd,
        wallet_value: walletUsd,
        defi_value: null,
        transferable_value: null,
        source_path: 'portfolio.subscan.io::__NEXT_DATA__'
      } : null
    }
    if (redis?.isReady) {
      redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(out)).catch(() => {})
    }
    return out
  } catch {
    return null
  }
}

/** 統一解析 Subscan 各版本 value 回傳欄位 */
function normalizePortfolioValue(raw) {
  const data = raw?.data ?? raw
  if (!data || typeof data !== 'object') return null

  const wallet = pickFirstNumber(data, ['wallet_value', 'walletValue', 'wallet', 'wallet_usd'])
  const defi = pickFirstNumber(data, ['defi_value', 'defiValue', 'defi', 'defi_usd'])
  const transferable = pickFirstNumber(data, ['transferable_value', 'transferableValue', 'transferable', 'transferable_usd'])
  let total = pickFirstNumber(data, ['total_value', 'totalValue', 'total', 'value', 'portfolio_value'])

  if (total === null) {
    const sum = [wallet, defi, transferable].filter(v => v !== null).reduce((a, b) => a + b, 0)
    total = sum > 0 ? sum : null
  }

  if (wallet === null && defi === null && transferable === null && total === null) return null
  return {
    wallet_value: wallet,
    defi_value: defi,
    transferable_value: transferable,
    total_value: total
  }
}

/** 嘗試多個可能 endpoint，拿到目前地址總價值（USD） */
async function fetchPortfolioValueStats(network, address, redis) {
  const base = SUBSCAN[network]
  if (!base) return { value: null, debug: { attempts: [] } }

  const candidates = [
    '/api/scan/multiChain/account_balance_value_stat',
    '/api/scan/multichain/account_balance_value_stat',
    '/api/scan/account/balance_value_stat',
    '/api/scan/account/balance_stat',
    '/api/scan/multiChain/account',
    '/api/scan/multichain/account'
  ]

  const attempts = []
  for (const path of candidates) {
    const tried = await subscanPostAttempt(base, path, { address }, redis)
    if (!tried.ok) {
      attempts.push({ path, ok: false, reason: tried.error })
      continue
    }
    const res = tried.data
    if (!res || res.code !== 0) {
      attempts.push({ path, ok: false, reason: res?.message || 'code != 0' })
      continue
    }
    const parsed = normalizePortfolioValue(res.data)
    if (!parsed) {
      attempts.push({ path, ok: false, reason: 'no value fields in response' })
      continue
    }
    attempts.push({ path, ok: true })
    return {
      value: { ...parsed, source_path: path },
      debug: { attempts }
    }
  }
  return { value: null, debug: { attempts } }
}

function extractUsdPrice(raw) {
  const data = raw?.data ?? raw
  if (data == null) return null
  if (typeof data === 'number') return Number.isFinite(data) ? data : null
  if (typeof data === 'string') {
    const n = Number(data)
    return Number.isFinite(n) ? n : null
  }
  if (typeof data === 'object') {
    return pickFirstNumber(data, ['price', 'usd', 'usd_price', 'price_usd', 'current_price'])
  }
  return null
}

/** 依 token symbol 嘗試多個價格端點，回傳 USD map 與診斷資訊 */
async function fetchTokenUsdPriceMap(network, symbols, redis) {
  const base = SUBSCAN[network]
  if (!base || !Array.isArray(symbols) || symbols.length === 0) {
    return { prices: {}, debug: { attempts: [], resolved: 0, total: 0 } }
  }

  const uniq = Array.from(new Set(symbols.map(s => String(s || '').trim().toUpperCase()).filter(Boolean))).slice(0, 80)
  const candidates = [
    { path: '/api/scan/currency/price', body: s => ({ currency: s }) },
    { path: '/api/scan/currency/price', body: s => ({ symbol: s }) },
    { path: '/api/scan/token/price', body: s => ({ token: s }) },
    { path: '/api/scan/token/price', body: s => ({ unique_id: s }) },
    { path: '/api/scan/multiChain/price', body: s => ({ symbol: s }) },
    { path: '/api/scan/multichain/price', body: s => ({ symbol: s }) }
  ]

  const prices = {}
  const attempts = []
  for (const symbol of uniq) {
    let ok = false
    for (const c of candidates) {
      const body = c.body(symbol)
      const tried = await subscanPostAttempt(base, c.path, body, redis)
      if (!tried.ok) {
        attempts.push({ symbol, path: c.path, ok: false, reason: tried.error })
        continue
      }
      const res = tried.data
      if (!res || res.code !== 0) {
        attempts.push({ symbol, path: c.path, ok: false, reason: res?.message || 'code != 0' })
        continue
      }
      const p = extractUsdPrice(res.data)
      if (p === null || p <= 0) {
        attempts.push({ symbol, path: c.path, ok: false, reason: 'no usd price field' })
        continue
      }
      prices[symbol] = p
      attempts.push({ symbol, path: c.path, ok: true })
      ok = true
      break
    }
    if (!ok) {
      // keep trying next symbol
    }
  }

  return {
    prices,
    debug: {
      attempts,
      resolved: Object.keys(prices).length,
      total: uniq.length
    }
  }
}

/** Sum amount fields from /api/scan/staking/unbonding data (object of arrays). */
function sumUnbondingPlanck(data) {
  if (!data || typeof data !== 'object') return '0'
  let sum = 0n
  for (const list of Object.values(data)) {
    if (!Array.isArray(list)) continue
    for (const u of list) {
      try {
        sum += BigInt(u?.amount || '0')
      } catch {
        /* skip */
      }
    }
  }
  return sum.toString()
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

subscanRouter.post('/:network/account', async (req, res) => {
  const { network } = req.params
  const redis = req.app.locals.redis
  const address = req.body?.address
  if (!address) return res.status(400).json({ error: 'address is required' })

  const sym = network === 'kusama' ? 'KSM' : 'DOT'

  try {
    const search = await subscanPost(network, '/api/v2/scan/search', { key: address }, redis)
    if (search.code !== 0) return res.status(400).json({ error: search.message || 'API error' })

    const account = search.data?.account
    if (!account) return res.status(400).json({ error: 'Account not found' })

    const relayTokens = await subscanPost(network, '/api/scan/account/tokens', { address }, redis)
    const relayNative = relayTokens.code === 0 ? pickNative(relayTokens.data?.native, sym) : null

    let assethubNative = null
    /** 第一筆成功的 Asset Hub tokens（含 builtin／assets 等，供 Portfolio 統計） */
    let assethubTokensFull = null
    const extras = SUBSCAN_EXTRA[network] || []
    for (const host of extras) {
      const tok = await subscanPostOptional(host, '/api/scan/account/tokens', { address }, redis)
      if (!tok || tok.code !== 0) continue
      if (!assethubTokensFull) assethubTokensFull = tok.data
      const n = pickNative(tok.data?.native, sym)
      if (n && !assethubNative) assethubNative = n
    }

    const balanceRelay = relayNative?.balance ?? account.balance ?? '0'
    const balanceAssethub = assethubNative?.balance ?? '0'
    const lockRelay = relayNative?.lock ?? account.lock ?? '0'
    const lockAssethub = assethubNative?.lock ?? '0'
    const reservedRelay = relayNative?.reserved ?? account.reserved ?? '0'
    const reservedAssethub = assethubNative?.reserved ?? '0'
    const bondedRelayTokens = relayNative?.bonded ?? account.bonded ?? '0'
    const bondedAssethub = assethubNative?.bonded ?? '0'
    const unbondingRelayTokens = relayNative?.unbonding ?? account.unbonding ?? '0'
    const unbondingAssethub = assethubNative?.unbonding ?? '0'

    const relayBase = SUBSCAN[network]
    const stakingNom = await subscanPostOptional(relayBase, '/api/scan/staking/nominator', { address }, redis)
    const bondedNominator =
      stakingNom?.code === 0 && stakingNom?.data?.bonded != null && String(stakingNom.data.bonded) !== ''
        ? String(stakingNom.data.bonded)
        : '0'
    const poolMember = await subscanPostOptional(
      relayBase,
      '/api/scan/nomination_pool/pool/member/vote',
      { address },
      redis
    )
    const bondedPool =
      poolMember?.code === 0 && poolMember?.data?.bonded != null && String(poolMember.data.bonded) !== ''
        ? String(poolMember.data.bonded)
        : '0'
    const bondedRelay = maxPlanck(maxPlanck(bondedRelayTokens, bondedNominator), bondedPool)

    const unbondingList = await subscanPostOptional(relayBase, '/api/scan/staking/unbonding', { address }, redis)
    const unbondingFromList =
      unbondingList?.code === 0 ? sumUnbondingPlanck(unbondingList.data) : '0'
    const unbondingRelay = maxPlanck(unbondingRelayTokens, unbondingFromList)

    const tokens_parachains = await fetchPortfolioParachainTokens(network, address, redis)
    const portfolioValueRes = await fetchPortfolioValueStats(network, address, redis)
    const allSymbols = collectAllTokenSymbols(relayTokens.data, assethubTokensFull, tokens_parachains)
    const tokenPriceRes = await fetchTokenUsdPriceMap(network, allSymbols, redis)
    const portfolioNext = await fetchPortfolioNextData(address, redis)

    const mergedTokenPrices = {
      ...(tokenPriceRes.prices || {}),
      ...(portfolioNext?.token_usd_prices || {})
    }
    const mergedUniqueIdPrices = {
      ...(portfolioNext?.token_usd_price_by_unique_id || {})
    }

    const finalPortfolioValue = portfolioValueRes.value || portfolioNext?.portfolio_value || null
    const finalPortfolioDebug = {
      ...(portfolioValueRes.debug || { attempts: [] }),
      fallback_next_data: Boolean(!portfolioValueRes.value && portfolioNext?.portfolio_value)
    }

    const merged = {
      ...account,
      balance_total: addPlanck(balanceRelay, balanceAssethub),
      balance_relay: balanceRelay,
      balance_assethub: balanceAssethub,
      /** lock + reserved（更接近 Subscan「鎖定/保留」資訊拆分後的加總） */
      lock_total: addPlanck(addPlanck(lockRelay, lockAssethub), addPlanck(reservedRelay, reservedAssethub)),
      lock_only_total: addPlanck(lockRelay, lockAssethub),
      reserved_total: addPlanck(reservedRelay, reservedAssethub),
      lock_relay: lockRelay,
      lock_assethub: lockAssethub,
      reserved_relay: reservedRelay,
      reserved_assethub: reservedAssethub,
      bonded_total: addPlanck(bondedRelay, bondedAssethub),
      bonded_relay: bondedRelay,
      bonded_assethub: bondedAssethub,
      bonded_tokens_relay: bondedRelayTokens,
      bonded_nominator_relay: bondedNominator,
      bonded_pool_relay: bondedPool,
      /** search 回傳的 bonded 常為 0（餘額在 AH 等），覆寫以免前端誤用 */
      bonded: addPlanck(bondedRelay, bondedAssethub),
      unbonding: addPlanck(unbondingRelay, unbondingAssethub),
      unbonding_total: addPlanck(unbondingRelay, unbondingAssethub),
      unbonding_relay: unbondingRelay,
      unbonding_assethub: unbondingAssethub,
      tokens_relay: relayTokens.code === 0 ? relayTokens.data : null,
      tokens_assethub: assethubNative ? { native: [assethubNative] } : null,
      tokens_assethub_full: assethubTokensFull || null,
      portfolio_stats: {
        relay: relayTokens.code === 0 ? tokenBucketCounts(relayTokens.data) : null,
        assethub: tokenBucketCounts(assethubTokensFull)
      },
      portfolio_value: finalPortfolioValue,
      portfolio_value_debug: finalPortfolioDebug,
      token_usd_prices: mergedTokenPrices,
      token_usd_price_by_unique_id: mergedUniqueIdPrices,
      portfolio_assets: portfolioNext?.portfolio_assets || [],
      token_price_debug: tokenPriceRes.debug,
      /** 官方 live 網路 account/tokens（略過已在 Relay／Asset Hub 請求過之站台；僅含餘額 > 0 者） */
      tokens_parachains
    }

    res.json({ account: merged })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/** Subscan Search 補充分類（與前端轉帳／XCM 啟發式合併使用） */
function classifySubscanAccount(acc) {
  const ag = String(acc?.assets_tag ?? '').toLowerCase()
  if (/exchange|custody|kraken|binance|coinbase|okx|gateio|huobi|bitfinex|crypto\.com/i.test(ag))
    return 'exchange'
  const extra = JSON.stringify(acc?.extra ?? '')
  if (/exchange|custody|deposit/i.test(extra)) return 'exchange'
  return null
}

subscanRouter.post('/:network/account-tags', async (req, res) => {
  const { network } = req.params
  const redis = req.app.locals.redis
  const addresses = req.body?.addresses
  if (!Array.isArray(addresses)) return res.status(400).json({ error: 'addresses array required' })

  const slice = addresses.filter(Boolean).slice(0, 40)
  const labels = {}

  const chunkSize = 8
  for (let i = 0; i < slice.length; i += chunkSize) {
    const chunk = slice.slice(i, i + chunkSize)
    await Promise.all(
      chunk.map(async addr => {
        try {
          const search = await subscanPost(network, '/api/v2/scan/search', { key: addr }, redis)
          if (search.code !== 0 || !search.data?.account) {
            labels[addr] = { tag: 'general' }
            return
          }
          const acc = search.data.account
          const fromSearch = classifySubscanAccount(acc)
          labels[addr] = {
            tag: fromSearch || 'general',
            assets_tag: acc.assets_tag ?? null,
            role: acc.role ?? null
          }
        } catch {
          labels[addr] = { tag: 'general' }
        }
      })
    )
  }

  res.json({ labels })
})

subscanRouter.post('/:network/transfers', async (req, res) => {
  const { network } = req.params
  const redis = req.app.locals.redis
  const row = req.body?.row || 20
  const page = req.body?.page || 0
  const address = req.body?.address
  if (!address) return res.status(400).json({ error: 'address is required' })

  try {
    const bases = [SUBSCAN[network], ...(SUBSCAN_EXTRA[network] || [])].filter(Boolean)
    const results = await Promise.allSettled(
      bases.map(base => subscanPostRaw(base, '/api/v2/scan/transfers', { address, row, page }, redis, `subscan:${network}:${base}`))
    )

    let transfers = []
    let maxCount = 0
    for (let idx = 0; idx < results.length; idx++) {
      const r = results[idx]
      if (r.status !== 'fulfilled') continue
      const data = r.value
      if (data.code !== 0) continue
      const list = data.data?.transfers || []
      const explorerOrigin = apiHostToExplorerOrigin(bases[idx])
      for (const tx of list) {
        transfers.push({
          ...tx,
          subscan_explorer_origin: explorerOrigin
        })
      }
      const c = data.data?.count
      if (typeof c === 'number' && c > maxCount) maxCount = c
    }

    const seen = new Set()
    transfers = transfers.filter(tx => {
      const id = `${tx.block_num}:${tx.extrinsic_index}:${tx.event_idx}:${tx.transfer_id}:${tx.hash}`
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })

    transfers.sort((a, b) => {
      const ba = Number(b.block_num || 0)
      const aa = Number(a.block_num || 0)
      if (ba !== aa) return ba - aa
      return String(b.extrinsic_index || '').localeCompare(String(a.extrinsic_index || ''))
    })

    transfers = transfers.slice(0, row)

    res.json({ transfers, count: maxCount || transfers.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

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
