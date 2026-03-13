import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { listExperiments, getExperiment } from '../lib/api.ts'
import type { Experiment, Trace } from '../types.ts'

export default function ComparePage() {
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [leftId, setLeftId] = useState<number | null>(null)
  const [rightId, setRightId] = useState<number | null>(null)
  const [leftTraces, setLeftTraces] = useState<Trace[]>([])
  const [rightTraces, setRightTraces] = useState<Trace[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'cases' | 'graders'>('cases')

  useEffect(() => {
    listExperiments().then(exps => {
      const completed = exps.filter(e => e.status === 'complete' || e.status === 'paused')
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

  // Per-grader comparison
  const graderComparison = useMemo(() => {
    const leftAvgs: Record<string, { sum: number; count: number }> = {}
    const rightAvgs: Record<string, { sum: number; count: number }> = {}

    for (const t of leftTraces) {
      if (!t.composite_scores) continue
      for (const [name, g] of Object.entries(t.composite_scores)) {
        if (!leftAvgs[name]) leftAvgs[name] = { sum: 0, count: 0 }
        leftAvgs[name].sum += g.score
        leftAvgs[name].count++
      }
    }
    for (const t of rightTraces) {
      if (!t.composite_scores) continue
      for (const [name, g] of Object.entries(t.composite_scores)) {
        if (!rightAvgs[name]) rightAvgs[name] = { sum: 0, count: 0 }
        rightAvgs[name].sum += g.score
        rightAvgs[name].count++
      }
    }

    const allGraders = new Set([...Object.keys(leftAvgs), ...Object.keys(rightAvgs)])
    return Array.from(allGraders).sort().map(name => {
      const left = leftAvgs[name] ? leftAvgs[name].sum / leftAvgs[name].count : null
      const right = rightAvgs[name] ? rightAvgs[name].sum / rightAvgs[name].count : null
      const delta = (left !== null && right !== null) ? right - left : null
      return { name, left, right, delta }
    })
  }, [leftTraces, rightTraces])

  if (loading) return <div className="text-slate-400">Loading...</div>
  if (experiments.length < 2) {
    return <div className="text-slate-400 text-center py-12">Need at least 2 completed experiments to compare.</div>
  }

  // Build case comparison map
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

      {/* View toggle */}
      <div className="flex gap-1 border-b border-slate-200">
        {(['cases', 'graders'] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              view === v
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {v === 'cases' ? 'Per Case' : 'Per Grader'}
          </button>
        ))}
      </div>

      {/* Per-Case Comparison */}
      {view === 'cases' && (
        <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Case</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Left</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Right</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Delta</th>
                <th className="px-4 py-2 text-center text-xs font-medium text-slate-500">Status</th>
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
                    <td className="px-4 py-2 font-medium text-slate-700">
                      {right ? (
                        <Link to={`/traces/${right.id}`} className="text-blue-600 hover:underline">{key}</Link>
                      ) : key}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {left ? (
                        <span className={left.final_pass ? 'text-emerald-600' : 'text-red-500'}>
                          {Math.round(leftScore)}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {right ? (
                        <span className={right.final_pass ? 'text-emerald-600' : 'text-red-500'}>
                          {Math.round(rightScore)}
                        </span>
                      ) : '-'}
                    </td>
                    <td className={`px-4 py-2 text-right tabular-nums font-medium ${
                      delta > 0 ? 'text-emerald-600'
                        : delta < -REGRESSION_THRESHOLD ? 'text-red-600'
                        : delta < 0 ? 'text-amber-600'
                        : 'text-slate-400'
                    }`}>
                      {left && right ? `${delta > 0 ? '+' : ''}${Math.round(delta)}` : '-'}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {left && right ? (
                        isRegression ? (
                          <span className="text-xs text-red-600 font-medium">REGRESSION</span>
                        ) : delta > REGRESSION_THRESHOLD ? (
                          <span className="text-xs text-emerald-600 font-medium">IMPROVED</span>
                        ) : null
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-Grader Comparison */}
      {view === 'graders' && (
        <div className="space-y-4">
          {graderComparison.length === 0 ? (
            <div className="text-slate-400 text-center py-8">
              No composite scores available. Run experiments with the new grading pipeline first.
            </div>
          ) : (
            <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Grader</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Left Avg</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-slate-500">Comparison</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Right Avg</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Delta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {graderComparison.map(({ name, left, right, delta }) => (
                    <tr key={name}>
                      <td className="px-4 py-2.5 font-medium text-slate-700">
                        {name.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {left !== null ? (
                          <span className={left >= 70 ? 'text-emerald-600' : left >= 40 ? 'text-amber-600' : 'text-red-500'}>
                            {left.toFixed(1)}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-2.5">
                        {left !== null && right !== null ? (
                          <div className="flex items-center gap-1">
                            <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className="h-2 rounded-full bg-slate-400"
                                style={{ width: `${left}%` }}
                              />
                            </div>
                            <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className="h-2 rounded-full bg-blue-500"
                                style={{ width: `${right}%` }}
                              />
                            </div>
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {right !== null ? (
                          <span className={right >= 70 ? 'text-emerald-600' : right >= 40 ? 'text-amber-600' : 'text-red-500'}>
                            {right.toFixed(1)}
                          </span>
                        ) : '-'}
                      </td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${
                        delta === null ? 'text-slate-400'
                          : delta > 5 ? 'text-emerald-600'
                          : delta < -5 ? 'text-red-600'
                          : 'text-slate-500'
                      }`}>
                        {delta !== null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Summary stats */}
          {graderComparison.some(g => g.delta !== null) && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {(() => {
                const deltas = graderComparison.filter(g => g.delta !== null).map(g => g.delta!)
                const improved = deltas.filter(d => d > 5).length
                const regressed = deltas.filter(d => d < -5).length
                const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length
                return (
                  <>
                    <div className="rounded-xl bg-white border border-slate-200 p-3 text-center">
                      <div className="text-xs text-slate-500 mb-1">Avg Delta</div>
                      <div className={`text-xl font-bold ${avgDelta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {avgDelta > 0 ? '+' : ''}{avgDelta.toFixed(1)}
                      </div>
                    </div>
                    <div className="rounded-xl bg-white border border-slate-200 p-3 text-center">
                      <div className="text-xs text-slate-500 mb-1">Improved</div>
                      <div className="text-xl font-bold text-emerald-600">{improved}</div>
                    </div>
                    <div className="rounded-xl bg-white border border-slate-200 p-3 text-center">
                      <div className="text-xs text-slate-500 mb-1">Regressed</div>
                      <div className="text-xl font-bold text-red-500">{regressed}</div>
                    </div>
                  </>
                )
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
