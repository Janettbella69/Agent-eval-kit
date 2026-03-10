import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { listExperiments } from '../lib/api.ts'
import ScoreBadge from '../components/ScoreBadge.tsx'
import ScoreTrendChart from '../components/ScoreTrendChart.tsx'
import type { Experiment } from '../types.ts'

export default function DashboardPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listExperiments().then(setExperiments).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-slate-400">Loading...</div>

  const completed = experiments.filter(e => e.status === 'complete')
  const running = experiments.filter(e => e.status === 'running')

  return (
    <div className="space-y-6 animate-fadeIn">
      <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Experiments', value: experiments.length, icon: 'science' },
          { label: 'Running', value: running.length, icon: 'play_circle' },
          { label: 'Latest Avg', value: completed[0]?.summary?.avg_score?.toFixed(1) ?? '-', icon: 'analytics' },
          { label: 'Latest Pass Rate',
            value: completed[0]?.summary
              ? `${Math.round((completed[0].summary.passed / Math.max(completed[0].summary.total_cases, 1)) * 100)}%`
              : '-',
            icon: 'check_circle' },
        ].map(s => (
          <div key={s.label} className="rounded-xl bg-white border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>{s.icon}</span>
              {s.label}
            </div>
            <div className="text-2xl font-bold text-slate-900">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Trend */}
      <ScoreTrendChart experiments={experiments} />

      {/* Recent experiments */}
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">Recent Experiments</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">ID</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Tag</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Status</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Score</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Pass/Fail</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {experiments.slice(0, 20).map(e => (
              <tr key={e.id} className="hover:bg-slate-25">
                <td className="px-4 py-2.5">
                  <Link to={`/experiments/${e.id}`} className="text-blue-600 hover:underline">
                    #{e.id}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-slate-600">{e.tag || '-'}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-xs font-medium ${
                    e.status === 'complete' ? 'text-emerald-600'
                      : e.status === 'running' ? 'text-blue-600'
                      : 'text-slate-400'
                  }`}>
                    {e.status}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  {e.summary?.avg_score ? (
                    <ScoreBadge
                      score={e.summary.avg_score}
                      pass={e.summary.avg_score >= 70}
                      size="sm"
                    />
                  ) : '-'}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-slate-600">
                  {e.summary?.total_cases ? `${e.summary.passed}/${e.summary.total_cases}` : '-'}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-400">
                  {new Date(e.created_at * 1000).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
