import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { listExperiments, compareExperiments, createDatasetFromExperiment } from '../lib/api.ts'
import type { Experiment, CompareResult, CompareCase } from '../types.ts'

type ViewMode = 'cases' | 'graders'
type StatusFilter = 'all' | 'improved' | 'regressed' | 'unchanged' | 'new' | 'removed'

export default function ComparePage() {
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [baseId, setBaseId] = useState<number | null>(null)
  const [targetId, setTargetId] = useState<number | null>(null)
  const [result, setResult] = useState<CompareResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [comparing, setComparing] = useState(false)
  const [view, setView] = useState<ViewMode>('cases')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sliceLoading, setSliceLoading] = useState(false)
  const [sliceMsg, setSliceMsg] = useState('')

  useEffect(() => {
    listExperiments().then(exps => {
      const completed = exps.filter(e => e.status === 'complete' || e.status === 'paused')
      setExperiments(completed)
      if (completed.length >= 2) {
        setBaseId(completed[1].id)
        setTargetId(completed[0].id)
      }
    }).finally(() => setLoading(false))
  }, [])

  // Fetch comparison when both IDs are set
  const fetchComparison = useCallback(async () => {
    if (!baseId || !targetId || baseId === targetId) return
    setComparing(true)
    try {
      const data = await compareExperiments(baseId, targetId)
      setResult(data)
    } catch (e) {
      console.error('Compare failed:', e)
    } finally {
      setComparing(false)
    }
  }, [baseId, targetId])

  useEffect(() => {
    fetchComparison()
  }, [fetchComparison])

  // Filtered cases
  const filteredCases = useMemo(() => {
    if (!result) return []
    if (statusFilter === 'all') return result.cases
    return result.cases.filter(c => c.status === statusFilter)
  }, [result, statusFilter])

  // Grader comparison (computed from per-case composite_scores is not available
  // from the compare API — we show summary-level grader averages instead)

  const handleCreateSlice = async (filterType: 'failed' | 'regressed' | 'improved') => {
    if (!targetId) return
    const suffix = filterType === 'failed' ? 'failed' : filterType === 'regressed' ? 'regressed' : 'improved'
    const name = `debug-${suffix}-exp${targetId}`
    setSliceLoading(true)
    setSliceMsg('')
    try {
      const res = await createDatasetFromExperiment({
        experiment_id: targetId,
        name,
        filter: filterType,
        compare_to: filterType !== 'failed' ? baseId ?? undefined : undefined,
      })
      setSliceMsg(`Created dataset "${name}" with ${res.cases_count} cases (ID: ${res.dataset_id})`)
    } catch (e) {
      setSliceMsg(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSliceLoading(false)
    }
  }

  if (loading) return <div className="text-slate-400">Loading...</div>
  if (experiments.length < 2) {
    return <div className="text-slate-400 text-center py-12">Need at least 2 completed experiments to compare.</div>
  }

  const s = result?.summary

  return (
    <div className="space-y-6 animate-fadeIn">
      <h1 className="text-2xl font-bold text-slate-900">Compare Experiments</h1>

      {/* Experiment selectors */}
      <div className="flex items-center gap-4">
        <div className="space-y-1">
          <div className="text-xs text-slate-500 font-medium">Base (before)</div>
          <select
            value={baseId ?? ''}
            onChange={e => setBaseId(Number(e.target.value))}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
          >
            {experiments.map(e => (
              <option key={e.id} value={e.id}>#{e.id} {e.tag || `experiment-${e.id}`}</option>
            ))}
          </select>
        </div>
        <span className="text-slate-400 font-bold mt-5">→</span>
        <div className="space-y-1">
          <div className="text-xs text-slate-500 font-medium">Target (after)</div>
          <select
            value={targetId ?? ''}
            onChange={e => setTargetId(Number(e.target.value))}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
          >
            {experiments.map(e => (
              <option key={e.id} value={e.id}>#{e.id} {e.tag || `experiment-${e.id}`}</option>
            ))}
          </select>
        </div>
        {baseId === targetId && (
          <span className="text-amber-600 text-xs mt-5">Select different experiments</span>
        )}
      </div>

      {comparing && <div className="text-slate-400 text-sm">Comparing...</div>}

      {/* Summary cards */}
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="rounded-xl bg-white border border-slate-200 p-3 text-center">
            <div className="text-xs text-slate-500 mb-1">Net Delta</div>
            <div className={`text-xl font-bold ${s.net_delta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {s.net_delta > 0 ? '+' : ''}{s.net_delta}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {s.base_avg} → {s.target_avg}
            </div>
          </div>
          <div className="rounded-xl bg-white border border-emerald-200 p-3 text-center">
            <div className="text-xs text-slate-500 mb-1">Improved</div>
            <div className="text-xl font-bold text-emerald-600">{s.improved}</div>
          </div>
          <div className="rounded-xl bg-white border border-red-200 p-3 text-center">
            <div className="text-xs text-slate-500 mb-1">Regressed</div>
            <div className="text-xl font-bold text-red-500">{s.regressed}</div>
          </div>
          <div className="rounded-xl bg-white border border-slate-200 p-3 text-center">
            <div className="text-xs text-slate-500 mb-1">Unchanged</div>
            <div className="text-xl font-bold text-slate-600">{s.unchanged}</div>
          </div>
          <div className="rounded-xl bg-white border border-slate-200 p-3 text-center">
            <div className="text-xs text-slate-500 mb-1">Pass Rate</div>
            <div className="text-sm text-slate-700">
              {result ? `${(result.base.pass_rate * 100).toFixed(0)}% → ${(result.target.pass_rate * 100).toFixed(0)}%` : '-'}
            </div>
          </div>
        </div>
      )}

      {/* Dataset slicing actions */}
      {s && (s.regressed > 0 || s.improved > 0) && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500">Create debug dataset:</span>
          {s.regressed > 0 && (
            <button
              onClick={() => handleCreateSlice('regressed')}
              disabled={sliceLoading}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              {s.regressed} regressed cases
            </button>
          )}
          <button
            onClick={() => handleCreateSlice('failed')}
            disabled={sliceLoading}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            All failed cases
          </button>
          {s.improved > 0 && (
            <button
              onClick={() => handleCreateSlice('improved')}
              disabled={sliceLoading}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
            >
              {s.improved} improved cases
            </button>
          )}
          {sliceMsg && (
            <span className={`text-xs ${sliceMsg.startsWith('Error') ? 'text-red-600' : 'text-emerald-600'}`}>
              {sliceMsg}
            </span>
          )}
        </div>
      )}

      {/* View toggle + status filter */}
      {result && (
        <div className="flex items-center justify-between border-b border-slate-200">
          <div className="flex gap-1">
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
          {view === 'cases' && (
            <div className="flex gap-1 text-xs">
              {(['all', 'regressed', 'improved', 'unchanged'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`px-2 py-1 rounded ${
                    statusFilter === f
                      ? 'bg-slate-200 text-slate-800'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {f}
                  {f !== 'all' && s ? ` (${s[f as keyof typeof s] ?? 0})` : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Per-Case Comparison Table */}
      {view === 'cases' && result && (
        <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Case</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 max-w-[200px]">Query</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">
                  Base #{result.base.id}
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">
                  Target #{result.target.id}
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Delta</th>
                <th className="px-4 py-2 text-center text-xs font-medium text-slate-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredCases.map(c => (
                <CaseRow key={c.case_key} c={c} />
              ))}
            </tbody>
          </table>
          {filteredCases.length === 0 && (
            <div className="text-center text-slate-400 py-8 text-sm">
              No cases match filter "{statusFilter}"
            </div>
          )}
        </div>
      )}

      {/* Per-Grader Comparison (from summary) */}
      {view === 'graders' && result && (
        <div className="text-slate-400 text-center py-8 text-sm">
          Per-grader comparison requires full trace data.
          Use the experiment detail pages to see grader breakdowns.
        </div>
      )}
    </div>
  )
}


function CaseRow({ c }: { c: CompareCase }) {
  const statusColors: Record<string, string> = {
    improved: 'text-emerald-600 bg-emerald-50',
    regressed: 'text-red-600 bg-red-50',
    unchanged: 'text-slate-500',
    new: 'text-blue-600 bg-blue-50',
    removed: 'text-slate-400',
  }

  return (
    <tr className={c.status === 'regressed' ? 'bg-red-50/50' : c.status === 'improved' ? 'bg-emerald-50/30' : ''}>
      <td className="px-4 py-2 font-medium text-slate-700">
        <Link to={`/traces?case_key=${c.case_key}`} className="text-blue-600 hover:underline text-xs">
          {c.case_key}
        </Link>
      </td>
      <td className="px-4 py-2 text-xs text-slate-500 max-w-[200px] truncate" title={c.query}>
        {c.query}
      </td>
      <td className="px-4 py-2 text-right tabular-nums">
        {c.base_score !== null ? (
          <span className={c.base_pass ? 'text-emerald-600' : 'text-red-500'}>
            {c.base_score.toFixed(1)}
          </span>
        ) : <span className="text-slate-300">-</span>}
      </td>
      <td className="px-4 py-2 text-right tabular-nums">
        {c.target_score !== null ? (
          <span className={c.target_pass ? 'text-emerald-600' : 'text-red-500'}>
            {c.target_score.toFixed(1)}
          </span>
        ) : <span className="text-slate-300">-</span>}
      </td>
      <td className={`px-4 py-2 text-right tabular-nums font-medium ${
        !c.delta ? 'text-slate-300'
          : c.delta > 0 ? 'text-emerald-600'
          : c.delta < -5 ? 'text-red-600'
          : c.delta < 0 ? 'text-amber-600'
          : 'text-slate-400'
      }`}>
        {c.delta !== null ? `${c.delta > 0 ? '+' : ''}${c.delta.toFixed(1)}` : '-'}
      </td>
      <td className="px-4 py-2 text-center">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[c.status] || ''}`}>
          {c.status.toUpperCase()}
        </span>
      </td>
    </tr>
  )
}
