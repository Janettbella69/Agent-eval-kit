import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listExperiments } from '../lib/api.ts'
import ScoreBadge from '../components/ScoreBadge.tsx'
import type { Experiment } from '../types.ts'

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
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center ${colorMap[color] ?? colorMap.slate}`}
      >
        <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
          {icon}
        </span>
      </div>
      <div>
        <div className="text-[11px] text-slate-400 font-medium">{label}</div>
        <div className="text-lg font-bold text-slate-900 tabular-nums leading-tight">
          {value}
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    complete: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
    running: 'bg-blue-50 text-blue-700 border-blue-200/60',
    paused: 'bg-amber-50 text-amber-700 border-amber-200/60',
    error: 'bg-red-50 text-red-700 border-red-200/60',
    pending: 'bg-slate-50 text-slate-500 border-slate-200/60',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${
        styles[status] ?? styles.pending
      }`}
    >
      {status === 'running' && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" />
        </span>
      )}
      {status}
    </span>
  )
}

export default function ExperimentsPage() {
  const navigate = useNavigate()
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listExperiments().then(setExperiments).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <span className="material-symbols-outlined animate-spin mr-2" style={{ fontSize: '20px' }}>
          progress_activity
        </span>
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
      {/* ── Page header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">实验列表</h1>
          <p className="text-sm text-slate-400 mt-1">
            管理和追踪所有评测实验的运行状态与结果
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/compare')}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
              compare_arrows
            </span>
            对比
          </button>
          <button
            onClick={() => navigate('/datasets')}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 transition-colors shadow-sm shadow-blue-200/50 cursor-pointer"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
              add
            </span>
            新建实验
          </button>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="总实验数"
          value={experiments.length}
          icon="science"
          color="slate"
        />
        <StatCard
          label="运行中"
          value={running.length}
          icon="play_circle"
          color={running.length > 0 ? 'blue' : 'slate'}
        />
        <StatCard
          label="最新均分"
          value={latestSummary?.avg_score?.toFixed(1) ?? '—'}
          icon="analytics"
          color={
            latestSummary?.avg_score != null
              ? latestSummary.avg_score >= 70
                ? 'emerald'
                : 'amber'
              : 'slate'
          }
        />
        <StatCard
          label="最新通过率"
          value={
            latestSummary
              ? `${Math.round((latestSummary.passed / Math.max(latestSummary.total_cases, 1)) * 100)}%`
              : '—'
          }
          icon="check_circle"
          color={
            latestSummary
              ? latestSummary.passed / Math.max(latestSummary.total_cases, 1) >= 0.7
                ? 'emerald'
                : 'amber'
              : 'slate'
          }
        />
      </div>

      {/* ── Experiments table ── */}
      <div className="rounded-xl bg-white border border-slate-200/80 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                ID
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                标签
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                数据集
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                状态
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                评分
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                通过/总数
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                用时
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                日期
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100/80">
            {experiments.map(e => (
              <tr
                key={e.id}
                className="hover:bg-slate-50/60 transition-colors cursor-pointer"
                onClick={() => navigate(`/experiments/${e.id}`)}
              >
                <td className="px-4 py-3">
                  <Link
                    to={`/experiments/${e.id}`}
                    className="text-blue-600 hover:underline font-medium"
                    onClick={ev => ev.stopPropagation()}
                  >
                    #{e.id}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className="text-slate-700 font-medium">
                    {e.tag || '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">
                  {e.dataset_id ? `Dataset #${e.dataset_id}` : '—'}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={e.status} />
                </td>
                <td className="px-4 py-3">
                  {e.summary?.avg_score ? (
                    <ScoreBadge
                      score={e.summary.avg_score}
                      pass={e.summary.avg_score >= 70}
                      size="sm"
                    />
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums text-slate-600">
                  {e.summary?.total_cases
                    ? `${e.summary.passed}/${e.summary.total_cases}`
                    : '—'}
                </td>
                <td className="px-4 py-3 tabular-nums text-xs text-slate-500">
                  {e.summary?.avg_duration
                    ? `${e.summary.avg_duration.toFixed(0)}s`
                    : '—'}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {new Date(e.created_at * 1000).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {experiments.length === 0 && (
          <div className="py-16 text-center text-slate-400">
            <span
              className="material-symbols-outlined block mx-auto mb-2"
              style={{ fontSize: '32px' }}
            >
              science
            </span>
            <p className="text-sm">还没有实验</p>
            <p className="text-xs mt-1">
              从{' '}
              <Link to="/datasets" className="text-blue-600 hover:underline">
                Prompt 数据集
              </Link>{' '}
              创建第一个实验
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
