import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listExperiments, listDatasets, createExperiment, runExperiment } from '../lib/api.ts'
import ScoreBadge from '../components/ScoreBadge.tsx'
import type { Experiment, Dataset } from '../types.ts'

function StatCard({
  label,
  value,
  icon,
  color = 'slate',
}: {
  label: string
  value: string | number
  icon: string
  color?: string
}) {
  const colorMap: Record<string, string> = {
    slate: 'bg-slate-50 text-slate-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
  }
  return (
    <div className="rounded-xl bg-white border border-slate-200/80 p-4 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colorMap[color] ?? colorMap.slate}`}>
        <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{icon}</span>
      </div>
      <div>
        <div className="text-[11px] text-slate-400 font-medium">{label}</div>
        <div className="text-lg font-bold text-slate-900 tabular-nums leading-tight">{value}</div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    complete: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
    running: 'bg-blue-50 text-blue-700 border-blue-200/60',
    importing: 'bg-purple-50 text-purple-700 border-purple-200/60',
    grading: 'bg-blue-50 text-blue-700 border-blue-200/60',
    paused: 'bg-amber-50 text-amber-700 border-amber-200/60',
    error: 'bg-red-50 text-red-700 border-red-200/60',
    pending: 'bg-slate-50 text-slate-500 border-slate-200/60',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${styles[status] ?? styles.pending}`}>
      {['running', 'importing', 'grading'].includes(status) && (
        <span className="relative flex h-1.5 w-1.5">
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${status === 'importing' ? 'bg-purple-400' : 'bg-blue-400'}`} />
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${status === 'importing' ? 'bg-purple-500' : 'bg-blue-500'}`} />
        </span>
      )}
      {status}
    </span>
  )
}

type SortKey = 'id' | 'tag' | 'dataset' | 'model' | 'status' | 'score' | 'pass' | 'duration' | 'date'
type SortDir = 'asc' | 'desc'

function SortableHeader({ label, sortKey, currentKey, currentDir, onSort }: {
  label: string; sortKey: SortKey; currentKey: SortKey; currentDir: SortDir; onSort: (k: SortKey) => void
}) {
  const active = currentKey === sortKey
  return (
    <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-600 select-none transition-colors" onClick={() => onSort(sortKey)}>
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active && (
          <span className="material-symbols-outlined text-blue-500" style={{ fontSize: '14px' }}>
            {currentDir === 'asc' ? 'arrow_upward' : 'arrow_downward'}
          </span>
        )}
      </span>
    </th>
  )
}

function getSortValue(e: Experiment, key: SortKey): number | string {
  switch (key) {
    case 'id': return e.id
    case 'tag': return e.tag || ''
    case 'dataset': return e.dataset_name || ''
    case 'model': return e.config?.model || ''
    case 'status': return e.status
    case 'score': return e.summary?.avg_score ?? -1
    case 'pass': return e.summary?.total_cases ? e.summary.passed / e.summary.total_cases : -1
    case 'duration': return e.summary?.avg_duration ?? -1
    case 'date': return e.created_at
  }
}

function shortModel(name: string | undefined): string {
  if (!name) return ''
  return name.replace('claude-', '').replace('openai/', '').replace('anthropic/', '')
}

// ── New Experiment Modal ──────────────────────────────────────────────────────
function NewExperimentModal({
  datasets,
  onClose,
  onCreated,
}: {
  datasets: Dataset[]
  onClose: () => void
  onCreated: (id: number) => void
}) {
  const [datasetId, setDatasetId] = useState<number>(datasets[0]?.id ?? 0)
  const [tag, setTag] = useState('')
  const [concurrency, setConcurrency] = useState(2)
  const [judgeEnabled, setJudgeEnabled] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedDataset = datasets.find(d => d.id === datasetId)

  const handleSubmit = async () => {
    if (!datasetId) return
    setSubmitting(true)
    setError(null)
    try {
      const { id } = await createExperiment({
        dataset_id: datasetId,
        tag,
        trials: 1,
        concurrency,
        judge_enabled: judgeEnabled,
      })
      await runExperiment(id)
      onCreated(id)
    } catch (e) {
      setError(String(e))
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-slate-900">新建实验</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span>
          </button>
        </div>

        <div className="space-y-4">
          {/* Dataset select */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">数据集</label>
            <select
              value={datasetId}
              onChange={e => setDatasetId(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
            >
              {datasets.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.case_count} cases)
                </option>
              ))}
            </select>
            {selectedDataset?.description && (
              <p className="mt-1 text-[11px] text-slate-400 line-clamp-1">{selectedDataset.description}</p>
            )}
          </div>

          {/* Tag */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">标签 <span className="text-slate-400 font-normal">(可选)</span></label>
            <input
              type="text"
              value={tag}
              onChange={e => setTag(e.target.value)}
              placeholder="e.g. v2.1-test, sonnet-4-6-baseline"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
            />
          </div>

          {/* Concurrency + LLM judge row */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-600 mb-1.5">并发数</label>
              <select
                value={concurrency}
                onChange={e => setConcurrency(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
              >
                {[1, 2, 3, 4, 5].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={judgeEnabled}
                  onChange={e => setJudgeEnabled(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500/30"
                />
                <span className="text-xs font-medium text-slate-600">LLM Judge</span>
              </label>
            </div>
          </div>

          {/* Summary */}
          {selectedDataset && (
            <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500 space-y-0.5">
              <div className="flex justify-between">
                <span>数据集</span>
                <span className="text-slate-700 font-medium">{selectedDataset.name}</span>
              </div>
              <div className="flex justify-between">
                <span>Case 数量</span>
                <span className="text-slate-700 font-medium">{selectedDataset.case_count}</span>
              </div>
              <div className="flex justify-between">
                <span>并发数</span>
                <span className="text-slate-700 font-medium">{concurrency}</span>
              </div>
              <div className="flex justify-between">
                <span>预计时长</span>
                <span className="text-slate-700 font-medium">
                  ~{Math.ceil(selectedDataset.case_count / concurrency * 3)} 分钟
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !datasetId}
            className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? '启动中…' : '▶ 开始实验'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ExperimentsPage() {
  const navigate = useNavigate()
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  const [sortKey, setSortKey] = useState<SortKey>('id')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    Promise.all([
      listExperiments().then(setExperiments),
      listDatasets().then(setDatasets),
    ]).finally(() => setLoading(false))
  }, [])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = useMemo(() => {
    const arr = [...experiments]
    arr.sort((a, b) => {
      const va = getSortValue(a, sortKey)
      const vb = getSortValue(b, sortKey)
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb))
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [experiments, sortKey, sortDir])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <span className="material-symbols-outlined animate-spin mr-2" style={{ fontSize: '20px' }}>progress_activity</span>
        加载中...
      </div>
    )
  }

  const completed = experiments.filter(e => e.status === 'complete')
  const running = experiments.filter(e => e.status === 'running')
  const latest = completed[0]
  const latestSummary = latest?.summary

  return (
    <div className="space-y-6 animate-fadeIn">
      {showModal && datasets.length > 0 && (
        <NewExperimentModal
          datasets={datasets}
          onClose={() => setShowModal(false)}
          onCreated={id => navigate(`/experiments/${id}`)}
        />
      )}

      {/* ── Page header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">实验列表</h1>
          <p className="text-sm text-slate-400 mt-1">管理和追踪所有评测实验的运行状态与结果</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/compare')}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>compare_arrows</span>
            对比
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 transition-colors shadow-sm shadow-blue-200/50 cursor-pointer"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add</span>
            新建实验
          </button>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="总实验数" value={experiments.length} icon="science" color="slate" />
        <StatCard label="运行中" value={running.length} icon="play_circle" color={running.length > 0 ? 'blue' : 'slate'} />
        <StatCard
          label="最新均分"
          value={latestSummary?.avg_score?.toFixed(1) ?? '—'}
          icon="analytics"
          color={latestSummary?.avg_score != null ? (latestSummary.avg_score >= 70 ? 'emerald' : 'amber') : 'slate'}
        />
        <StatCard
          label="最新通过率"
          value={latestSummary ? `${Math.round((latestSummary.passed / Math.max(latestSummary.total_cases, 1)) * 100)}%` : '—'}
          icon="check_circle"
          color={latestSummary ? (latestSummary.passed / Math.max(latestSummary.total_cases, 1) >= 0.7 ? 'emerald' : 'amber') : 'slate'}
        />
      </div>

      {/* ── Experiments table ── */}
      <div className="rounded-xl bg-white border border-slate-200/80 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <SortableHeader label="ID" sortKey="id" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                <SortableHeader label="标签" sortKey="tag" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                <SortableHeader label="数据集" sortKey="dataset" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                <SortableHeader label="模型" sortKey="model" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                <SortableHeader label="状态" sortKey="status" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                <SortableHeader label="评分" sortKey="score" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                <SortableHeader label="通过/总数" sortKey="pass" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                <SortableHeader label="用时" sortKey="duration" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                <SortableHeader label="日期" sortKey="date" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/80">
              {sorted.map(e => (
                <tr
                  key={e.id}
                  className="hover:bg-slate-50/60 transition-colors cursor-pointer"
                  onClick={() => navigate(`/experiments/${e.id}`)}
                >
                  <td className="px-4 py-3">
                    <Link to={`/experiments/${e.id}`} className="text-blue-600 hover:underline font-medium" onClick={ev => ev.stopPropagation()}>
                      #{e.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-slate-700 font-medium">{e.tag || '—'}</span>
                    {e.config?.judge_enabled && (
                      <span className="ml-1.5 text-[9px] font-medium px-1 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200/50">LLM</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 max-w-[140px] truncate" title={e.dataset_name || `#${e.dataset_id}`}>
                    {e.dataset_name || `#${e.dataset_id}`}
                  </td>
                  <td className="px-4 py-3">
                    {e.config?.model ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 inline-block w-fit">
                          {shortModel(e.config.model)}
                        </span>
                        {e.config.grading_model && (
                          <span className="text-[9px] text-slate-400" title={`Grading: ${e.config.grading_model}`}>
                            judge: {shortModel(e.config.grading_model)}
                          </span>
                        )}
                      </div>
                    ) : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={e.status} /></td>
                  <td className="px-4 py-3">
                    {e.summary?.avg_score ? (
                      <ScoreBadge score={e.summary.avg_score} pass={e.summary.avg_score >= 70} size="sm" />
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">
                    {e.summary?.total_cases ? `${e.summary.passed}/${e.summary.total_cases}` : '—'}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-xs text-slate-500">
                    {e.summary?.avg_duration ? `${e.summary.avg_duration.toFixed(0)}s` : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                    {new Date(e.created_at * 1000).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {experiments.length === 0 && (
          <div className="py-16 text-center text-slate-400">
            <span className="material-symbols-outlined block mx-auto mb-2" style={{ fontSize: '32px' }}>science</span>
            <p className="text-sm">还没有实验</p>
            <p className="text-xs mt-1">点击右上角「新建实验」开始</p>
          </div>
        )}
      </div>
    </div>
  )
}
