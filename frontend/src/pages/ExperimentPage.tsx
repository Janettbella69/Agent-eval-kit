import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { getExperiment } from '../lib/api.ts'
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
            : 'text-slate-400'
        }`}>
          {experiment.status}
        </span>
      </div>

      {/* Running progress */}
      {experiment.status === 'running' && (
        <RunProgress experimentId={experiment.id} onComplete={load} />
      )}

      {/* Summary cards */}
      {s && s.total_cases > 0 && (
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
      )}

      {/* Traces table */}
      <CaseTable traces={sortedTraces} sortKey={sortKey} onSort={handleSort} />
    </div>
  )
}
