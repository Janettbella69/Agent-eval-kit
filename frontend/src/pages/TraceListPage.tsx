import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { listAllTraces } from '../lib/api.ts'
import ScoreBadge from '../components/ScoreBadge.tsx'
import type { TraceListItem } from '../lib/api.ts'

export default function TraceListPage() {
  const [traces, setTraces] = useState<TraceListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [caseTypeFilter, setCaseTypeFilter] = useState('')
  const [humanPassFilter, setHumanPassFilter] = useState('')
  const [modelFilter, setModelFilter] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    setLoading(true)
    listAllTraces(200, statusFilter, caseTypeFilter, humanPassFilter, modelFilter)
      .then(data => setTraces(data.traces))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [statusFilter, caseTypeFilter, humanPassFilter, modelFilter])

  return (
    <div className="animate-fadeIn">
      <nav className="flex items-center gap-2 text-sm text-slate-400 mb-6">
        <span>观测</span>
        <span>/</span>
        <span className="text-slate-700 font-medium">Trace</span>
      </nav>

      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-slate-900">Trace</h1>
        <span className="text-xs text-slate-400">{traces.length} traces</span>
      </div>
      <p className="text-sm text-slate-400 mb-6">追踪和分析 Agent 的完整执行过程</p>

      {/* Filter toolbar */}
      <div className="rounded-xl bg-white border border-slate-200 p-3 mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filtersOpen ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>filter_list</span>
            过滤器
          </button>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600"
          >
            <option value="">全部状态</option>
            <option value="graded">Graded</option>
            <option value="done">Done</option>
            <option value="collected">Collected</option>
            <option value="error">Error</option>
            <option value="running">Running</option>
          </select>
          <div className="flex-1" />
          <button
            onClick={() => { setLoading(true); listAllTraces(200, statusFilter, caseTypeFilter, humanPassFilter, modelFilter).then(d => setTraces(d.traces)).finally(() => setLoading(false)) }}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>refresh</span>
          </button>
        </div>

        {filtersOpen && (
          <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-medium text-slate-400 mb-1 block">Case Type</label>
              <select value={caseTypeFilter} onChange={e => setCaseTypeFilter(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm">
                <option value="">全部</option>
                <option value="production">Production</option>
                <option value="clear_en">Clear EN</option>
                <option value="clear_zh">Clear ZH</option>
                <option value="trap">Trap</option>
                <option value="negative">Negative</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-slate-400 mb-1 block">Human Verdict</label>
              <select value={humanPassFilter} onChange={e => setHumanPassFilter(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm">
                <option value="">全部</option>
                <option value="pass">Pass</option>
                <option value="fail">Fail</option>
                <option value="none">未标注</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-slate-400 mb-1 block">Model</label>
              <select value={modelFilter} onChange={e => setModelFilter(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm">
                <option value="">全部</option>
                <option value="claude">Claude</option>
                <option value="minimax">MiniMax</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-slate-400">
          <span className="material-symbols-outlined animate-spin mr-2" style={{ fontSize: '20px' }}>progress_activity</span>
          加载中...
        </div>
      ) : traces.length > 0 ? (
        <div className="rounded-xl bg-white border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80">
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase">Trace</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase">Score</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase">Human</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase">Status</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase">Prods</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase">Srcs</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase">Guide</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase">Time</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase">Tokens</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase">Model</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {traces.map(t => (
                <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-3 py-2.5">
                    <Link to={`/traces/${t.id}`} className="text-blue-600 hover:underline font-medium text-xs">
                      {t.case_key}
                    </Link>
                    <div className="text-[10px] text-slate-400 truncate max-w-[220px] mt-0.5">{t.query}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <ScoreBadge score={t.final_score} pass={t.final_pass} size="sm" />
                  </td>
                  <td className="px-3 py-2.5">
                    {t.human_pass === true ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700">P</span>
                    ) : t.human_pass === false ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-700">F</span>
                    ) : (
                      <span className="text-slate-300 text-[10px]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      t.status === 'graded' ? 'bg-emerald-50 text-emerald-700'
                        : t.status === 'done' || t.status === 'collected' ? 'bg-blue-50 text-blue-700'
                        : t.status === 'error' ? 'bg-red-50 text-red-700'
                        : 'bg-slate-100 text-slate-500'
                    }`}>{t.status}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600 text-center">{t.product_count}</td>
                  <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600 text-center">{t.source_count}</td>
                  <td className="px-3 py-2.5 text-[10px] tabular-nums text-slate-500">
                    {t.guide_length > 0 ? `${(t.guide_length / 1000).toFixed(1)}k` : '-'}
                  </td>
                  <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600">
                    {t.duration_s > 0 ? `${t.duration_s.toFixed(0)}s` : '-'}
                  </td>
                  <td className="px-3 py-2.5 text-[10px] tabular-nums text-slate-500">
                    {(t.input_tokens + t.output_tokens) > 0 ? `${((t.input_tokens + t.output_tokens) / 1000).toFixed(0)}k` : '-'}
                  </td>
                  <td className="px-3 py-2.5 text-[10px] font-mono text-slate-400 truncate max-w-[100px]">
                    {t.model ? t.model.replace('langfuse:', 'lf:') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl bg-white border border-slate-200 py-16 text-center">
          <span className="material-symbols-outlined text-slate-300 mb-2 block" style={{ fontSize: '32px' }}>timeline</span>
          <div className="text-sm font-medium text-slate-700 mb-1">暂无数据</div>
          <div className="text-xs text-slate-400">运行实验或导入生产 traces 后在此查看</div>
        </div>
      )}
    </div>
  )
}
