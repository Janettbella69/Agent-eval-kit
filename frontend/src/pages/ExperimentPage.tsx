import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { getExperiment, regradeExperiment } from '../lib/api.ts'
import CaseTable from '../components/CaseTable.tsx'
import RunProgress from '../components/RunProgress.tsx'
import ScoreBadge from '../components/ScoreBadge.tsx'
import type { Experiment, Trace } from '../types.ts'

export default function ExperimentPage() {
  const { id } = useParams<{ id: string }>()
  const [experiment, setExperiment] = useState<Experiment | null>(null)
  const [traces, setTraces] = useState<Trace[]>([])
  const [sortKey, setSortKey] = useState('case_key')
  const [sortAsc, setSortAsc] = useState(true)
  const [loading, setLoading] = useState(true)
  const [regrading, setRegrading] = useState(false)

  const load = useCallback(() => {
    if (!id) return
    getExperiment(Number(id)).then(e => {
      setExperiment(e)
      setTraces(e.traces ?? [])
    }).finally(() => setLoading(false))
  }, [id])

  useEffect(() => { load() }, [load])

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const handleRegrade = async () => {
    if (!id) return
    setRegrading(true)
    try {
      await regradeExperiment(Number(id))
      load()
    } finally {
      setRegrading(false)
    }
  }

  const sortedTraces = [...traces].sort((a, b) => {
    const aVal = a[sortKey as keyof Trace]
    const bVal = b[sortKey as keyof Trace]
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return sortAsc ? aVal - bVal : bVal - aVal
    }
    return sortAsc
      ? String(aVal).localeCompare(String(bVal))
      : String(bVal).localeCompare(String(aVal))
  })

  if (loading) return <div className="text-slate-400">Loading...</div>
  if (!experiment) return <div className="text-red-500">Experiment not found.</div>

  const s = experiment.summary

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-900">
          Experiment #{experiment.id}
        </h1>
        {experiment.tag && (
          <span className="px-2 py-0.5 rounded bg-slate-100 text-sm text-slate-600">{experiment.tag}</span>
        )}
        <span className={`text-sm font-medium ${
          experiment.status === 'complete' ? 'text-emerald-600'
            : experiment.status === 'running' ? 'text-blue-600'
            : experiment.status === 'paused' ? 'text-amber-600'
            : 'text-slate-400'
        }`}>
          {experiment.status}
        </span>
        {experiment.status !== 'running' && (
          <button
            onClick={handleRegrade}
            disabled={regrading}
            className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50"
          >
            {regrading ? 'Re-grading...' : 'Re-grade'}
          </button>
        )}
      </div>

      {/* Running progress */}
      {experiment.status === 'running' && (
        <RunProgress experimentId={experiment.id} onComplete={load} />
      )}

      {/* Summary cards */}
      {s && s.total_cases > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded-xl bg-white border border-slate-200 p-3 text-center">
              <div className="text-xs text-slate-500 mb-1">Avg Score</div>
              <ScoreBadge score={s.avg_score} pass={s.avg_score >= 70} size="lg" />
            </div>
            <div className="rounded-xl bg-white border border-slate-200 p-3 text-center">
              <div className="text-xs text-slate-500 mb-1">Median</div>
              <div className="text-xl font-bold text-slate-900 tabular-nums">{s.median_score}</div>
            </div>
            <div className="rounded-xl bg-white border border-slate-200 p-3 text-center">
              <div className="text-xs text-slate-500 mb-1">Pass Rate</div>
              <div className="text-xl font-bold text-emerald-600 tabular-nums">
                {Math.round((s.passed / Math.max(s.total_cases, 1)) * 100)}%
              </div>
            </div>
            <div className="rounded-xl bg-white border border-slate-200 p-3 text-center">
              <div className="text-xs text-slate-500 mb-1">Pass / Fail</div>
              <div className="text-xl font-bold tabular-nums">
                <span className="text-emerald-600">{s.passed}</span>
                <span className="text-slate-300"> / </span>
                <span className="text-red-500">{s.failed}</span>
              </div>
            </div>
            <div className="rounded-xl bg-white border border-slate-200 p-3 text-center">
              <div className="text-xs text-slate-500 mb-1">Avg Duration</div>
              <div className="text-xl font-bold text-slate-900 tabular-nums">{s.avg_duration}s</div>
            </div>
          </div>

          {/* Tracked Metrics (Anthropic: green indicators, not graders) */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded-xl bg-slate-50 border border-slate-200/60 p-3 text-center">
              <div className="text-[10px] text-slate-400 mb-1">Avg Turns</div>
              <div className="text-lg font-bold text-slate-700 tabular-nums">{s.avg_turns || '—'}</div>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200/60 p-3 text-center">
              <div className="text-[10px] text-slate-400 mb-1">Avg Tokens</div>
              <div className="text-lg font-bold text-slate-700 tabular-nums">{s.avg_tokens ? Math.round(s.avg_tokens).toLocaleString() : '—'}</div>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200/60 p-3 text-center">
              <div className="text-[10px] text-slate-400 mb-1">Avg Tool Calls</div>
              <div className="text-lg font-bold text-slate-700 tabular-nums">{s.avg_toolcalls || '—'}</div>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200/60 p-3 text-center">
              <div className="text-[10px] text-slate-400 mb-1">Duration</div>
              <div className="text-lg font-bold text-slate-700 tabular-nums">{s.avg_duration}s</div>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200/60 p-3 text-center">
              <div className="text-[10px] text-slate-400 mb-1">Consistency</div>
              <div className="text-lg font-bold text-slate-700 tabular-nums">{s.consistency_rate ? `${(s.consistency_rate * 100).toFixed(0)}%` : '—'}</div>
            </div>
          </div>

          {/* pass@k / pass^k metrics */}
          {(s.pass_at_k && Object.keys(s.pass_at_k).length > 1) || (s.pass_pow_k && Object.keys(s.pass_pow_k).length > 1) ? (
            <div className="rounded-xl bg-white border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Multi-Trial Metrics</h3>
              <div className="grid grid-cols-2 gap-6">
                {/* pass@k — at least one trial passes */}
                {s.pass_at_k && Object.keys(s.pass_at_k).length > 0 && (
                  <div>
                    <div className="text-xs text-slate-500 mb-2">pass@k (at least 1 trial succeeds)</div>
                    <div className="space-y-1.5">
                      {Object.entries(s.pass_at_k).map(([label, rate]) => (
                        <div key={label} className="flex items-center gap-2">
                          <span className="text-xs text-slate-600 w-16 font-mono">{label}</span>
                          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${rate * 100}%` }} />
                          </div>
                          <span className="text-xs font-medium tabular-nums w-12 text-right text-slate-700">
                            {(rate * 100).toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* pass^k — all trials pass */}
                {s.pass_pow_k && Object.keys(s.pass_pow_k).length > 0 && (
                  <div>
                    <div className="text-xs text-slate-500 mb-2">pass^k (all k trials succeed)</div>
                    <div className="space-y-1.5">
                      {Object.entries(s.pass_pow_k).map(([label, rate]) => (
                        <div key={label} className="flex items-center gap-2">
                          <span className="text-xs text-slate-600 w-16 font-mono">{label}</span>
                          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-2 rounded-full bg-blue-500 transition-all" style={{ width: `${rate * 100}%` }} />
                          </div>
                          <span className="text-xs font-medium tabular-nums w-12 text-right text-slate-700">
                            {(rate * 100).toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* Grader Averages */}
      {s?.grader_averages && Object.keys(s.grader_averages).length > 0 && (
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Per-Grader Averages</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {Object.entries(s.grader_averages).sort(([, a], [, b]) => b - a).map(([name, avg]) => (
              <div key={name} className="flex items-center gap-2">
                <span className="text-xs text-slate-500 w-36 truncate" title={name}>
                  {name.replace(/_/g, ' ')}
                </span>
                <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      avg >= 70 ? 'bg-emerald-500' : avg >= 40 ? 'bg-amber-400' : 'bg-red-400'
                    }`}
                    style={{ width: `${avg}%` }}
                  />
                </div>
                <span className="text-xs font-medium tabular-nums w-8 text-right text-slate-700">
                  {avg.toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Failure Funnel Distribution */}
      {s?.failure_funnel_dist && Object.keys(s.failure_funnel_dist).length > 0 && (
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Failure Funnel Distribution</h3>
          <div className="flex gap-4">
            {Object.entries(s.failure_funnel_dist).sort(([, a], [, b]) => b - a).map(([stage, count]) => (
              <div key={stage} className="text-center">
                <div className="text-2xl font-bold text-red-500 tabular-nums">{count}</div>
                <div className="text-xs text-slate-500 mt-0.5">{stage.replace('_', ' ')}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Traces table */}
      <CaseTable traces={sortedTraces} sortKey={sortKey} onSort={handleSort} />
    </div>
  )
}
