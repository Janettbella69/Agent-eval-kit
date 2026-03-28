import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { listExperiments } from '../lib/api.ts'
import ScoreBadge from '../components/ScoreBadge.tsx'
import type { Experiment, Trace } from '../types.ts'

export default function TraceListPage() {
  const [, setExperiments] = useState<Experiment[]>([])
  const [traces, setTraces] = useState<Trace[]>([])
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState('3d')
  const [spanType, setSpanType] = useState('all')
  const [source, setSource] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    listExperiments().then(exps => {
      setExperiments(exps)
      // Collect all traces from completed experiments
      const allTraces: Trace[] = []
      for (const exp of exps) {
        if (exp.traces) {
          allTraces.push(...exp.traces)
        }
      }
      setTraces(allTraces)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <span className="material-symbols-outlined animate-spin mr-2" style={{ fontSize: '20px' }}>progress_activity</span>
        加载中...
      </div>
    )
  }

  return (
    <div className="animate-fadeIn">
      <nav className="flex items-center gap-2 text-sm text-slate-400 mb-6">
        <span>观测</span>
        <span>/</span>
        <span className="text-slate-700 font-medium">Trace</span>
      </nav>

      <h1 className="text-2xl font-bold text-slate-900 mb-2">Trace</h1>
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
            value={timeRange}
            onChange={e => setTimeRange(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600"
          >
            <option value="1h">过去 1 小时</option>
            <option value="24h">过去 24 小时</option>
            <option value="3d">过去 3 天</option>
            <option value="7d">过去 7 天</option>
            <option value="30d">过去 30 天</option>
          </select>
          <select
            value={spanType}
            onChange={e => setSpanType(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600"
          >
            <option value="all">All Span</option>
            <option value="llm">LLM Span</option>
            <option value="tool">Tool Span</option>
            <option value="agent">Agent Span</option>
          </select>
          <select
            value={source}
            onChange={e => setSource(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600"
          >
            <option value="all">全部来源</option>
            <option value="eval">评测</option>
            <option value="production">生产</option>
          </select>
          <div className="flex-1" />
          <button className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>refresh</span>
          </button>
        </div>

        {/* Expanded filters */}
        {filtersOpen && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <div className="grid grid-cols-3 gap-4 mb-3">
              <div>
                <label className="text-[10px] font-medium text-slate-400 mb-1 block">Trace ID</label>
                <input placeholder="输入 Trace ID..." className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-emerald-200" />
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-400 mb-1 block">状态</label>
                <select className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm">
                  <option value="">全部</option>
                  <option value="graded">Graded</option>
                  <option value="done">Done</option>
                  <option value="error">Error</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-400 mb-1 block">Case Type</label>
                <select className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm">
                  <option value="">全部</option>
                  <option value="production">Production</option>
                  <option value="shoppingcomp">ShoppingComp</option>
                  <option value="trap">Trap</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1 rounded-lg text-xs text-slate-500 hover:bg-slate-100 transition-colors">重置</button>
              <button className="px-3 py-1 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">应用筛选</button>
            </div>
          </div>
        )}
      </div>

      {/* Trace table */}
      {traces.length > 0 ? (
        <div className="rounded-xl bg-white border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80">
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase">Trace</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase">Score</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase">Status</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase">Products</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase">Sources</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {traces.map(t => (
                <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-3 py-2.5">
                    <Link to={`/traces/${t.id}`} className="text-blue-600 hover:underline font-medium text-xs">{t.case_key}</Link>
                    <div className="text-[10px] text-slate-400 truncate max-w-[250px] mt-0.5">{t.query}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <ScoreBadge score={t.final_score} pass={t.final_pass} size="sm" />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      t.status === 'graded' ? 'bg-emerald-50 text-emerald-700'
                        : t.status === 'error' ? 'bg-red-50 text-red-700'
                        : 'bg-slate-100 text-slate-500'
                    }`}>{t.status}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600">{t.products?.length || 0}</td>
                  <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600">{t.sources?.length || 0}</td>
                  <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600">{t.duration_s > 0 ? `${t.duration_s.toFixed(0)}s` : '-'}</td>
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
