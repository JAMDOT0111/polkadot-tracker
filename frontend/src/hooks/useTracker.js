import { useState, useCallback } from 'react'
import { api } from '../api/subscan'

export function useTracker() {
  const [state, setState] = useState({
    loading: false,
    error: null,
    account: null,
    transfers: [],
    transfersCount: 0,
    staking: null,
    history: [],
    related: [],
    address: '',
    network: 'polkadot'
  })

  const lookup = useCallback(async (address, network) => {
    if (!address) return
    setState(s => ({ ...s, loading: true, error: null, address, network }))
    try {
      const [account, transfers, staking, history] = await Promise.allSettled([
        api.getAccount(network, address),
        api.getTransfers(network, address),
        api.getStaking(network, address),
        api.getBalanceHistory(network, address),
      ])

      const acc = account.status === 'fulfilled' ? account.value : null
      if (!acc || acc.error) {
        const reason = account.status === 'rejected' ? account.reason?.message : acc?.error
        throw new Error(reason || '地址格式不正確或查無資料')
      }

      const tval = transfers.status === 'fulfilled' ? transfers.value : null
      const txList = tval?.transfers || []
      const txCnt = typeof tval?.count === 'number' ? tval.count : txList.length

      const nativeSym = network === 'kusama' ? 'KSM' : 'DOT'
      const peerRows = buildRelatedPeers(txList, address, nativeSym)

      let labelMap = {}
      if (peerRows.length > 0) {
        try {
          const tagRes = await api.getAccountTags(network, peerRows.map(([a]) => a))
          labelMap = tagRes.labels || {}
        } catch {
          labelMap = {}
        }
      }

      const related = peerRows.map(([addr, d]) => {
        const srvTag = labelMap[addr]?.tag
        const { tag, labelZh } = resolvePeerTag(d, srvTag)
        return [addr, { ...d, tag, labelZh }]
      })

      setState(s => ({
        ...s,
        loading: false,
        account: acc,
        transfers: txList,
        transfersCount: txCnt,
        staking: staking.status === 'fulfilled' ? staking.value : null,
        history: history.status === 'fulfilled' ? (history.value.list || []) : [],
        related,
      }))
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: e.message }))
    }
  }, [])

  return { ...state, lookup }
}

function isXcmHeavy(tx) {
  const blob = `${tx.call_module ?? ''} ${tx.module ?? ''} ${tx.extrinsic_call_module ?? ''} ${tx.category ?? ''}`.toLowerCase()
  return /\bxcm\b|polkadotxcm|parachain|bridge/i.test(blob)
}

function isNativeCoinTx(tx, symUpper) {
  const s = String(tx.asset_symbol ?? '').trim().toUpperCase()
  if (!s) return true
  return s === symUpper
}

function buildRelatedPeers(transfers, address, nativeSymbol) {
  const sym = nativeSymbol.toUpperCase()
  const map = {}
  transfers.forEach(tx => {
    const isIn = tx.to === address
    const peer = isIn ? tx.from : tx.to
    if (!peer || peer === address) return
    if (!map[peer]) map[peer] = { in: 0, out: 0, inAmt: 0n, outAmt: 0n, xcmN: 0, txN: 0 }
    const rec = map[peer]
    rec.txN++
    if (isXcmHeavy(tx)) rec.xcmN++
    if (!isNativeCoinTx(tx, sym)) return
    let delta
    try {
      const rawStr = tx.amount_v2 ?? tx.amount ?? '0'
      delta = BigInt(rawStr === '' ? '0' : rawStr)
    } catch {
      return
    }
    if (isIn) {
      rec.in++
      rec.inAmt += delta
    } else {
      rec.out++
      rec.outAmt += delta
    }
  })

  return Object.entries(map)
    .map(([addr, d]) => [addr, { ...d, xcmRatio: d.txN ? d.xcmN / d.txN : 0 }])
    .sort((a, b) => (b[1].in + b[1].out) - (a[1].in + a[1].out))
}

function resolvePeerTag(d, serverTag) {
  if (serverTag === 'exchange') return { tag: 'exchange', labelZh: '交易所' }
  if (d.xcmRatio >= 0.25) return { tag: 'cross_chain', labelZh: '跨鏈' }
  return { tag: 'general', labelZh: '一般地址' }
}
