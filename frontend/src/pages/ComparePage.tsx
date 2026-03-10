import { useState, useEffect } from 'react'
import { listExperiments, getExperiment } from '../lib/api.ts'
import type { Experiment, Trace } from '../types.ts'

export default function ComparePage() {
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [leftId, setLeftId] = useState<number | null>(null)
  const [rightId, setRightId] = useState<number | null>(null)
  const [leftTraces, setLeftTraces] = useState<Trace[]>([])
  const [rightTraces, setRightTraces] = useState<Trace[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listExperiments().then(exps => {
      const completed = exps.filter(e => e.status === 'complete')
      setExperiments(completed)
      if (completed.length >= 2) {
        setLeftId(completed[1].id)
        setRightId(completed[0].id)
      }
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (leftId) getExperiment(leftId).then(e => setLeftTraces(e.traces ?? []))
  }, [leftId])

  useEffect(() => {
    if (rightId) getExperiment(rightId).then(e => setRightTraces(e.traces ?? []))
  }, [rightId])

  if (loading) return <div className="text-slate-400">Loading...</div>
  if (experiments.length < 2) {
    return <div className="text-slate-400 text-center py-12">Need at least 2 completed experiments to compare.</div>
  }

  // Build comparison map
  const leftMap = new Map(leftTraces.map(t => [t.case_key, t]))
  const rightMap = new Map(rightTraces.map(t => [t.case_key, t]))
  const allKeys = [...new Set([...leftMap.keys(), ...rightMap.keys()])].sort()

  const REGRESSION_THRESHOLD = 15

  return (
    <div className="space-y-6 animate-fadeIn">
      <h1 className="text-2xl font-bold text-slate-900">Compare Experiments</h1>

      <div className="flex items-center gap-4">
        <select
          value={leftId ?? ''}
          onChange={e => setLeftId(Number(e.target.value))}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
        >
          {experiments.map(e => (
            <option key={e.id} value={e.id}>#{e.id} {e.tag || ''}</option>
          ))}
        </select>
        <span className="text-slate-400 font-bold">vs</span>
        <select
          value={rightId ?? ''}
          onChange={e => setRightId(Number(e.target.value))}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
        >
          {experiments.map(e => (
            <option key={e.id} value={e.id}>#{e.id} {e.tag || ''}</option>
          ))}
        </select>
      </div>

      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Case</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Left</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Right</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Delta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {allKeys.map(key => {
              const left = leftMap.get(key)
              const right = rightMap.get(key)
              const leftScore = left?.final_score ?? 0
              const rightScore = right?.final_score ?? 0
              const delta = rightScore - leftScore
              const isRegression = delta < -REGRESSION_THRESHOLD

              return (
                <tr key={key} className={isRegression ? 'bg-red-50' : ''}>
                  <td className="px-4 py-2 font-medium text-slate-700">{key}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {left ? Math.round(leftScore) : '-'}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {right ? Math.round(rightScore) : '-'}
                  </td>
                  <td className={`px-4 py-2 text-right tabular-nums font-medium ${
                    delta > 0 ? 'text-emerald-600'
                      : delta < -REGRESSION_THRESHOLD ? 'text-red-600'
                      : delta < 0 ? 'text-amber-600'
                      : 'text-slate-400'
                  }`}>
                    {delta > 0 ? '+' : ''}{Math.round(delta)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
