import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { listExperiments, listDatasets, getDatasetSaturation } from '../lib/api.ts'
import ScoreTrendChart from '../components/ScoreTrendChart.tsx'
import type { Experiment, Dataset, SaturationCase } from '../types.ts'

export default function OverviewPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [saturation, setSaturation] = useState<SaturationCase[]>([])
  const [satDatasetId, setSatDatasetId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      listExperiments().then(setExperiments),
      listDatasets().then(ds => {
        setDatasets(ds)
        if (ds.length > 0) setSatDatasetId(ds[0].id)
      }),
    ]).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (satDatasetId) {
      getDatasetSaturation(satDatasetId).then(r => setSaturation(r.cases))
    }
  }, [satDatasetId])

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
  const latest = completed[0]
  const latestSummary = latest?.summary

  // Aggregate stats across all completed experiments
  const allScores = completed
    .filter(e => e.summary?.avg_score > 0)
    .map(e => e.summary.avg_score)
  const globalAvg = allScores.length
    ? allScores.reduce((a, b) => a + b, 0) / allScores.length
    : 0
  const globalPassRates = completed
    .filter(e => e.summary?.total_cases > 0)
    .map(e => e.summary.passed / e.summary.total_cases)
  const avgPassRate = globalPassRates.length
    ? Math.round(
        (globalPassRates.reduce((a, b) => a + b, 0) / globalPassRates.length) * 100,
      )
    : 0

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* ── Page header ── */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">评分概览</h1>
        <p className="text-sm text-slate-400 mt-1">
          评测实验的评分趋势、通过率和评分器表现
        </p>
      </div>

      {/* ── Global stats ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl bg-white border border-slate-200/80 p-4">
          <div className="text-[11px] text-slate-400 font-medium mb-1">总完成实验</div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">{completed.length}</div>
        </div>
        <div className="rounded-xl bg-white border border-slate-200/80 p-4">
          <div className="text-[11px] text-slate-400 font-medium mb-1">全局均分</div>
          <div
            className={`text-2xl font-bold tabular-nums ${
              globalAvg >= 70
                ? 'text-emerald-600'
                : globalAvg >= 40
                  ? 'text-amber-500'
                  : globalAvg > 0
                    ? 'text-red-500'
                    : 'text-slate-300'
            }`}
          >
            {globalAvg > 0 ? globalAvg.toFixed(1) : '—'}
          </div>
        </div>
        <div className="rounded-xl bg-white border border-slate-200/80 p-4">
          <div className="text-[11px] text-slate-400 font-medium mb-1">平均通过率</div>
          <div
            className={`text-2xl font-bold tabular-nums ${
              avgPassRate >= 70
                ? 'text-emerald-600'
                : avgPassRate >= 40
                  ? 'text-amber-500'
                  : avgPassRate > 0
                    ? 'text-red-500'
                    : 'text-slate-300'
            }`}
          >
            {avgPassRate > 0 ? `${avgPassRate}%` : '—'}
          </div>
        </div>
        <div className="rounded-xl bg-white border border-slate-200/80 p-4">
          <div className="text-[11px] text-slate-400 font-medium mb-1">最新实验</div>
          <div className="text-2xl font-bold text-slate-900">
            {latest ? (
              <Link to={`/experiments/${latest.id}`} className="text-blue-600 hover:underline">
                #{latest.id}
              </Link>
            ) : (
              '—'
            )}
          </div>
        </div>
      </div>

      {/* ── Score trend chart ── */}
      <ScoreTrendChart experiments={experiments} />

      {/* ── Failure Funnel + Grader Averages ── */}
      {latestSummary &&
        (latestSummary.failure_funnel_dist || latestSummary.grader_averages) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Failure Funnel */}
            {latestSummary.failure_funnel_dist &&
              Object.keys(latestSummary.failure_funnel_dist).length > 0 && (
                <div className="rounded-xl bg-white border border-slate-200/80 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-slate-700">
                      Failure Funnel
                    </h3>
                    <Link
                      to={`/experiments/${latest.id}`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      #{latest.id}
                    </Link>
                  </div>
                  <div className="flex gap-3">
                    {[
                      'understand',
                      'search',
                      'extract',
                      'match_rubric',
                      'generate',
                    ].map(stage => {
                      const count =
                        latestSummary.failure_funnel_dist[stage] || 0
                      return (
                        <div key={stage} className="flex-1 text-center">
                          <div
                            className={`text-lg font-bold tabular-nums ${
                              count > 0 ? 'text-red-500' : 'text-slate-300'
                            }`}
                          >
                            {count}
                          </div>
                          <div className="text-[10px] text-slate-500 leading-tight mt-0.5">
                            {stage.replace('_', ' ')}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

            {/* Grader Averages */}
            {latestSummary.grader_averages &&
              Object.keys(latestSummary.grader_averages).length > 0 && (
                <div className="rounded-xl bg-white border border-slate-200/80 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-slate-700">
                      评分器均分
                    </h3>
                    <Link
                      to="/graders"
                      className="text-xs text-blue-600 hover:underline"
                    >
                      详情
                    </Link>
                  </div>
                  <div className="space-y-1.5">
                    {Object.entries(latestSummary.grader_averages)
                      .sort(([, a], [, b]) => b - a)
                      .map(([name, avg]) => (
                        <div key={name} className="flex items-center gap-2">
                          <span className="w-28 text-[10px] text-slate-500 truncate">
                            {name.replace(/_/g, ' ')}
                          </span>
                          <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className={`h-1.5 rounded-full transition-all duration-500 ${
                                avg >= 70
                                  ? 'bg-emerald-500'
                                  : avg >= 40
                                    ? 'bg-amber-400'
                                    : 'bg-red-400'
                              }`}
                              style={{ width: `${avg}%` }}
                            />
                          </div>
                          <span className="w-6 text-right text-[10px] tabular-nums font-medium text-slate-600">
                            {avg.toFixed(0)}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
          </div>
        )}

      {/* ── Case Saturation Monitor ── */}
      {saturation.length > 0 && (
        <div className="rounded-xl bg-white border border-slate-200/80 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700">Case Saturation Monitor</h3>
            {datasets.length > 1 && (
              <select
                value={satDatasetId ?? ''}
                onChange={e => setSatDatasetId(Number(e.target.value))}
                className="text-xs border border-slate-200 rounded px-2 py-1"
              >
                {datasets.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mb-3">
            Cases at 100% pass rate with 3+ trials are saturated (no room for improvement).
            Saturated capability evals should graduate to regression suites.
          </p>
          <div className="space-y-1.5">
            {saturation.map(c => (
              <div key={c.case_key} className="flex items-center gap-2">
                <span className="w-40 text-xs text-slate-600 truncate" title={c.case_key}>
                  {c.case_key}
                </span>
                <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      c.saturated ? 'bg-emerald-400' : c.pass_rate >= 0.7 ? 'bg-emerald-500' : c.pass_rate >= 0.3 ? 'bg-amber-400' : 'bg-red-400'
                    }`}
                    style={{ width: `${c.pass_rate * 100}%` }}
                  />
                </div>
                <span className="w-12 text-right text-[10px] tabular-nums text-slate-600">
                  {(c.pass_rate * 100).toFixed(0)}%
                </span>
                <span className="w-16 text-right text-[10px] tabular-nums text-slate-400">
                  {c.passes}/{c.total_trials}
                </span>
                {c.saturated && (
                  <span className="px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[9px] font-medium">
                    saturated
                  </span>
                )}
              </div>
            ))}
          </div>
          {(() => {
            const saturatedCount = saturation.filter(c => c.saturated).length
            return saturatedCount > 0 ? (
              <div className="mt-3 text-[11px] text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                {saturatedCount}/{saturation.length} cases saturated.
                Consider graduating these to a regression suite or adding harder test cases.
              </div>
            ) : null
          })()}
        </div>
      )}
    </div>
  )
}
