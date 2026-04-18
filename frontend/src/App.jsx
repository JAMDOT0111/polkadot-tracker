import { useState } from 'react'
import { useTracker } from './hooks/useTracker'

const NETWORKS = ['polkadot', 'kusama']
const DEC = { polkadot: 10, kusama: 12 }
const SYM = { polkadot: 'DOT', kusama: 'KSM' }

function fmt(planck, dec) {
  try { return (Number(BigInt(planck)) / 10 ** dec).toFixed(4) } catch { return '0.0000' }
}
function short(a) { return a ? a.slice(0, 8) + '...' + a.slice(-5) : '—' }
function relTime(ts) {
  const d = Math.floor(Date.now() / 1000) - ts
  if (d < 60) return d + '秒前'
  if (d < 3600) return Math.floor(d / 60) + '分鐘前'
  return Math.floor(d / 3600) + '小時前'
}

export default function App() {
  const [input, setInput] = useState('')
  const [network, setNetwork] = useState('polkadot')
  const [tab, setTab] = useState('overview')
  const { loading, error, account, transfers, staking, related, lookup } = useTracker()

  const dec = DEC[network]
  const sym = SYM[network]
  const acc = account?.account || {}

  function handleLookup() { lookup(input.trim(), network) }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>⬡ Polkadot 錢包追蹤器</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {NETWORKS.map(n => (
          <button key={n} onClick={() => setNetwork(n)}
            style={{ padding: '4px 14px', borderRadius: 20, border: '1px solid #ccc',
              background: network === n ? '#E6007A' : 'transparent',
              color: network === n ? '#fff' : '#555', cursor: 'pointer' }}>
            {n.charAt(0).toUpperCase() + n.slice(1)}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLookup()}
          placeholder="輸入地址..."
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #ccc', borderRadius: 8, fontSize: 13 }} />
        <button onClick={handleLookup} disabled={loading}
          style={{ padding: '8px 18px', background: '#E6007A', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
          {loading ? '查詢中...' : '查詢'}
        </button>
      </div>

      {error && <p style={{ color: 'red', fontSize: 13 }}>{error}</p>}

      {account && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, margin: '16px 0' }}>
            {[
              ['總餘額', fmt(acc.balance || '0', dec), sym],
              ['鎖定', fmt(acc.lock || '0', dec), sym],
              ['Nonce', acc.nonce || 0, '筆交易'],
            ].map(([label, val, sub]) => (
              <div key={label} style={{ background: '#f5f5f5', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#E6007A' }}>{val}</div>
                <div style={{ fontSize: 11, color: '#888' }}>{sub}</div>
              </div>
            ))}
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
                return (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '30px 1fr auto',
                    gap: 8, padding: '10px 12px', border: '1px solid #eee', borderRadius: 8, alignItems: 'center' }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', fontSize: 13,
                      background: isIn ? '#EAF3DE' : '#FCEBEB', color: isIn ? '#3B6D11' : '#A32D2D' }}>
                      {isIn ? '↓' : '↑'}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace' }}>
                        {short(isIn ? tx.from : tx.to)}
                      </div>
                      <div style={{ fontSize: 10, color: '#aaa' }}>區塊 #{tx.block_num}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: isIn ? '#3B6D11' : '#A32D2D' }}>
                        {isIn ? '+' : '-'}{fmt(tx.amount, dec)} {sym}
                      </div>
                      <div style={{ fontSize: 10, color: '#aaa' }}>
                        {tx.block_timestamp ? relTime(tx.block_timestamp) : '—'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {tab === 'staking' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                ['已質押', fmt(acc.bonded || '0', dec), sym],
                ['解綁中', fmt(acc.unbonding || '0', dec), sym],
                ['鎖定', fmt(acc.lock || '0', dec), sym],
                ['驗證者', staking?.code === 0 ? '是' : '否', ''],
              ].map(([label, val, sub]) => (
                <div key={label} style={{ border: '1px solid #eee', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{val}</div>
                  <div style={{ fontSize: 11, color: '#888' }}>{sub}</div>
                </div>
              ))}
            </div>
          )}

          {tab === 'network' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {related.length === 0 && <p style={{ color: '#888', fontSize: 13 }}>無關聯地址</p>}
              {related.map(([addr, d]) => {
                const net = d.inAmt - d.outAmt
                const isPos = net >= 0n
                return (
                  <div key={addr} style={{ display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', border: '1px solid #eee', borderRadius: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: d.in > 0 && d.out > 0 ? '#E6007A' : d.in > 0 ? '#3B6D11' : '#A32D2D' }} />
                    <div style={{ flex: 1, fontFamily: 'monospace', fontSize: 11, color: '#555',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{addr}</div>
                    <div style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>
                      收{d.in} 發{d.out}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, minWidth: 80, textAlign: 'right',
                      color: isPos ? '#3B6D11' : '#A32D2D' }}>
                      {isPos ? '+' : '-'}{fmt((isPos ? net : -net).toString(), dec)} {sym}
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