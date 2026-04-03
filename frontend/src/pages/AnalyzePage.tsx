import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { listExperiments, getExperiment, startTraceAnalysis, getAnalysisResult } from '../lib/api.ts'
import ScoreBadge from '../components/ScoreBadge.tsx'
import type { Experiment, Trace } from '../types.ts'

export default function AnalyzePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [loaded, setLoaded] = useState<Map<number, Experiment>>(new Map())
  const [loading, setLoading] = useState(true)
  const [caseFilter, setCaseFilter] = useState<'all' | 'pass' | 'fail'>('all')
  const [selectedCases, setSelectedCases] = useState<Set<number>>(new Set())

  // Chat state (lifted from AIAnalysisChat for fixed bottom bar)
  const [chatQuestion, setChatQuestion] = useState('')
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { listExperiments().then(setExperiments).finally(() => setLoading(false)) }, [])

  useEffect(() => {
    const ids = searchParams.get('experiment_id')
    if (ids) setSelected(new Set(ids.split(',').map(Number).filter(Boolean)))
  }, [searchParams])

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
      if (next.has(id)) next.delete(id); else next.add(id)
      setSearchParams(next.size > 0 ? { experiment_id: Array.from(next).join(',') } : {})
      return next
    })
  }

  const allTraces = useMemo(() => {
    const traces: Trace[] = []
    for (const id of selected) { const exp = loaded.get(id); if (exp?.traces) traces.push(...exp.traces) }
    return traces
  }, [selected, loaded])

  const filteredTraces = useMemo(() => {
    if (caseFilter === 'pass') return allTraces.filter(t => t.final_pass)
    if (caseFilter === 'fail') return allTraces.filter(t => !t.final_pass)
    return allTraces
  }, [allTraces, caseFilter])

  const funnelDist = useMemo(() => {
    const dist: Record<string, number> = {}
    for (const t of allTraces) { const stage = t.failure_funnel?.stage; if (stage) dist[stage] = (dist[stage] || 0) + 1 }
    return dist
  }, [allTraces])

  const graderStats = useMemo(() => {
    const scores: Record<string, number[]> = {}
    for (const t of allTraces) {
      if (!t.composite_scores) continue
      for (const [name, g] of Object.entries(t.composite_scores)) { if (!scores[name]) scores[name] = []; scores[name].push(g.score) }
    }
    const stats: Record<string, { min: number; q1: number; median: number; q3: number; max: number; mean: number; count: number }> = {}
    for (const [name, vals] of Object.entries(scores)) {
      const sorted = [...vals].sort((a, b) => a - b); const n = sorted.length
      stats[name] = { min: sorted[0], q1: sorted[Math.floor(n * 0.25)], median: sorted[Math.floor(n * 0.5)], q3: sorted[Math.floor(n * 0.75)], max: sorted[n - 1], mean: sorted.reduce((a, b) => a + b, 0) / n, count: n }
    }
    return stats
  }, [allTraces])

  const errorTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const t of allTraces) { if (!t.error_types) continue; for (const et of t.error_types) counts[et] = (counts[et] || 0) + 1 }
    return Object.entries(counts).sort(([, a], [, b]) => b - a)
  }, [allTraces])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMessages])

  const analysisTraceIds = selectedCases.size > 0 ? Array.from(selectedCases) : allTraces.map(t => t.id)

  const handleChatAsk = useCallback(async (q?: string) => {
    const text = q || chatQuestion.trim()
    if (!text || analysisTraceIds.length === 0) return
    setChatQuestion('')
    setChatMessages(prev => [...prev, { role: 'user', content: text }])
    setChatLoading(true)
    try {
      const contextPrefix = chatMessages.length > 0
        ? `Previous conversation:\n${chatMessages.map(m => `${m.role === 'user' ? 'Q' : 'A'}: ${m.content}`).join('\n')}\n\nNew question: `
        : ''
      const { request_id } = await startTraceAnalysis(analysisTraceIds.slice(0, 10), contextPrefix + text)
      let result = ''
      for (let i = 0; i < 90; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const res = await getAnalysisResult(request_id)
        if (res.status === 'done') { result = res.result || 'No result.'; break }
        if (res.status === 'error') { result = `Error: ${res.error || 'Unknown'}`; break }
      }
      if (!result) result = 'Analysis timed out.'
      setChatMessages(prev => [...prev, { role: 'assistant', content: result }])
    } catch (e) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Failed: ${e instanceof Error ? e.message : 'unknown'}` }])
    } finally {
      setChatLoading(false)
    }
  }, [chatQuestion, analysisTraceIds, chatMessages])

  if (loading) return <div className="text-slate-400">Loading...</div>
  const completedExperiments = experiments.filter(e => e.status === 'complete' || e.status === 'paused')
  const passCount = allTraces.filter(t => t.final_pass).length
  const failCount = allTraces.length - passCount

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 48px)' }}>
      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto space-y-5 p-1">
        <h1 className="text-2xl font-bold text-slate-900">Analyze</h1>

        {/* ── Experiment selector (checkbox table) ── */}
        <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">实验选择</h3>
            <span className="text-[10px] text-slate-400">{selected.size} selected</span>
          </div>
          <div className="max-h-52 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b border-slate-100">
                  <th className="w-10 px-3 py-2"></th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-400 uppercase">ID</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-400 uppercase">Tag</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-400 uppercase">Cases</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-400 uppercase">Score</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-400 uppercase">Pass%</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-400 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {completedExperiments.map(e => {
                  const s = e.summary
                  const isSelected = selected.has(e.id)
                  return (
                    <tr key={e.id} onClick={() => toggleExperiment(e.id)}
                      className={`cursor-pointer transition-colors ${isSelected ? 'bg-emerald-50' : 'hover:bg-slate-50/60'}`}>
                      <td className="px-3 py-2 text-center">
                        <input type="checkbox" checked={isSelected} onChange={() => {}} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-500">#{e.id}</td>
                      <td className="px-3 py-2 text-slate-700 font-medium truncate max-w-[200px]">{e.tag || `Dataset ${e.dataset_id}`}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{s?.total_cases ?? '—'}</td>
                      <td className="px-3 py-2 text-right">
                        {s ? <ScoreBadge score={s.avg_score} pass={s.avg_score >= 60} size="sm" /> : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                        {s && s.total_cases > 0 ? `${Math.round((s.passed / s.total_cases) * 100)}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={`text-[10px] font-medium ${e.status === 'complete' ? 'text-emerald-600' : 'text-amber-600'}`}>{e.status}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {completedExperiments.length === 0 && (
              <div className="text-center text-sm text-slate-400 py-6">No completed experiments found.</div>
            )}
          </div>
        </div>

        {selected.size > 0 && allTraces.length > 0 && (
          <>
            {/* ── Summary stats ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Experiments', value: selected.size, color: 'text-slate-900' },
                { label: 'Total Traces', value: allTraces.length, color: 'text-slate-900' },
                { label: 'Avg Score', value: Math.round(allTraces.reduce((s, t) => s + t.final_score, 0) / allTraces.length), color: 'text-emerald-600' },
                { label: 'Pass Rate', value: `${Math.round((passCount / allTraces.length) * 100)}%`, color: 'text-emerald-600' },
              ].map(s => (
                <div key={s.label} className="rounded-xl bg-white border border-slate-200 p-3 text-center">
                  <div className="text-xs text-slate-500 mb-1">{s.label}</div>
                  <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* ── Charts row (funnel + grader box plots side by side) ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {Object.keys(funnelDist).length > 0 && (
                <div className="rounded-xl bg-white border border-slate-200 p-4">
                  <h3 className="text-sm font-semibold text-slate-700 mb-4">Failure Funnel</h3>
                  <FunnelDistChart dist={funnelDist} total={failCount} />
                </div>
              )}
              {errorTypeCounts.length > 0 && (
                <div className="rounded-xl bg-white border border-slate-200 p-4">
                  <h3 className="text-sm font-semibold text-slate-700 mb-4">Error Types (Top 10)</h3>
                  <div className="space-y-1">
                    {errorTypeCounts.slice(0, 10).map(([type, count]) => (
                      <div key={type} className="flex items-center gap-2">
                        <span className="w-36 text-[11px] text-slate-600 truncate" title={type}>{type}</span>
                        <div className="flex-1 h-4 rounded bg-slate-100 overflow-hidden">
                          <div className="h-full rounded bg-red-400" style={{ width: `${(count / errorTypeCounts[0][1]) * 100}%` }} />
                        </div>
                        <span className="w-6 text-right text-[10px] tabular-nums text-slate-700">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Grader box plots ── */}
            {Object.keys(graderStats).length > 0 && (
              <div className="rounded-xl bg-white border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">Per-Grader Distribution</h3>
                <div className="space-y-2">
                  {Object.entries(graderStats).sort(([, a], [, b]) => b.median - a.median).map(([name, s]) => (
                    <div key={name} className="flex items-center gap-3">
                      <span className="w-32 text-xs text-slate-500 truncate">{name.replace(/_/g, ' ')}</span>
                      <div className="flex-1 relative h-5">
                        <div className="absolute inset-0 rounded bg-slate-100" />
                        <div className="absolute top-0.5 bottom-0.5 rounded bg-blue-200" style={{ left: `${s.q1}%`, width: `${Math.max(s.q3 - s.q1, 1)}%` }} />
                        <div className="absolute top-2 h-1 bg-slate-300" style={{ left: `${s.min}%`, width: `${Math.max(s.q1 - s.min, 0.5)}%` }} />
                        <div className="absolute top-2 h-1 bg-slate-300" style={{ left: `${s.q3}%`, width: `${Math.max(s.max - s.q3, 0.5)}%` }} />
                        <div className="absolute top-0 bottom-0 w-0.5 bg-blue-700" style={{ left: `${s.median}%` }} />
                      </div>
                      <span className="w-16 text-right text-[10px] tabular-nums text-slate-600">med={s.median.toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Case table (with checkbox selection) ── */}
            <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-slate-700">Cases</h3>
                  <div className="flex rounded-lg bg-slate-100 p-0.5">
                    {([['all', `全部 (${allTraces.length})`], ['fail', `失败 (${failCount})`], ['pass', `通过 (${passCount})`]] as const).map(([key, label]) => (
                      <button key={key} onClick={() => setCaseFilter(key)}
                        className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${caseFilter === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selectedCases.size > 0 && (
                    <span className="text-[10px] text-emerald-600 font-medium">{selectedCases.size} selected for AI analysis</span>
                  )}
                  {selectedCases.size > 0 && (
                    <button onClick={() => setSelectedCases(new Set())} className="text-[10px] text-slate-400 hover:text-slate-600">Clear</button>
                  )}
                </div>
              </div>
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="border-b border-slate-100">
                      <th className="w-8 px-2 py-2"></th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-400">Case</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-400">Query</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-400">Score</th>
                      <th className="px-3 py-2 text-center text-[10px] font-semibold text-slate-400">Pass</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-400">Duration</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-400">Products</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredTraces.slice(0, 100).map(t => {
                      const isCaseSelected = selectedCases.has(t.id)
                      return (
                        <tr key={t.id} onClick={() => setSelectedCases(prev => {
                          const next = new Set(prev); if (next.has(t.id)) next.delete(t.id); else next.add(t.id); return next
                        })} className={`cursor-pointer transition-colors ${isCaseSelected ? 'bg-blue-50' : 'hover:bg-slate-50/60'}`}>
                          <td className="px-2 py-1.5 text-center">
                            <input type="checkbox" checked={isCaseSelected} onChange={() => {}} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                          </td>
                          <td className="px-3 py-1.5 font-mono text-slate-600">{t.case_key}</td>
                          <td className="px-3 py-1.5 text-slate-700 max-w-xs truncate">{t.query}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            <span className={t.final_score >= 70 ? 'text-emerald-600' : t.final_score >= 40 ? 'text-amber-600' : 'text-red-600'}>{t.final_score.toFixed(0)}</span>
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <span className={`inline-block w-2 h-2 rounded-full ${t.final_pass ? 'bg-emerald-400' : 'bg-red-400'}`} />
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{t.duration_s.toFixed(0)}s</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{t.products.length}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Chat messages area ── */}
            {chatMessages.length > 0 && (
              <div className="rounded-xl bg-white border border-slate-200 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <span className="material-symbols-outlined text-emerald-600" style={{ fontSize: '18px' }}>auto_awesome</span>
                    AI 分析
                  </h3>
                  <button onClick={() => setChatMessages([])} className="text-[10px] text-slate-400 hover:text-slate-600">Clear</button>
                </div>
                {chatMessages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-xl px-4 py-3 ${m.role === 'user' ? 'bg-emerald-600 text-white' : 'bg-slate-50 border border-slate-200'}`}>
                      {m.role === 'assistant' ? (
                        <div className="prose prose-slate prose-sm max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
                      ) : (
                        <div className="text-sm">{m.content}</div>
                      )}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 flex items-center gap-2 text-sm text-slate-400">
                      <span className="material-symbols-outlined animate-spin" style={{ fontSize: '16px' }}>progress_activity</span>
                      分析中 ({analysisTraceIds.length} traces)...
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}
          </>
        )}

        {selected.size === 0 && (
          <div className="text-center text-slate-400 py-12">Select experiments above to start analysis.</div>
        )}
      </div>

      {/* ── Fixed bottom chat bar ── */}
      {allTraces.length > 0 && (
        <div className="flex-none border-t border-slate-200 bg-white">
          {/* Preset suggestions */}
          {chatMessages.length === 0 && (
            <div className="px-4 pt-2 flex flex-wrap gap-1.5">
              {['为什么通过率低？', '最常见的失败模式？', '搜索策略问题', '哪些产品类别最差？', '对比不同实验'].map(s => (
                <button key={s} onClick={() => handleChatAsk(s)}
                  className="px-2.5 py-1 rounded-lg bg-slate-50 text-[10px] text-slate-500 hover:bg-slate-100">{s}</button>
              ))}
            </div>
          )}
          <div className="px-4 py-3 flex gap-2 items-center">
            {selectedCases.size > 0 && (
              <span className="px-2 py-1 rounded bg-blue-50 text-blue-600 text-[10px] font-medium flex-none">
                {selectedCases.size} cases
              </span>
            )}
            <input value={chatQuestion} onChange={e => setChatQuestion(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleChatAsk()}
              placeholder={selectedCases.size > 0 ? `分析选中的 ${selectedCases.size} 个 case...` : `分析全部 ${allTraces.length} traces...`}
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
              disabled={chatLoading} />
            <button onClick={() => handleChatAsk()} disabled={chatLoading || !chatQuestion.trim()}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 flex-none">
              {chatLoading ? '...' : '发送'}
            </button>
          </div>
        </div>
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
        const height = Math.max((count / maxCount) * 100, count > 0 ? 16 : 4)
        return (
          <div key={stage} className="flex-1 flex flex-col items-center gap-1">
            {count > 0 && <span className="text-xs font-bold tabular-nums text-red-600">{count}</span>}
            <div className={`w-full rounded-t transition-all ${count > 0 ? 'bg-red-400' : 'bg-slate-100'}`} style={{ height: `${height}px` }} />
            <span className="text-[10px] text-slate-500 text-center leading-tight">{stage.replace('_', ' ')}</span>
            {count > 0 && <span className="text-[10px] text-slate-400">{pct}%</span>}
          </div>
        )
      })}
    </div>
  )
}
