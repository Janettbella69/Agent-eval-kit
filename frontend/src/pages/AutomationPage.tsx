import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { listDatasets, listExperiments, cronRun, previewProductionTraces, importProductionTraces, getProductionStatus } from '../lib/api.ts'
import type { Dataset, Experiment } from '../types.ts'

export default function AutomationPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [loading, setLoading] = useState(true)

  // Cron state
  const [cronDatasetId, setCronDatasetId] = useState<number | null>(null)
  const [cronTagPrefix, setCronTagPrefix] = useState('cron')
  const [cronConcurrency, setCronConcurrency] = useState(2)
  const [cronCasesCount, setCronCasesCount] = useState<number | undefined>(undefined)
  const [cronTrials, setCronTrials] = useState(1)
  const [cronRunning, setCronRunning] = useState(false)
  const [cronResult, setCronResult] = useState<string | null>(null)

  // Production import state
  const [prodStatus, setProdStatus] = useState<Record<string, unknown> | null>(null)
  const [prodPreview, setProdPreview] = useState<Array<Record<string, unknown>>>([])
  const [prodStats, setProdStats] = useState<{ total: number; importable: number } | null>(null)
  const [prodLoading, setProdLoading] = useState(false)
  const [importDays, setImportDays] = useState(7)
  const [importLimit, setImportLimit] = useState(50)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      listDatasets().then(ds => { setDatasets(ds); if (ds.length > 0) setCronDatasetId(ds[0].id) }),
      listExperiments().then(setExperiments),
      getProductionStatus().then(setProdStatus).catch(() => null),
    ]).finally(() => setLoading(false))
  }, [])

  const cronExperiments = experiments.filter(e => e.tag?.startsWith('cron'))
  const prodExperiments = experiments.filter(e => (e.config as unknown as Record<string, unknown>)?.source === 'langfuse')

  const handleCronRun = async () => {
    if (!cronDatasetId) return
    setCronRunning(true)
    setCronResult(null)
    try {
      const res = await cronRun(cronDatasetId, cronTagPrefix, cronConcurrency)
      setCronResult(`Experiment #${res.id} started: ${res.tag}`)
      listExperiments().then(setExperiments)
    } catch (e) {
      setCronResult(`Failed: ${e instanceof Error ? e.message : JSON.stringify(e)}`)
    } finally {
      setCronRunning(false)
    }
  }

  const handlePreview = async () => {
    setProdLoading(true)
    try {
      const res = await previewProductionTraces(importDays, 'shopping-research', importLimit)
      setProdPreview(res.traces)
      setProdStats({ total: res.total, importable: res.importable })
    } catch (e) {
      setImportResult(`Preview failed: ${e instanceof Error ? e.message : JSON.stringify(e)}`)
    } finally {
      setProdLoading(false)
    }
  }

  const handleImport = async () => {
    setImporting(true)
    setImportResult(null)
    try {
      const res = await importProductionTraces({ days: importDays, tag: 'shopping-research', limit: importLimit, run_grading: true })
      setImportResult(`Imported ${res.traces_imported} traces (${res.traces_skipped} skipped) → Experiment #${res.experiment_id}`)
      setProdPreview([])
      listExperiments().then(setExperiments)
    } catch (e) {
      setImportResult(`Import failed: ${e instanceof Error ? e.message : JSON.stringify(e)}`)
    } finally {
      setImporting(false)
    }
  }

  if (loading) return <div className="text-slate-400 py-12 text-center">Loading...</div>

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">自动化评测</h1>
        <p className="text-sm text-slate-400 mt-1">定时评测运行、生产 trace 导入、CI/CD 集成</p>
      </div>

      {/* ── Benchmark Automation ── */}
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <span className="material-symbols-outlined text-blue-500" style={{ fontSize: '18px' }}>schedule</span>
          <h2 className="text-sm font-semibold text-slate-700">Benchmark 评测</h2>
          <span className="text-[10px] text-slate-400 ml-auto">POST /api/experiments/cron-run</span>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] font-medium text-slate-400 mb-1 block">数据集</label>
              <select value={cronDatasetId ?? ''} onChange={e => setCronDatasetId(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                {datasets.map(d => <option key={d.id} value={d.id}>{d.name} ({d.case_count} cases)</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-slate-400 mb-1 block">Tag 前缀</label>
              <input value={cronTagPrefix} onChange={e => setCronTagPrefix(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="cron" />
            </div>
            <div>
              <label className="text-[10px] font-medium text-slate-400 mb-1 block">并发数</label>
              <input type="number" value={cronConcurrency} onChange={e => setCronConcurrency(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" min={1} max={5} />
            </div>
            <div>
              <label className="text-[10px] font-medium text-slate-400 mb-1 block">Trials</label>
              <input type="number" value={cronTrials} onChange={e => setCronTrials(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" min={1} max={5} />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] font-medium text-slate-400 mb-1 block">随机抽样 (留空=全部)</label>
              <input type="number" value={cronCasesCount ?? ''} onChange={e => setCronCasesCount(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="全部 cases" min={1} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleCronRun} disabled={cronRunning || !cronDatasetId}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {cronRunning ? '启动中...' : '启动评测'}
            </button>
            {cronResult && (
              <span className={`text-sm ${cronResult.startsWith('Failed') ? 'text-red-600' : 'text-emerald-600'}`}>
                {cronResult}
              </span>
            )}
          </div>
        </div>

        {/* Recent cron runs */}
        {cronExperiments.length > 0 && (
          <div className="border-t border-slate-100 px-5 py-3">
            <div className="text-[10px] text-slate-400 font-semibold mb-2 uppercase tracking-wider">Recent Cron Runs</div>
            <div className="space-y-1">
              {cronExperiments.slice(0, 5).map(e => (
                <div key={e.id} className="flex items-center gap-2 text-sm">
                  <Link to={`/experiments/${e.id}`} className="text-blue-600 hover:underline font-medium">#{e.id}</Link>
                  <span className="text-slate-600">{e.tag}</span>
                  <span className={`ml-auto text-xs font-medium ${e.status === 'complete' ? 'text-emerald-600' : e.status === 'running' ? 'text-amber-600' : 'text-slate-400'}`}>
                    {e.status}
                  </span>
                  {e.summary && (
                    <span className="text-xs tabular-nums text-slate-500">
                      {e.summary.avg_score?.toFixed(0)} avg · {e.summary.passed}/{e.summary.total_cases} pass
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Production Import ── */}
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <span className="material-symbols-outlined text-violet-500" style={{ fontSize: '18px' }}>cloud_download</span>
          <h2 className="text-sm font-semibold text-slate-700">生产 Trace 导入</h2>
          <span className="text-[10px] text-slate-400 ml-auto">
            LangFuse {prodStatus?.connected ? '✓ 已连接' : prodStatus ? '✗ 未连接' : ''}
          </span>
        </div>
        <div className="p-5 space-y-4">
          {prodStatus?.connected === true && (
            <div className="flex gap-4 text-sm text-slate-600">
              <span>Total traces: <b>{String(prodStatus.total_shopping_traces ?? '—')}</b></span>
              <span>Already imported: <b>{String(prodStatus.already_imported ?? '—')}</b></span>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-medium text-slate-400 mb-1 block">时间范围 (天)</label>
              <input type="number" value={importDays} onChange={e => setImportDays(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" min={1} max={90} />
            </div>
            <div>
              <label className="text-[10px] font-medium text-slate-400 mb-1 block">最大导入数</label>
              <input type="number" value={importLimit} onChange={e => setImportLimit(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" min={1} max={200} />
            </div>
            <div className="flex items-end">
              <button onClick={handlePreview} disabled={prodLoading}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                {prodLoading ? '加载中...' : '预览 Traces'}
              </button>
            </div>
          </div>

          {/* Preview table */}
          {prodPreview.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">
                  Total: <b>{prodStats?.total ?? 0}</b> · Importable: <b className="text-emerald-600">{prodStats?.importable ?? 0}</b>
                </span>
              </div>
              <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-slate-400">Query</th>
                      <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-slate-400">Duration</th>
                      <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-slate-400">Products</th>
                      <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-slate-400">Sources</th>
                      <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-slate-400">Guide</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {prodPreview.map((t, i) => (
                      <tr key={i} className="hover:bg-slate-25">
                        <td className="px-3 py-1.5 text-slate-700 max-w-xs truncate">{String(t.query || '—')}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{Number(t.duration_s || 0).toFixed(0)}s</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{Number(t.product_count || 0)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{Number(t.source_count || 0)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{Number(t.guide_length || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <button onClick={handleImport} disabled={importing}
                  className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
                  {importing ? '导入中...' : `导入 ${prodStats?.importable ?? 0} Traces`}
                </button>
                <button onClick={() => setProdPreview([])} className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">
                  取消
                </button>
              </div>
            </>
          )}

          {importResult && (
            <div className={`rounded-lg px-4 py-2 text-sm ${importResult.startsWith('Import failed') || importResult.startsWith('Preview failed') ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-emerald-50 border border-emerald-200 text-emerald-800'}`}>
              {importResult}
            </div>
          )}
        </div>

        {/* Recent production imports */}
        {prodExperiments.length > 0 && (
          <div className="border-t border-slate-100 px-5 py-3">
            <div className="text-[10px] text-slate-400 font-semibold mb-2 uppercase tracking-wider">Recent Production Imports</div>
            <div className="space-y-1">
              {prodExperiments.slice(0, 5).map(e => (
                <div key={e.id} className="flex items-center gap-2 text-sm">
                  <Link to={`/experiments/${e.id}`} className="text-blue-600 hover:underline font-medium">#{e.id}</Link>
                  <span className="text-slate-600">{e.tag}</span>
                  <span className={`ml-auto text-xs font-medium ${e.status === 'complete' ? 'text-emerald-600' : e.status === 'grading_failed' ? 'text-red-600' : 'text-amber-600'}`}>
                    {e.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── CI/CD Integration ── */}
      <div className="rounded-xl bg-white border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-slate-500" style={{ fontSize: '18px' }}>terminal</span>
          CI/CD 集成
        </h2>
        <div className="rounded-lg bg-slate-900 p-4 text-sm font-mono text-slate-300 overflow-x-auto">
          <div className="text-slate-500"># GitHub Actions / cron job example</div>
          <div>curl -X POST {window.location.origin}/eval/api/experiments/cron-run \</div>
          <div className="pl-4">-H "X-Eval-Key: $EVAL_API_KEY" \</div>
          <div className="pl-4">-H "Content-Type: application/json" \</div>
          <div className="pl-4">-d '{`'{"dataset_id": ${cronDatasetId || 1}, "cases_count": 5, "tag_prefix": "ci"}'`}</div>
        </div>
        <p className="text-[11px] text-slate-400 mt-2">
          需要设置 EVAL_API_KEY 环境变量。返回值包含 experiment_id，可用于后续查询结果。
        </p>
      </div>
    </div>
  )
}
