import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { listExperiments, listDatasets, getDatasetSaturation, getJudgeAlignment, getDatasetStaleness, getReviewQueue, getReviewStats, updateReviewStatus } from '../lib/api.ts'
import ScoreTrendChart from '../components/ScoreTrendChart.tsx'
import type { Experiment, Dataset, SaturationCase, JudgeAlignment, StalenessReport, ReviewQueueItem, ReviewStats } from '../types.ts'

export default function OverviewPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [saturation, setSaturation] = useState<SaturationCase[]>([])
  const [satDatasetId, setSatDatasetId] = useState<number | null>(null)
  const [alignment, setAlignment] = useState<JudgeAlignment | null>(null)
  const [staleness, setStaleness] = useState<StalenessReport | null>(null)
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueItem[]>([])
  const [reviewStats, setReviewStats] = useState<ReviewStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      listExperiments().then(setExperiments),
      listDatasets().then(ds => {
        setDatasets(ds)
        if (ds.length > 0) setSatDatasetId(ds[0].id)
      }),
      getJudgeAlignment().then(setAlignment).catch(() => null),
      getReviewStats().then(setReviewStats).catch(() => null),
      getReviewQueue(8).then(r => setReviewQueue(r.traces)).catch(() => null),
    ]).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (satDatasetId) {
      getDatasetSaturation(satDatasetId).then(r => setSaturation(r.cases))
      getDatasetStaleness(satDatasetId).then(setStaleness).catch(() => null)
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

      {/* ── Judge Alignment (TPR/TNR) ── */}
      {alignment && alignment.total_labeled > 0 && (
        <div className="rounded-xl bg-white border border-slate-200/80 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700">
              Judge 校准 (TPR/TNR)
            </h3>
            <span className="text-[10px] text-slate-400">
              {alignment.total_labeled} 条人工标注
            </span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {/* TPR */}
            <div className="text-center">
              <div className="text-[10px] text-slate-400 mb-1">TPR (灵敏度)</div>
              <div className={`text-xl font-bold tabular-nums ${
                alignment.tpr != null
                  ? alignment.tpr >= 0.9 ? 'text-emerald-600'
                    : alignment.tpr >= 0.8 ? 'text-amber-500'
                    : 'text-red-500'
                  : 'text-slate-300'
              }`}>
                {alignment.tpr != null ? `${(alignment.tpr * 100).toFixed(0)}%` : '—'}
              </div>
              <div className="text-[9px] text-slate-400">
                人说 Pass → Judge 也说 Pass
              </div>
            </div>
            {/* TNR */}
            <div className="text-center">
              <div className="text-[10px] text-slate-400 mb-1">TNR (特异度)</div>
              <div className={`text-xl font-bold tabular-nums ${
                alignment.tnr != null
                  ? alignment.tnr >= 0.9 ? 'text-emerald-600'
                    : alignment.tnr >= 0.8 ? 'text-amber-500'
                    : 'text-red-500'
                  : 'text-slate-300'
              }`}>
                {alignment.tnr != null ? `${(alignment.tnr * 100).toFixed(0)}%` : '—'}
              </div>
              <div className="text-[9px] text-slate-400">
                人说 Fail → Judge 也说 Fail
              </div>
            </div>
            {/* Observed pass rate */}
            <div className="text-center">
              <div className="text-[10px] text-slate-400 mb-1">Judge 通过率 (原始)</div>
              <div className="text-xl font-bold tabular-nums text-slate-600">
                {alignment.observed_pass_rate != null
                  ? `${(alignment.observed_pass_rate * 100).toFixed(0)}%`
                  : '—'}
              </div>
              <div className="text-[9px] text-slate-400">
                {alignment.total_traces ?? 0} 条 trace
              </div>
            </div>
            {/* Corrected pass rate */}
            <div className="text-center">
              <div className="text-[10px] text-slate-400 mb-1">校准通过率 (R-G)</div>
              <div className={`text-xl font-bold tabular-nums ${
                alignment.corrected_pass_rate != null
                  ? 'text-blue-600'
                  : 'text-slate-300'
              }`}>
                {alignment.corrected_pass_rate != null
                  ? `${(alignment.corrected_pass_rate * 100).toFixed(0)}%`
                  : '—'}
              </div>
              <div className="text-[9px] text-slate-400">
                Rogan-Gladen 偏差校正
              </div>
            </div>
          </div>
          {/* Confusion matrix */}
          {alignment.tp != null && (
            <div className="border-t border-slate-100 pt-3">
              <div className="text-[10px] text-slate-400 mb-2">混淆矩阵</div>
              <div className="grid grid-cols-3 gap-px text-center text-[11px] max-w-xs">
                <div />
                <div className="text-slate-400 font-medium py-1">Judge Pass</div>
                <div className="text-slate-400 font-medium py-1">Judge Fail</div>
                <div className="text-slate-400 font-medium py-1 text-right pr-2">Human Pass</div>
                <div className="bg-emerald-50 text-emerald-700 font-bold py-1.5 rounded">
                  TP {alignment.tp}
                </div>
                <div className="bg-red-50 text-red-600 font-bold py-1.5 rounded">
                  FN {alignment.fn}
                </div>
                <div className="text-slate-400 font-medium py-1 text-right pr-2">Human Fail</div>
                <div className="bg-red-50 text-red-600 font-bold py-1.5 rounded">
                  FP {alignment.fp}
                </div>
                <div className="bg-emerald-50 text-emerald-700 font-bold py-1.5 rounded">
                  TN {alignment.tn}
                </div>
              </div>
            </div>
          )}
          {alignment.total_labeled < 50 && (
            <div className="mt-3 text-[11px] text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              需要至少 50 条人工标注 (当前 {alignment.total_labeled}) 才能可靠校准。
              目标: 50 Pass + 50 Fail。
            </div>
          )}
        </div>
      )}

      {/* No labels yet */}
      {alignment && alignment.total_labeled === 0 && (
        <div className="rounded-xl bg-white border border-dashed border-slate-300 p-6 text-center">
          <span className="material-symbols-outlined text-slate-300 block mb-2" style={{ fontSize: '32px' }}>
            rate_review
          </span>
          <p className="text-sm text-slate-500 font-medium">Judge 校准需要人工标注</p>
          <p className="text-xs text-slate-400 mt-1">
            在 Trace 详情页标注 PASS/FAIL，积累 50+ 标注后即可计算 TPR/TNR
          </p>
        </div>
      )}

      {/* ── Dataset Staleness ── */}
      {staleness && staleness.total_cases > 0 && (
        <div className="rounded-xl bg-white border border-slate-200/80 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700">
              数据集新鲜度
            </h3>
            <span className="text-[10px] text-slate-400">
              {staleness.total_cases} cases · {staleness.max_age_days}d threshold
            </span>
          </div>
          <div className="grid grid-cols-4 gap-3 mb-3">
            <div className="text-center">
              <div className="text-[10px] text-slate-400 mb-1">Fresh</div>
              <div className="text-lg font-bold text-emerald-600">{staleness.fresh}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-400 mb-1">Stale</div>
              <div className={`text-lg font-bold ${staleness.stale > 0 ? 'text-amber-500' : 'text-slate-300'}`}>
                {staleness.stale}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-400 mb-1">Never Validated</div>
              <div className={`text-lg font-bold ${staleness.never_validated > 0 ? 'text-red-500' : 'text-slate-300'}`}>
                {staleness.never_validated}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-400 mb-1">Staleness</div>
              <div className={`text-lg font-bold ${
                staleness.staleness_pct > 0.5 ? 'text-red-500'
                  : staleness.staleness_pct > 0.2 ? 'text-amber-500'
                  : 'text-emerald-600'
              }`}>
                {(staleness.staleness_pct * 100).toFixed(0)}%
              </div>
            </div>
          </div>
          {/* Staleness bar */}
          <div className="flex h-2 rounded-full overflow-hidden bg-slate-100">
            {staleness.fresh > 0 && (
              <div
                className="bg-emerald-400"
                style={{ width: `${(staleness.fresh / staleness.total_cases) * 100}%` }}
                title={`Fresh: ${staleness.fresh}`}
              />
            )}
            {staleness.stale > 0 && (
              <div
                className="bg-amber-400"
                style={{ width: `${(staleness.stale / staleness.total_cases) * 100}%` }}
                title={`Stale: ${staleness.stale}`}
              />
            )}
            {staleness.never_validated > 0 && (
              <div
                className="bg-red-300"
                style={{ width: `${(staleness.never_validated / staleness.total_cases) * 100}%` }}
                title={`Never validated: ${staleness.never_validated}`}
              />
            )}
          </div>
          <div className="mt-1.5 flex gap-3 text-[9px] text-slate-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Fresh</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Stale ({'>'}{ staleness.max_age_days}d)</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-300" /> Never Validated</span>
          </div>
          {staleness.staleness_pct > 0.5 && (
            <div className="mt-3 text-[11px] text-red-600 bg-red-50 rounded-lg px-3 py-2">
              超过 50% 的测试用例未经验证或已过期。评测结果可能不可靠 — 请验证 golden data 是否仍然准确。
            </div>
          )}
        </div>
      )}

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

      {/* ── Transcript Review Queue ── */}
      {reviewStats && (
        <div className="rounded-xl bg-white border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-slate-800">Transcript Review</h3>
            <button
              onClick={() => getReviewQueue(8).then(r => setReviewQueue(r.traces)).catch(() => null)}
              className="text-[11px] text-blue-600 hover:text-blue-700"
            >
              Resample
            </button>
          </div>

          {/* Coverage stats */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="text-center">
              <div className="text-lg font-bold text-slate-700 tabular-nums">{reviewStats.reviewed}</div>
              <div className="text-[10px] text-slate-400">Reviewed</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-amber-600 tabular-nums">{reviewStats.flagged}</div>
              <div className="text-[10px] text-slate-400">Flagged</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-slate-400 tabular-nums">{reviewStats.pending}</div>
              <div className="text-[10px] text-slate-400">Pending</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-emerald-600 tabular-nums">{reviewStats.coverage_pct}%</div>
              <div className="text-[10px] text-slate-400">Coverage</div>
            </div>
          </div>

          {/* Coverage bar */}
          <div className="h-1.5 rounded-full bg-slate-100 mb-4">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${Math.min(reviewStats.coverage_pct, 100)}%` }}
            />
          </div>

          {/* Queue */}
          {reviewQueue.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] text-slate-400 mb-1">Review Queue (stratified sample)</div>
              {reviewQueue.map(item => (
                <div key={item.trace_id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 group">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${item.passed ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  <Link
                    to={`/trace/${item.trace_id}`}
                    className="flex-1 text-sm text-blue-600 hover:text-blue-700 truncate"
                  >
                    {item.case_key}
                  </Link>
                  <span className="text-[10px] text-slate-400 tabular-nums">{item.score.toFixed(0)}</span>
                  <button
                    onClick={async () => {
                      await updateReviewStatus(item.trace_id, 'reviewed')
                      setReviewQueue(q => q.filter(t => t.trace_id !== item.trace_id))
                      setReviewStats(s => s ? { ...s, reviewed: s.reviewed + 1, pending: s.pending - 1, coverage_pct: Math.round((s.reviewed + 1) / Math.max(s.total, 1) * 1000) / 10 } : s)
                    }}
                    className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 rounded text-[10px] text-emerald-600 hover:bg-emerald-50"
                    title="Mark as reviewed"
                  >
                    ✓
                  </button>
                  <button
                    onClick={async () => {
                      await updateReviewStatus(item.trace_id, 'flagged')
                      setReviewQueue(q => q.filter(t => t.trace_id !== item.trace_id))
                      setReviewStats(s => s ? { ...s, flagged: s.flagged + 1, pending: s.pending - 1 } : s)
                    }}
                    className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 rounded text-[10px] text-red-600 hover:bg-red-50"
                    title="Flag for investigation"
                  >
                    ⚑
                  </button>
                </div>
              ))}
            </div>
          )}

          {reviewQueue.length === 0 && reviewStats.pending > 0 && (
            <div className="text-sm text-slate-400 text-center py-4">
              Click "Resample" to load review queue
            </div>
          )}

          {reviewStats.pending === 0 && (
            <div className="text-sm text-emerald-600 text-center py-4">
              All traces reviewed!
            </div>
          )}
        </div>
      )}
    </div>
  )
}
