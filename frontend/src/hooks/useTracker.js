import { useState, useCallback } from 'react'
import { api } from '../api/subscan'

export function useTracker() {
  const [state, setState] = useState({
    loading: false,
    error: null,
    account: null,
    transfers: [],
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
      if (!acc || acc.error) throw new Error(acc?.error || '地址不存在')

      const txList = transfers.status === 'fulfilled' ? (transfers.value.transfers || []) : []

      setState(s => ({
        ...s,
        loading: false,
        account: acc,
        transfers: txList,
        staking: staking.status === 'fulfilled' ? staking.value : null,
        history: history.status === 'fulfilled' ? (history.value.list || []) : [],
        related: buildRelated(txList, address),
      }))
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: e.message }))
    }
  }, [])

  return { ...state, lookup }
}

function buildRelated(transfers, address) {
  const map = {}
  transfers.forEach(tx => {
    const isIn = tx.to === address
    const peer = isIn ? tx.from : tx.to
    if (!peer || peer === address) return
    if (!map[peer]) map[peer] = { in: 0, out: 0, inAmt: 0n, outAmt: 0n }
    try {
      const amt = BigInt(tx.amount || '0')
      if (isIn) { map[peer].in++; map[peer].inAmt += amt }
      else { map[peer].out++; map[peer].outAmt += amt }
    } catch {}
  })
  return Object.entries(map).sort((a, b) => (b[1].in + b[1].out) - (a[1].in + a[1].out))
}
