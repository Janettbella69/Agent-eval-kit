import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { listExperiments, getExperiment, startTraceAnalysis, getAnalysisResult } from '../lib/api.ts'
import type { Experiment, Trace } from '../types.ts'

export default function AnalyzePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [loaded, setLoaded] = useState<Map<number, Experiment>>(new Map())
  const [loading, setLoading] = useState(true)

  // Load experiment list
  useEffect(() => {
    listExperiments().then(setExperiments).finally(() => setLoading(false))
  }, [])

  // Restore selection from URL
  useEffect(() => {
    const ids = searchParams.get('experiment_id')
    if (ids) {
      setSelected(new Set(ids.split(',').map(Number).filter(Boolean)))
    }
  }, [searchParams])

  // Fetch full experiment data when selection changes
  useEffect(() => {
    const toLoad = Array.from(selected).filter(id => !loaded.has(id))
    if (toLoad.length === 0) return
    Promise.all(toLoad.map(id => getExperiment(id))).then(exps => {
      setLoaded(prev => {
        const next = new Map(prev)
        for (const e of exps) next.set(e.id, e)
        return next
      })
    })
  }, [selected, loaded])

  const toggleExperiment = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      const ids = Array.from(next).join(',')
      setSearchParams(ids ? { experiment_id: ids } : {})
      return next
    })
  }

  // Aggregate traces from selected experiments
  const allTraces = useMemo(() => {
    const traces: Trace[] = []
    for (const id of selected) {
      const exp = loaded.get(id)
      if (exp?.traces) traces.push(...exp.traces)
    }
    return traces
  }, [selected, loaded])

  // Failure funnel distribution
  const funnelDist = useMemo(() => {
    const dist: Record<string, number> = {}
    for (const t of allTraces) {
      const stage = t.failure_funnel?.stage
      if (stage) dist[stage] = (dist[stage] || 0) + 1
    }
    return dist
  }, [allTraces])

  // Per-grader score aggregation
  const graderStats = useMemo(() => {
    const scores: Record<string, number[]> = {}
    for (const t of allTraces) {
      if (!t.composite_scores) continue
      for (const [name, g] of Object.entries(t.composite_scores)) {
        if (!scores[name]) scores[name] = []
        scores[name].push(g.score)
      }
    }
    const stats: Record<string, { min: number; q1: number; median: number; q3: number; max: number; mean: number; count: number }> = {}
    for (const [name, vals] of Object.entries(scores)) {
      const sorted = [...vals].sort((a, b) => a - b)
      const n = sorted.length
      stats[name] = {
        min: sorted[0],
        q1: sorted[Math.floor(n * 0.25)],
        median: sorted[Math.floor(n * 0.5)],
        q3: sorted[Math.floor(n * 0.75)],
        max: sorted[n - 1],
        mean: sorted.reduce((a, b) => a + b, 0) / n,
        count: n,
      }
    }
    return stats
  }, [allTraces])

  // Error type classification
  const errorTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const t of allTraces) {
      if (!t.error_types) continue
      for (const et of t.error_types) {
        counts[et] = (counts[et] || 0) + 1
      }
    }
    return Object.entries(counts).sort(([, a], [, b]) => b - a)
  }, [allTraces])

  if (loading) return <div className="text-slate-400">Loading...</div>

  const completedExperiments = experiments.filter(e => e.status === 'complete' || e.status === 'paused')

  return (
    <div className="space-y-6 animate-fadeIn">
      <h1 className="text-2xl font-bold text-slate-900">Analyze</h1>

      {/* Experiment Selector */}
      <div className="rounded-xl bg-white border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Select Experiments</h3>
        <div className="flex flex-wrap gap-2">
          {completedExperiments.map(e => (
            <button
              key={e.id}
              onClick={() => toggleExperiment(e.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                selected.has(e.id)
                  ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              #{e.id} {e.tag || `Dataset ${e.dataset_id}`}
            </button>
          ))}
          {completedExperiments.length === 0 && (
            <div className="text-sm text-slate-400">No completed experiments found.</div>
          )}
        </div>
      </div>

      {selected.size === 0 && (
        <div className="text-center text-slate-400 py-12">
          Select one or more experiments above to analyze.
        </div>
      )}

      {selected.size > 0 && allTraces.length > 0 && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl bg-white border border-slate-200 p-3 text-center">
              <div className="text-xs text-slate-500 mb-1">Experiments</div>
              <div className="text-2xl font-bold text-slate-900">{selected.size}</div>
            </div>
            <div className="rounded-xl bg-white border border-slate-200 p-3 text-center">
              <div className="text-xs text-slate-500 mb-1">Total Traces</div>
              <div className="text-2xl font-bold text-slate-900">{allTraces.length}</div>
            </div>
            <div className="rounded-xl bg-white border border-slate-200 p-3 text-center">
              <div className="text-xs text-slate-500 mb-1">Avg Score</div>
              <div className="text-2xl font-bold text-emerald-600">
                {allTraces.length > 0
                  ? Math.round(allTraces.reduce((s, t) => s + t.final_score, 0) / allTraces.length)
                  : '—'}
              </div>
            </div>
            <div className="rounded-xl bg-white border border-slate-200 p-3 text-center">
              <div className="text-xs text-slate-500 mb-1">Pass Rate</div>
              <div className="text-2xl font-bold text-emerald-600">
                {allTraces.length > 0
                  ? Math.round((allTraces.filter(t => t.final_pass).length / allTraces.length) * 100)
                  : 0}%
              </div>
            </div>
          </div>

          {/* Failure Funnel Distribution */}
          {Object.keys(funnelDist).length > 0 && (
            <div className="rounded-xl bg-white border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Failure Funnel Distribution</h3>
              <FunnelDistChart dist={funnelDist} total={allTraces.filter(t => !t.final_pass).length} />
            </div>
          )}

          {/* Per-Grader Score Distribution */}
          {Object.keys(graderStats).length > 0 && (
            <div className="rounded-xl bg-white border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Per-Grader Score Distribution</h3>
              <div className="space-y-3">
                {Object.entries(graderStats)
                  .sort(([, a], [, b]) => b.median - a.median)
                  .map(([name, s]) => (
                    <div key={name} className="flex items-center gap-3">
                      <span className="w-40 text-xs text-slate-500 truncate" title={name}>
                        {name.replace(/_/g, ' ')}
                      </span>
                      <div className="flex-1 relative h-6">
                        {/* Background */}
                        <div className="absolute inset-0 rounded bg-slate-100" />
                        {/* IQR box */}
                        <div
                          className="absolute top-0.5 bottom-0.5 rounded bg-blue-200"
                          style={{ left: `${s.q1}%`, width: `${Math.max(s.q3 - s.q1, 1)}%` }}
                        />
                        {/* Whiskers */}
                        <div
                          className="absolute top-2.5 h-1 bg-slate-300"
                          style={{ left: `${s.min}%`, width: `${Math.max(s.q1 - s.min, 0.5)}%` }}
                        />
                        <div
                          className="absolute top-2.5 h-1 bg-slate-300"
                          style={{ left: `${s.q3}%`, width: `${Math.max(s.max - s.q3, 0.5)}%` }}
                        />
                        {/* Median line */}
                        <div
                          className="absolute top-0 bottom-0 w-0.5 bg-blue-700"
                          style={{ left: `${s.median}%` }}
                        />
                      </div>
                      <span className="w-20 text-right text-xs tabular-nums text-slate-700">
                        med={s.median.toFixed(0)} ({s.count})
                      </span>
                    </div>
                  ))}
              </div>
              <div className="mt-3 flex gap-4 text-[10px] text-slate-400">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-2 rounded bg-blue-200 inline-block" /> IQR (Q1-Q3)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-0.5 bg-slate-300 inline-block" /> Min-Max
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-0.5 h-3 bg-blue-700 inline-block" /> Median
                </span>
              </div>
            </div>
          )}

          {/* Error Type Classification */}
          {errorTypeCounts.length > 0 && (
            <div className="rounded-xl bg-white border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Error Type Classification</h3>
              <div className="space-y-1.5">
                {errorTypeCounts.slice(0, 20).map(([type, count]) => {
                  const maxCount = errorTypeCounts[0][1]
                  return (
                    <div key={type} className="flex items-center gap-3">
                      <span className="w-48 text-xs text-slate-600 truncate" title={type}>
                        {type}
                      </span>
                      <div className="flex-1 h-5 rounded bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded bg-red-400 transition-all"
                          style={{ width: `${(count / maxCount) * 100}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-xs font-medium tabular-nums text-slate-700">
                        {count}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Per-Experiment Breakdown */}
          <div className="rounded-xl bg-white border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Per-Experiment Summary</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Experiment</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Cases</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Avg Score</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Pass Rate</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {Array.from(selected).map(id => {
                  const exp = loaded.get(id)
                  if (!exp) return null
                  const s = exp.summary
                  return (
                    <tr key={id} className="hover:bg-slate-25">
                      <td className="px-3 py-2">
                        <Link to={`/experiments/${id}`} className="text-blue-600 hover:underline text-sm font-medium">
                          #{id} {exp.tag || ''}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{s.total_cases}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className={s.avg_score >= 70 ? 'text-emerald-600' : s.avg_score >= 40 ? 'text-amber-600' : 'text-red-600'}>
                          {s.avg_score.toFixed(1)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {s.total_cases > 0 ? Math.round((s.passed / s.total_cases) * 100) : 0}%
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={`text-xs font-medium ${
                          exp.status === 'complete' ? 'text-emerald-600' : 'text-amber-600'
                        }`}>
                          {exp.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* AI Analysis Chat */}
          <AIAnalysisChat traceIds={allTraces.map(t => t.id)} />
        </>
      )}
    </div>
  )
}

function FunnelDistChart({ dist, total }: { dist: Record<string, number>; total: number }) {
  const stages = ['understand', 'search', 'extract', 'match_rubric', 'generate']
  const maxCount = Math.max(...Object.values(dist), 1)

  return (
    <div className="flex gap-4 items-end">
      {stages.map(stage => {
        const count = dist[stage] || 0
        const pct = total > 0 ? Math.round((count / total) * 100) : 0
        const height = Math.max((count / maxCount) * 120, count > 0 ? 20 : 4)
        return (
          <div key={stage} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-xs font-bold tabular-nums text-red-600">
              {count > 0 ? count : ''}
            </span>
            <div
              className={`w-full rounded-t transition-all ${
                count > 0 ? 'bg-red-400' : 'bg-slate-100'
              }`}
              style={{ height: `${height}px` }}
            />
            <span className="text-[10px] text-slate-500 text-center leading-tight">
              {stage.replace('_', '\n')}
            </span>
            {count > 0 && (
              <span className="text-[10px] text-slate-400">{pct}%</span>
            )}
          </div>
        )
      })}
    </div>
  )
}


/* ── AI Analysis Chat ── */

function AIAnalysisChat({ traceIds }: { traceIds: number[] }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)

  const handleAsk = useCallback(async () => {
    if (!question.trim() || traceIds.length === 0) return
    setLoading(true)
    setAnswer('')
    try {
      const { request_id } = await startTraceAnalysis(traceIds.slice(0, 5), question)
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const result = await getAnalysisResult(request_id)
        if (result.status === 'done') { setAnswer(result.result || 'No result.'); break }
        if (result.status === 'error') { setAnswer(`Error: ${result.error || 'Unknown'}`); break }
      }
      if (!answer) setAnswer('Timeout.')
    } catch (e) {
      setAnswer(`Failed: ${e instanceof Error ? e.message : 'unknown'}`)
    } finally {
      setLoading(false)
    }
  }, [question, traceIds, answer])

  return (
    <div className="rounded-xl bg-white border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
        <span className="material-symbols-outlined text-emerald-600" style={{ fontSize: '18px' }}>auto_awesome</span>
        AI 分析
      </h3>
      {!answer && !loading && (
        <div className="flex flex-wrap gap-2 mb-4">
          {['为什么通过率低？', '最常见的失败模式？', '搜索策略有什么问题？', '哪些产品类别最差？'].map(s => (
            <button key={s} onClick={() => setQuestion(s)}
              className="px-3 py-1.5 rounded-lg bg-slate-50 text-xs text-slate-600 hover:bg-slate-100 transition-colors">{s}</button>
          ))}
        </div>
      )}
      <div className="flex gap-2 mb-4">
        <input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAsk()}
          placeholder="输入问题，AI 将分析选定的 traces..."
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
          disabled={loading || traceIds.length === 0} />
        <button onClick={handleAsk} disabled={loading || !question.trim() || traceIds.length === 0}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
          {loading ? '分析中...' : '分析'}
        </button>
      </div>
      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
          <span className="material-symbols-outlined animate-spin" style={{ fontSize: '16px' }}>progress_activity</span>
          GPT-5.4 正在分析 {traceIds.length} 条 traces...
        </div>
      )}
      {answer && (
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 prose prose-slate prose-sm max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}
