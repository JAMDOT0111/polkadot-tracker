import { useState, useEffect, useMemo } from 'react'
import { useTracker } from './hooks/useTracker'

const NETWORKS = ['polkadot', 'kusama']
const DEC = { polkadot: 10, kusama: 12 }
const SYM = { polkadot: 'DOT', kusama: 'KSM' }
const WATCHLIST_KEY = 'polkadot-tracker-watchlist'

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(x => x?.address && x?.network) : []
  } catch {
    return []
  }
}

/** Subscan 交易詳情（依 API 來源區分 Relay / Asset Hub 網域） */
function extrinsicExplorerUrl(tx, network) {
  const idx = tx?.extrinsic_index
  if (!idx) return null
  const origin =
    tx?.subscan_explorer_origin ||
    (network === 'kusama' ? 'https://kusama.subscan.io' : 'https://polkadot.subscan.io')
  return `${String(origin).replace(/\/$/, '')}/extrinsic/${encodeURIComponent(String(idx))}`
}

function TransferRowShell({ extrinsicUrl, children }) {
  const open = (e) => {
    if (!extrinsicUrl) return
    if (e.target.closest?.('button')) return
    window.open(extrinsicUrl, '_blank', 'noopener,noreferrer')
  }
  return (
    <div
      role={extrinsicUrl ? 'link' : undefined}
      tabIndex={extrinsicUrl ? 0 : undefined}
      onClick={open}
      onKeyDown={(e) => {
        if (!extrinsicUrl || e.target.closest?.('button')) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          window.open(extrinsicUrl, '_blank', 'noopener,noreferrer')
        }
      }}
      style={{ outline: 'none' }}
    >
      {children}
    </div>
  )
}

function CopyableAddr({ address, copiedKey, setCopiedKey, copyId, children, style: st }) {
  const done = copiedKey === copyId
  return (
    <button type="button"
      onClick={async (e) => {
        e.preventDefault()
        e.stopPropagation()
        try {
          await navigator.clipboard.writeText(address)
          setCopiedKey(copyId)
          setTimeout(() => setCopiedKey(null), 1200)
        } catch {
          /* ignore */
        }
      }}
      title={`複製地址：${address}`}
      style={{
        fontFamily: 'monospace', fontSize: 11, background: 'none', border: 'none',
        cursor: 'pointer', color: '#1565c0', textDecoration: 'underline dotted',
        padding: 0, maxWidth: '100%', ...st
      }}>
      {children ?? short(address)}
      {done && <span style={{ marginLeft: 4, fontSize: 9, color: '#2e7d32' }}>已複製</span>}
    </button>
  )
}

function fmt(planck, dec) {
  try {
    let n = BigInt(planck ?? '0')
    const neg = n < 0n
    if (neg) n = -n
    const scale = 10n ** BigInt(dec)
    const hi = n / scale
    const lo = n % scale
    const frac = String(lo).padStart(dec, '0').slice(0, 4).padEnd(4, '0')
    return `${neg ? '-' : ''}${hi}.${frac}`
  } catch {
    return '0.0000'
  }
}

function withThousands(s) {
  const txt = String(s ?? '')
  const neg = txt.startsWith('-')
  const raw = neg ? txt.slice(1) : txt
  const [i, f] = raw.split('.')
  const ii = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? '-' : ''}${ii}${f !== undefined ? `.${f}` : ''}`
}

function fmtTokenBalance(planck, dec) {
  return withThousands(fmt(planck, dec))
}

function planckToFloat(planck, dec) {
  try {
    let n = BigInt(planck ?? '0')
    const neg = n < 0n
    if (neg) n = -n
    const scale = 10n ** BigInt(dec)
    const hi = n / scale
    const lo = n % scale
    const composed = Number(`${hi.toString()}.${String(lo).padStart(dec, '0').slice(0, 8)}`)
    return neg ? -composed : composed
  } catch {
    return 0
  }
}

function decimalsForSymbol(sym) {
  const s = (sym || '').toUpperCase()
  if (s === 'DOT' || s === 'KSM') return null
  if (s.includes('USD') || s === 'USDT' || s === 'USDt') return 6
  return null
}

function fmtTransfer(tx, fallbackDec) {
  const hist = tx?.historical_currency_amount ?? tx?.current_currency_amount ?? tx?.currency_amount
  if (hist !== undefined && hist !== null && hist !== '') {
    const n = Number(hist)
    if (!Number.isNaN(n)) return n.toFixed(4)
  }

  const amtStr = tx?.amount
  if (typeof amtStr === 'string' && amtStr.includes('.') && !/[eE]/.test(amtStr)) {
    const n = Number(amtStr)
    if (!Number.isNaN(n)) return n.toFixed(4)
  }

  const symDec = decimalsForSymbol(tx?.asset_symbol)
  const dec = symDec ?? fallbackDec

  const raw = tx?.amount_v2 ?? amtStr ?? '0'
  try {
    const planck = BigInt(raw === '' ? '0' : raw).toString()
    return fmt(planck, dec)
  } catch {
    return '0.0000'
  }
}

function fmtFee(tx, fallbackDec) {
  const raw = tx?.fee ?? '0'
  try {
    const planck = BigInt(raw === '' ? '0' : raw).toString()
    const feeDec = tx?.module === 'assets' ? (decimalsForSymbol(tx?.asset_symbol) ?? fallbackDec) : fallbackDec
    return fmt(planck, feeDec)
  } catch {
    return fmt('0', fallbackDec)
  }
}
function short(a) { return a ? a.slice(0, 8) + '...' + a.slice(-5) : '—' }

/** Subscan 跨鏈 Portfolio 帳戶頁（與官網相同 SS58） */
function subscanPortfolioAccountUrl(address) {
  const a = String(address || '').trim()
  if (!a) return null
  return `https://portfolio.subscan.io/account/${encodeURIComponent(a)}`
}

/** Subscan 官網同款：para:2034 (Hydration)、Pool#6(Stash) 常在 display／people.display；交易所多在 merkle */
function isSubscanSpecialLabel(text) {
  if (!text || typeof text !== 'string') return false
  const t = text.trim()
  if (/^Pool#\d+/i.test(t)) return true
  if (/^para\s*:/i.test(t)) return true
  return false
}

function transferPeerTag(display) {
  if (!display || typeof display !== 'object') return null

  const top = typeof display.display === 'string' ? display.display.trim() : ''
  if (isSubscanSpecialLabel(top)) return top

  const peopleLine = typeof display.people?.display === 'string' ? display.people.display.trim() : ''
  if (isSubscanSpecialLabel(peopleLine)) return peopleLine

  const m = display.merkle
  if (m && typeof m === 'object') {
    const pid = m.para_id ?? m.parachain_id ?? m.paraID
    if (pid !== undefined && pid !== null && String(pid) !== '') {
      const nm =
        m.chain_name ??
        m.network_name ??
        m.parachain_name ??
        m.parachain ??
        m.chain ??
        ''
      const clean = String(nm).trim()
      return clean ? `para:${pid} (${clean})` : `para:${pid}`
    }
    const tt = String(m.tag_type || '')
    const name = m.tag_name ? String(m.tag_name).trim() : ''
    if (/exchange/i.test(tt) && name) return `交易所 · ${name}`
    if (name) return name
  }
  return null
}

function transferTagPalette(tag) {
  if (!tag) return { background: '#f5f5f5', color: '#666' }
  const s = String(tag)
  if (/^para\s*:/i.test(s)) return { background: '#E8F5E9', color: '#2E7D32' }
  if (/^Pool#/i.test(s)) return { background: '#E3F2FD', color: '#1565C0' }
  if (/^交易所/.test(s)) return { background: '#FFF3E0', color: '#E65100' }
  return { background: '#FFF8E1', color: '#F57F17' }
}

function relTime(ts) {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - ts)
  if (d < 60) return d + '秒前'
  if (d < 3600) return Math.floor(d / 60) + '分鐘前'
  if (d < 86400) return Math.floor(d / 3600) + '小時前'
  const days = Math.floor(d / 86400)
  const hours = Math.floor((d % 86400) / 3600)
  return `${days}天${hours}小時前`
}

function isXcmTx(tx) {
  const blob = `${tx.call_module ?? ''} ${tx.module ?? ''} ${tx.extrinsic_call_module ?? ''} ${tx.category ?? ''}`.toLowerCase()
  return /\bxcm\b|polkadotxcm|parachain|bridge/i.test(blob)
}

/** 幕前查詢地址：主類別（交易所／跨鏈／一般）＋ Relay 身分補充 */
function classifyViewerAddress(acc, transfers, viewerAddr) {
  const primary = []
  const extra = []
  if (!viewerAddr || !acc) return { primary, extra }

  const ag = String(acc.assets_tag ?? '').trim()
  const exchangeHit =
    /exchange|custody|kraken|binance|coinbase|okx|gateio|huobi|bitfinex|crypto\.com/i.test(ag)

  let xcmN = 0
  let n = 0
  for (const tx of transfers) {
    if (tx.from !== viewerAddr && tx.to !== viewerAddr) continue
    n++
    if (isXcmTx(tx)) xcmN++
  }
  const xcmHeavy = n > 0 && xcmN / n >= 0.25

  if (exchangeHit) primary.push({ key: 'ex', label: '交易所', hint: ag })
  else if (xcmHeavy) primary.push({ key: 'xcm', label: '跨鏈' })
  else primary.push({ key: 'gen', label: '一般地址' })

  const role = String(acc.role ?? '').toLowerCase()
  if (role.includes('nominator')) extra.push({ key: 'nom', label: '提名人' })
  if (role.includes('validator')) extra.push({ key: 'val', label: '驗證者' })
  try {
    const bp = BigInt(String(acc.bonded_pool_relay ?? '0'))
    if (bp > 0n) extra.push({ key: 'pool', label: '提名池' })
  } catch {
    /* ignore */
  }

  return { primary, extra }
}

function viewerPrimaryBadgeStyle(key) {
  if (key === 'ex') return { background: '#FFF3E0', color: '#E65100' }
  if (key === 'xcm') return { background: '#E3F2FD', color: '#1565C0' }
  return { background: '#f0f0f0', color: '#555' }
}

function viewerExtraBadgeStyle(key) {
  if (key === 'pool') return { background: '#E1F5FE', color: '#0277BD' }
  return { background: '#F3E5F5', color: '#6A1B9A' }
}

/** 用於排序「Value」：優先使用 Subscan 若回傳之法幣／估價欄位，否則以餘額換算後比較 */
function normalizeKey(s) {
  return String(s ?? '').trim().toUpperCase()
}

function tokenSortMetric(token, decimals, priceMap, uniqueIdPriceMap, chainLabel) {
  const fiatKeys = [
    'balance_value',
    'balance_usd',
    'usd_value',
    'quote_usd',
    'historical_currency_amount',
    'currency_amount',
    'current_currency_amount'
  ]
  for (const k of fiatKeys) {
    const v = token[k]
    if (v !== undefined && v !== null && v !== '') {
      const n = Number(v)
      if (!Number.isNaN(n) && n >= 0) return { type: 'fiat', value: n }
    }
  }
  const symbolKey = normalizeKey(token?.symbol)
  const uidKey = normalizeKey(token?.unique_id ?? token?.token_unique_id)
  const chainKey = normalizeKey(chainLabel)
  const pxByUid = Number(
    (uidKey && uniqueIdPriceMap?.[uidKey]) ??
    (uidKey && chainKey && uniqueIdPriceMap?.[`${chainKey}:${uidKey}`]) ??
    (symbolKey && chainKey && uniqueIdPriceMap?.[`${chainKey}:${symbolKey}`]) ??
    NaN
  )
  const pxBySym = symbolKey ? Number(priceMap?.[symbolKey]) : NaN
  const px = Number.isFinite(pxByUid) && pxByUid > 0 ? pxByUid : pxBySym
  if (Number.isFinite(px) && px > 0) {
    const qty = planckToFloat(String(token?.balance ?? '0'), Math.min(30, Math.max(0, decimals)))
    return { type: 'fiat', value: qty * px, price: px }
  }
  const dec = Math.min(30, Math.max(0, decimals))
  try {
    const bal = BigInt(String(token?.balance ?? '0'))
    const d = Math.min(dec, 18)
    const scaled = Number(bal) / 10 ** d
    return { type: 'amount', value: scaled, price: null }
  } catch {
    return { type: 'amount', value: 0, price: null }
  }
}

function flattenAccountTokens(raw, chainLabel, nativeFallbackDec, priceMap, uniqueIdPriceMap) {
  if (!raw || typeof raw !== 'object') return []
  const out = []
  const groups = [
    ['本幣', raw.native],
    ['內建', raw.builtin],
    ['資產', raw.assets],
    ['ERC-20', raw.ERC20]
  ]
  for (const [catLabel, arr] of groups) {
    if (!Array.isArray(arr)) continue
    for (const token of arr) {
      const symbol =
        String(token?.symbol ?? '').trim() ||
        String(token?.unique_id ?? '').trim() ||
        '—'
      const di = parseInt(token?.decimals, 10)
      const dec = Number.isFinite(di) ? di : catLabel === '本幣' ? nativeFallbackDec : 10
      const metric = tokenSortMetric(token, dec, priceMap, uniqueIdPriceMap, chainLabel)
      const planck = String(token?.balance ?? '0')
      out.push({
        symbol,
        chainLabel,
        category: catLabel,
        decimals: dec,
        balancePlanck: planck,
        sortValue: metric.value,
        sortType: metric.type,
        priceUsd: metric.price ?? null,
        fiatAmount: metric.type === 'fiat' ? metric.value : null
      })
    }
  }
  return out
}

function fromPortfolioCategory(cat) {
  const c = String(cat || '').toLowerCase()
  if (c === 'native') return '本幣'
  if (c === 'builtin') return '內建'
  if (c === 'erc20') return 'ERC-20'
  return '資產'
}

function flattenPortfolioAssets(assets) {
  if (!Array.isArray(assets)) return []
  const out = []
  for (const a of assets) {
    const symbol = String(a?.symbol ?? a?.token_unique_id ?? '').trim()
    if (!symbol) continue
    const dec = Number.isFinite(Number(a?.decimal)) ? Number(a.decimal) : 10
    const bal = String(a?.balance ?? '0')
    const price = Number(a?.price)
    const qty = planckToFloat(bal, Math.min(30, Math.max(0, dec)))
    const hasPrice = Number.isFinite(price) && price > 0
    const fiat = hasPrice ? qty * price : null
    out.push({
      symbol,
      chainLabel: String(a?.network ?? 'unknown'),
      category: fromPortfolioCategory(a?.category),
      decimals: dec,
      balancePlanck: bal,
      sortValue: hasPrice ? fiat : qty,
      sortType: hasPrice ? 'fiat' : 'amount',
      priceUsd: hasPrice ? price : null,
      fiatAmount: hasPrice ? fiat : null
    })
  }
  return out
}

const PORTFOLIO_SLICE_COLORS = [
  '#1565C0', '#9CCC65', '#FDD835', '#FB8C00', '#4FC3F7',
  '#26A69A', '#FF7043', '#AB47BC', '#EC407A', '#AED581',
  '#90A4AE'
]

function portfolioConicGradient(slices) {
  let start = 0
  const parts = []
  for (const s of slices) {
    const end = Math.min(100, start + s.pct)
    parts.push(`${s.color} ${start}% ${end}%`)
    start = end
  }
  return parts.length ? `conic-gradient(${parts.join(', ')})` : '#eee'
}

function categoryLabelZh(cat) {
  const m = { 本幣: '本幣', 內建: '內建', 資產: '資產', 'ERC-20': 'ERC-20' }
  return m[cat] || cat
}

/** Portfolio 分佈：依 Value 前 10 + Others（與下方 Wallet 排序一致） */
function PortfolioDistribution({ rows }) {
  const totalMetric = rows.reduce((s, r) => s + r.sortValue, 0)
  const top10 = rows.slice(0, 10)
  const rest = rows.slice(10)
  const othersMetric = rest.reduce((s, r) => s + r.sortValue, 0)

  if (rows.length === 0) {
    return (
      <div style={{ padding: '16px 12px', background: '#fafafa', borderRadius: 8, border: '1px solid #eee', fontSize: 13, color: '#888' }}>
        無代幣餘額資料（Subscan account/tokens）
      </div>
    )
  }

  const slices = []
  top10.forEach((r, i) => {
    const pct = totalMetric > 0 ? (r.sortValue / totalMetric) * 100 : 0
    slices.push({ color: PORTFOLIO_SLICE_COLORS[i % PORTFOLIO_SLICE_COLORS.length], pct })
  })
  if (rest.length > 0 && othersMetric > 0) {
    const pct = totalMetric > 0 ? (othersMetric / totalMetric) * 100 : 0
    slices.push({ color: '#B0BEC5', pct })
  }

  const legendItems = top10.map((r, i) => ({
    color: PORTFOLIO_SLICE_COLORS[i % PORTFOLIO_SLICE_COLORS.length],
    label: `${r.symbol}（${r.chainLabel}）`,
    pct: totalMetric > 0 ? (r.sortValue / totalMetric) * 100 : 0
  }))
  if (rest.length > 0 && othersMetric > 0) {
    legendItems.push({
      color: '#B0BEC5',
      label: `Others（其餘 ${rest.length} 筆）`,
      pct: totalMetric > 0 ? (othersMetric / totalMetric) * 100 : 0
    })
  }

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 16,
      alignItems: 'flex-start',
      padding: '14px 14px',
      background: '#fafafa',
      borderRadius: 8,
      border: '1px solid #eee'
    }}>
      <div
        aria-hidden
        style={{
          width: 132,
          height: 132,
          borderRadius: '50%',
          flexShrink: 0,
          background: portfolioConicGradient(slices),
          boxShadow: 'inset 0 0 0 12px #fff'
        }}
      />
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>Distribution（依 Value 比重）</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {legendItems.map((item, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0, background: item.color }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.label}
              </span>
              <span style={{ color: '#888', flexShrink: 0 }}>{item.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function fmtUsd(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

/** Wallet：僅顯示 Value 排名前 10 大之代幣 */
function WalletTokenTable({ rows, hasFiatQuote }) {
  const top = rows.slice(0, 10)
  if (top.length === 0) {
    return <p style={{ color: '#888', fontSize: 13 }}>無代幣可列示</p>
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #eee', color: '#888', textAlign: 'left' }}>
            <th style={{ padding: '8px 6px', fontWeight: 600 }}>#</th>
            <th style={{ padding: '8px 6px', fontWeight: 600 }}>代幣</th>
            <th style={{ padding: '8px 6px', fontWeight: 600 }}>鏈</th>
            <th style={{ padding: '8px 6px', fontWeight: 600 }}>類別</th>
            <th style={{ padding: '8px 6px', fontWeight: 600 }}>餘額</th>
            <th style={{ padding: '8px 6px', fontWeight: 600 }}>Price</th>
            <th style={{ padding: '8px 6px', fontWeight: 600 }}>Value</th>
          </tr>
        </thead>
        <tbody>
          {top.map((r, i) => (
            <tr key={`${r.chainLabel}-${r.symbol}-${r.category}-${i}`} style={{ borderBottom: '1px solid #f5f5f5' }}>
              <td style={{ padding: '10px 6px', color: '#aaa' }}>{i + 1}</td>
              <td style={{ padding: '10px 6px', fontWeight: 600 }}>{r.symbol}</td>
              <td style={{ padding: '10px 6px', color: '#555' }}>{r.chainLabel}</td>
              <td style={{ padding: '10px 6px', color: '#666' }}>{categoryLabelZh(r.category)}</td>
              <td style={{ padding: '10px 6px', fontFamily: 'monospace' }}>
                {fmtTokenBalance(r.balancePlanck, r.decimals)}
              </td>
              <td style={{ padding: '10px 6px' }}>
                {r.priceUsd != null ? <span style={{ color: '#444' }}>{fmtUsd(r.priceUsd)}</span> : <span style={{ color: '#888' }}>—</span>}
              </td>
              <td style={{ padding: '10px 6px' }}>
                {r.sortType === 'fiat' && r.fiatAmount != null ? (
                  <span style={{ color: '#E6007A', fontWeight: 600 }}>{fmtUsd(r.fiatAmount)}</span>
                ) : (
                  <span style={{ color: '#888' }} title="無單筆法幣估價時，排序依餘額換算">
                    — <span style={{ fontSize: 10 }}>（餘額序）</span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 11, color: '#aaa', marginTop: 10, lineHeight: 1.45 }}>
        {hasFiatQuote
          ? 'Value 欄位優先顯示 Subscan 回傳之法幣估價（若有）。'
          : '目前 API 未提供各代幣法幣估價；Value 排序改以餘額換算後比較，表中標「餘額序」。'}
      </p>
    </div>
  )
}

export default function App() {
  const [input, setInput] = useState('')
  const [network, setNetwork] = useState('polkadot')
  const [tab, setTab] = useState('overview')
  const [walletTab, setWalletTab] = useState('token')
  const [watchlist, setWatchlist] = useState(loadWatchlist)
  const [copiedKey, setCopiedKey] = useState(null)
  const { loading, error, account, transfers, transfersCount, staking, related, lookup, address: viewerAddr } = useTracker()

  const dec = DEC[network]
  const sym = SYM[network]
  const acc = account?.account ?? account ?? {}
  const balancePlanck = acc.balance_total ?? acc.balance ?? '0'
  const lockPlanck = acc.lock_total ?? acc.lock ?? '0'

  const viewerClass = useMemo(
    () => classifyViewerAddress(acc, transfers, viewerAddr),
    [acc, transfers, viewerAddr]
  )

  const walletPortfolioRows = useMemo(() => {
    const portfolioAssetsRows = flattenPortfolioAssets(acc.portfolio_assets)
    if (portfolioAssetsRows.length > 0) {
      const picked = portfolioAssetsRows.filter(r => {
        try {
          return BigInt(r.balancePlanck || '0') > 0n
        } catch {
          return false
        }
      })
      picked.sort((a, b) => b.sortValue - a.sortValue)
      return picked
    }

    const priceMap = acc.token_usd_prices || {}
    const uniqueIdPriceMap = acc.token_usd_price_by_unique_id || {}
    const relay = flattenAccountTokens(acc.tokens_relay, 'Relay', dec, priceMap, uniqueIdPriceMap)
    const ah = flattenAccountTokens(acc.tokens_assethub_full, 'Asset Hub', dec, priceMap, uniqueIdPriceMap)
    const para = Array.isArray(acc.tokens_parachains)
      ? acc.tokens_parachains.flatMap(entry =>
          flattenAccountTokens(entry?.tokens, String(entry?.chain ?? '平行鏈'), dec, priceMap, uniqueIdPriceMap))
      : []
    const merged = [...relay, ...ah, ...para].filter(r => {
      try {
        return BigInt(r.balancePlanck || '0') > 0n
      } catch {
        return false
      }
    })
    merged.sort((a, b) => b.sortValue - a.sortValue)
    return merged
  }, [acc.tokens_relay, acc.tokens_assethub_full, acc.tokens_parachains, dec])

  const walletHasFiatQuote = useMemo(
    () => walletPortfolioRows.some(r => r.sortType === 'fiat'),
    [walletPortfolioRows]
  )

  const subscanPortfolioHref = useMemo(
    () => (viewerAddr ? subscanPortfolioAccountUrl(viewerAddr) : null),
    [viewerAddr]
  )

  const portfolioValue = acc.portfolio_value || null
  const portfolioValueDebug = acc.portfolio_value_debug || null
  const tokenPriceDebug = acc.token_price_debug || null
  const usingPortfolioNextData = portfolioValue?.source_path === 'portfolio.subscan.io::__NEXT_DATA__'

  useEffect(() => {
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist))
    } catch {
      /* ignore */
    }
  }, [watchlist])

  function handleLookup() { lookup(input.trim(), network) }

  function addToWatchlist() {
    const addr = input.trim()
    if (!addr) return
    const k = `${network}:${addr}`
    if (watchlist.some(w => `${w.network}:${w.address}` === k)) return
    setWatchlist([...watchlist, { address: addr, network }])
  }

  function removeWatch(entry) {
    setWatchlist(watchlist.filter(w => !(w.address === entry.address && w.network === entry.network)))
  }

  function openWatch(w) {
    setNetwork(w.network)
    setInput(w.address)
    lookup(w.address, w.network)
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>⬡ Polkadot 錢包追蹤器</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {NETWORKS.map(n => (
          <button key={n} onClick={() => {
            if (network === n) return
            setNetwork(n)
            const addr = input.trim()
            if (addr) lookup(addr, n)
          }}
            style={{ padding: '4px 14px', borderRadius: 20, border: '1px solid #ccc',
              background: network === n ? '#E6007A' : 'transparent',
              color: network === n ? '#fff' : '#555', cursor: 'pointer' }}>
            {n.charAt(0).toUpperCase() + n.slice(1)}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLookup()}
          placeholder="輸入地址..."
          style={{ flex: 1, minWidth: 200, padding: '8px 12px', border: '1px solid #ccc', borderRadius: 8, fontSize: 13 }} />
        <button type="button" onClick={handleLookup} disabled={loading}
          style={{ padding: '8px 18px', background: '#E6007A', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
          {loading ? '查詢中...' : '查詢'}
        </button>
        <button type="button" onClick={addToWatchlist} disabled={!input.trim()}
          title="將搜尋欄地址加入關注列表"
          style={{ padding: '8px 14px', background: '#fff', color: '#E6007A', border: '1px solid #E6007A', borderRadius: 8, cursor: input.trim() ? 'pointer' : 'not-allowed' }}>
          加入關注
        </button>
      </div>

      {watchlist.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>關注地址（點擊快速查詢）</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {watchlist.map(w => (
              <div key={`${w.network}:${w.address}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                  background: '#fafafa', border: '1px solid #eee', borderRadius: 20, fontSize: 11 }}>
                <button type="button" onClick={() => openWatch(w)}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'monospace', color: '#333', padding: 0 }}>
                  {short(w.address)} <span style={{ color: '#888' }}>({w.network})</span>
                </button>
                <CopyableAddr address={w.address} copiedKey={copiedKey} setCopiedKey={setCopiedKey}
                  copyId={`wl-${w.network}-${w.address}`}
                  style={{ fontSize: 10, color: '#1565c0' }}>複製</CopyableAddr>
                <button type="button" aria-label="移除關注" onClick={() => removeWatch(w)}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#999', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p style={{ color: 'red', fontSize: 13 }}>{error}</p>}

      {account && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, margin: '16px 0' }}>
            {[
              ['總餘額', fmt(balancePlanck || '0', dec), sym],
              ['鎖定+保留', fmt(lockPlanck || '0', dec), sym],
              ['轉帳筆數（估）', transfersCount, '筆（Relay+Asset Hub transfers）'],
            ].map(([label, val, sub]) => (
              <div key={label} style={{ background: '#f5f5f5', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#E6007A' }}>{val}</div>
                <div style={{ fontSize: 11, color: '#888' }}>{sub}</div>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 8
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>
                Portfolio（目前查詢地址）
              </div>
              {viewerAddr && subscanPortfolioHref && (
                <a
                  href={subscanPortfolioHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="於 Subscan 開啟此地址的 Portfolio"
                  style={{
                    fontSize: 12,
                    color: '#E6007A',
                    fontWeight: 600,
                    textDecoration: 'none',
                    borderBottom: '1px solid rgba(230, 0, 122, 0.5)'
                  }}
                >
                  開啟 Subscan Portfolio ↗
                </a>
              )}
            </div>
            {viewerAddr && (
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'baseline',
                gap: 8,
                marginBottom: 10,
                fontSize: 12,
                color: '#555'
              }}>
                <span style={{ color: '#888', flexShrink: 0 }}>查詢地址</span>
                <CopyableAddr
                  address={viewerAddr}
                  copiedKey={copiedKey}
                  setCopiedKey={setCopiedKey}
                  copyId="viewer-subscan-portfolio"
                  style={{ fontSize: 11, wordBreak: 'break-all', textAlign: 'left' }}
                >
                  {viewerAddr}
                </CopyableAddr>
              </div>
            )}
            <p style={{ fontSize: 11, color: '#888', margin: '0 0 10px', lineHeight: 1.45 }}>
              Relay、Asset Hub 與 Subscan 官方 <code style={{ fontSize: 10 }}>support.subscan.io</code> 所列 Status=live 之其餘網路（批次 <code style={{ fontSize: 10 }}>account/tokens</code>）合併後，依 Value 排序：優先使用 API 若提供之法幣／估價欄位，否則以餘額換算比較。
              {walletPortfolioRows.length > 0 && (
                <span>{' '}共 {walletPortfolioRows.length} 筆持有。</span>
              )}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(120px, 1fr))', gap: 8, marginBottom: 10 }}>
              {[
                ['Total Value', portfolioValue?.total_value],
                ['Wallet Value', portfolioValue?.wallet_value],
                ['DeFi Value', portfolioValue?.defi_value],
                ['Transferable', portfolioValue?.transferable_value]
              ].map(([k, v]) => (
                <div key={k} style={{ border: '1px solid #eee', borderRadius: 8, background: '#fafafa', padding: '8px 10px' }}>
                  <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>{k}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#E6007A' }}>{fmtUsd(v)}</div>
                </div>
              ))}
            </div>
            {!portfolioValue?.total_value && (
              <p style={{ fontSize: 11, color: '#aaa', margin: '0 0 10px' }}>
                尚未取得 Subscan Value API 資料（可能為 API key 權限或端點額度限制）。
              </p>
            )}
            {(portfolioValueDebug || tokenPriceDebug) && (
              <p style={{ fontSize: 11, color: '#9e9e9e', margin: '0 0 10px', lineHeight: 1.45 }}>
                {usingPortfolioNextData
                  ? 'Value/Price 來源：Subscan Portfolio（__NEXT_DATA__）'
                  : (
                    <>
                      {'Value API：'}
                      {portfolioValue?.source_path ? ` 命中 ${portfolioValue.source_path}` : ' 未命中'}
                      {portfolioValueDebug?.attempts?.find?.(x => !x.ok)?.reason
                        ? `；最近失敗：${portfolioValueDebug.attempts.find(x => !x.ok).reason}`
                        : ''}
                      {tokenPriceDebug
                        ? `；Price 解析 ${tokenPriceDebug.resolved || 0}/${tokenPriceDebug.total || 0}`
                        : ''}
                    </>
                  )}
              </p>
            )}
            <PortfolioDistribution rows={walletPortfolioRows} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#333' }}>Wallet</div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid #eee' }}>
              {[
                ['token', 'Token'],
                ['nft', 'NFT']
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setWalletTab(id)}
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    borderBottom: walletTab === id ? '2px solid #E6007A' : '2px solid transparent',
                    color: walletTab === id ? '#E6007A' : '#666',
                    fontSize: 13,
                    marginBottom: -1
                  }}>
                  {label}
                </button>
              ))}
            </div>
            {walletTab === 'token' ? (
              <WalletTokenTable rows={walletPortfolioRows} hasFiatQuote={walletHasFiatQuote} />
            ) : (
              <p style={{ color: '#888', fontSize: 13 }}>尚未支援 NFT 展示。</p>
            )}
          </div>

          <p style={{ color: '#888', fontSize: 12, marginTop: -6, marginBottom: 12 }}>
            備註：總餘額為 Relay+Asset Hub 本幣（{sym}）；「鎖定+保留」為 lock 與 reserved 加總。轉帳筆數為 Subscan transfers API 回報的 count（兩條鏈取較大值合併列表時的參考值）。
          </p>

          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 16,
            padding: '10px 12px', background: '#fafafa', borderRadius: 8, border: '1px solid #eee'
          }}>
            <span style={{ fontSize: 12, color: '#888', flexShrink: 0 }}>查詢地址分類</span>
            {viewerClass.primary.map(p => (
              <span key={p.key} title={p.hint || undefined}
                style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 16, fontWeight: 600,
                  ...viewerPrimaryBadgeStyle(p.key)
                }}>
                {p.label}
              </span>
            ))}
            {viewerClass.extra.map(e => (
              <span key={e.key}
                style={{
                  fontSize: 10, padding: '3px 8px', borderRadius: 12,
                  ...viewerExtraBadgeStyle(e.key)
                }}>
                {e.label}
              </span>
            ))}
            <span style={{ fontSize: 11, color: '#aaa', flex: '1 1 140px', minWidth: 0 }}>
              主類別依 Subscan「資產標籤」與近期轉帳 XCM 比例；跨鏈僅供參考。
            </span>
          </div>

          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #eee', marginBottom: 16 }}>
            {['overview', 'staking', 'network'].map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{ padding: '6px 14px', border: 'none', background: 'none', cursor: 'pointer',
                  borderBottom: tab === t ? '2px solid #E6007A' : '2px solid transparent',
                  color: tab === t ? '#E6007A' : '#555', fontSize: 13 }}>
                {{ overview: '轉帳', staking: '質押', network: '關聯地址' }[t]}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {transfers.length === 0 && <p style={{ color: '#888', fontSize: 13 }}>無近期轉帳</p>}
              {transfers.map((tx, i) => {
                const isIn = tx.to === input.trim()
                const peerAddr = isIn ? tx.from : tx.to
                const peerDisplay = isIn ? tx.from_account_display : tx.to_account_display
                const peerTag = transferPeerTag(peerDisplay)
                const tagStyle = transferTagPalette(peerTag)
                const exUrl = extrinsicExplorerUrl(tx, network)
                return (
                  <TransferRowShell key={i} extrinsicUrl={exUrl}>
                    <div style={{ display: 'grid', gridTemplateColumns: '30px 1fr auto',
                      gap: 8, padding: '10px 12px', border: '1px solid #eee', borderRadius: 8, alignItems: 'center',
                      transition: 'background 0.15s', cursor: exUrl ? 'pointer' : 'default' }}
                      onMouseEnter={e => { if (exUrl) e.currentTarget.style.background = '#fafafa' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', fontSize: 13,
                        background: isIn ? '#EAF3DE' : '#FCEBEB', color: isIn ? '#3B6D11' : '#A32D2D' }}>
                        {isIn ? '↓' : '↑'}
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
                          {peerTag && (
                            <span style={{
                              fontSize: 10, padding: '2px 7px', borderRadius: 4, flexShrink: 0,
                              ...tagStyle
                            }}>{peerTag}</span>
                          )}
                          <CopyableAddr address={peerAddr} copiedKey={copiedKey} setCopiedKey={setCopiedKey}
                            copyId={`tx-${i}-${peerAddr}`} />
                        </div>
                        <div style={{ fontSize: 10, color: '#aaa' }}>
                          區塊 #{tx.block_num}
                          {exUrl && <span style={{ marginLeft: 8, color: '#c2185b' }}>· 點列開啟 Subscan 交易</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: isIn ? '#3B6D11' : '#A32D2D' }}>
                          {isIn ? '+' : '-'}{fmtTransfer(tx, dec)}{' '}
                          {tx.asset_symbol || sym}
                        </div>
                        <div style={{ fontSize: 10, color: '#aaa' }}>
                          Fee {fmtFee(tx, dec)} · {tx.module || '—'} ·{' '}
                          {tx.block_timestamp ? relTime(tx.block_timestamp) : '—'}
                        </div>
                      </div>
                    </div>
                  </TransferRowShell>
                )
              })}
            </div>
          )}

          {tab === 'staking' && (
            <>
            <p style={{ color: '#888', fontSize: 11, margin: '0 0 10px', lineHeight: 1.45 }}>
              「已質押」合併提名人、提名池成員與 tokens 的 bonded；「解綁中」合併解綁清單。鎖定很大但質押仍為 0 時，多為治理／投票鎖定，非此處的 Relay 質押欄位。
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                ['已質押', fmt(String(acc.bonded_total ?? acc.bonded ?? '0'), dec), sym],
                ['解綁中', fmt((acc.unbonding_total ?? acc.unbonding) || '0', dec), sym],
                ['鎖定+保留', fmt(lockPlanck || '0', dec), sym],
                ['驗證者', staking?.code === 0 ? '是' : '否', ''],
              ].map(([label, val, sub]) => (
                <div key={label} style={{ border: '1px solid #eee', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{val}</div>
                  <div style={{ fontSize: 11, color: '#888' }}>{sub}</div>
                </div>
              ))}
            </div>
            </>
          )}

          {tab === 'network' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p style={{ color: '#888', fontSize: 12, margin: '0 0 8px' }}>
                僅統計與 {sym} 本幣相關轉帳的淨額；標籤結合 Subscan 帳戶標記與 XCM／跨鏈轉帳比例（僅供參考）。
              </p>
              {related.length === 0 && <p style={{ color: '#888', fontSize: 13 }}>無關聯地址</p>}
              {related.map(([addr, d]) => {
                const net = d.inAmt - d.outAmt
                const isPos = net >= 0n
                const netStr = isPos ? net.toString() : (-net).toString()
                return (
                  <div key={addr} style={{ display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', border: '1px solid #eee', borderRadius: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: d.in > 0 && d.out > 0 ? '#E6007A' : d.in > 0 ? '#3B6D11' : '#A32D2D' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: 10, padding: '2px 6px', borderRadius: 4,
                          background: d.tag === 'exchange' ? '#FFF3E0' : d.tag === 'cross_chain' ? '#E3F2FD' : '#f0f0f0',
                          color: '#555', flexShrink: 0
                        }}>{d.labelZh || '一般地址'}</span>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                          <CopyableAddr address={addr} copiedKey={copiedKey} setCopiedKey={setCopiedKey}
                            copyId={`rel-${addr}`}
                            style={{ color: '#555', textDecoration: 'underline dotted', maxWidth: '100%' }}>
                            <span style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>
                              {addr}
                            </span>
                          </CopyableAddr>
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>
                      收{d.in} 發{d.out}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, minWidth: 100, textAlign: 'right',
                      color: isPos ? '#3B6D11' : '#A32D2D' }}>
                      {isPos ? '+' : '-'}{fmt(netStr, dec)} {sym}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}