import { useState, useEffect, useCallback } from 'react'
import { listExperiments, getValidationSummary, validateGrader } from '../lib/api.ts'
import type { Experiment } from '../types.ts'
import type { ValidationSummary } from '../lib/api.ts'

interface GraderInfo {
  name: string
  category: 'code' | 'llm'
  weight: number
  avgScore: number
  sampleCount: number
}

const GRADER_WEIGHTS: Record<string, { weight: number; category: 'code' | 'llm' }> = {
  rubric_coverage: { weight: 0.03, category: 'code' },
  product_matching: { weight: 0.08, category: 'code' },
  source_authority: { weight: 0.08, category: 'code' },
  output_format: { weight: 0.05, category: 'code' },
  efficiency: { weight: 0.03, category: 'code' },
  tool_calls: { weight: 0.04, category: 'code' },
  transcript: { weight: 0.04, category: 'code' },
  retrieval_quality: { weight: 0.05, category: 'code' },
  rubric_compliance: { weight: 0.25, category: 'llm' },
  groundedness: { weight: 0.18, category: 'llm' },
  actionability: { weight: 0.12, category: 'llm' },
  trap_detection: { weight: 0.05, category: 'llm' },
}

export default function GradersPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [loading, setLoading] = useState(true)
  const [validation, setValidation] = useState<ValidationSummary>({})
  const [validating, setValidating] = useState<string | null>(null)

  const loadValidation = useCallback(() => {
    getValidationSummary().then(setValidation).catch(() => {})
  }, [])

  useEffect(() => {
    listExperiments().then(setExperiments).finally(() => setLoading(false))
    loadValidation()
  }, [loadValidation])

  const handleValidate = async (name: string) => {
    setValidating(name)
    try {
      await validateGrader(name)
      loadValidation()
    } catch (e) {
      console.error('Validation failed:', e)
    } finally {
      setValidating(null)
    }
  }

  // Aggregate grader data from the latest completed experiment
  const completed = experiments.filter(e => e.status === 'complete')
  const latest = completed[0]
  const graderAvgs = latest?.summary?.grader_averages ?? {}

  const graders: GraderInfo[] = Object.entries(GRADER_WEIGHTS).map(
    ([name, info]) => ({
      name,
      category: info.category,
      weight: info.weight,
      avgScore: graderAvgs[name] ?? 0,
      sampleCount: latest?.summary?.total_cases ?? 0,
    }),
  )

  const codeGraders = graders.filter(g => g.category === 'code')
  const llmGraders = graders.filter(g => g.category === 'llm')

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

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* ── Page header ── */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">评分器</h1>
        <p className="text-sm text-slate-400 mt-1">
          查看各评分器的配置、权重、表现和校准状态
        </p>
      </div>

      {/* ── Weight distribution ── */}
      <div className="rounded-xl bg-white border border-slate-200/80 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">权重分布</h3>
        <div className="flex h-6 rounded-lg overflow-hidden gap-0.5">
          {graders
            .filter(g => g.weight > 0)
            .sort((a, b) => b.weight - a.weight)
            .map(g => (
              <div
                key={g.name}
                className={`flex items-center justify-center text-[9px] font-bold text-white transition-all ${
                  g.category === 'code' ? 'bg-blue-500' : 'bg-purple-500'
                }`}
                style={{ width: `${g.weight * 100}%` }}
                title={`${g.name}: ${(g.weight * 100).toFixed(0)}%`}
              >
                {g.weight >= 0.08 && `${(g.weight * 100).toFixed(0)}%`}
              </div>
            ))}
        </div>
        <div className="flex items-center gap-4 mt-3">
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" />
            Code Grader (~40%)
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="w-2.5 h-2.5 rounded-sm bg-purple-500" />
            LLM Grader (~60%) — Binary PASS/FAIL
          </span>
        </div>
      </div>

      {/* ── Grader tables ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Code Graders */}
        <div className="rounded-xl bg-white border border-slate-200/80 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <span className="w-2 h-2 rounded-sm bg-blue-500" />
            <h3 className="text-sm font-semibold text-slate-700">Code Graders</h3>
            <span className="text-[10px] text-slate-400 ml-auto">确定性 · 0-100 分</span>
          </div>
          <div className="divide-y divide-slate-100/80">
            {codeGraders.map(g => (
              <div key={g.name} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-700">
                    {g.name.replace(/_/g, ' ')}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    权重 {(g.weight * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="w-24">
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-1.5 rounded-full ${
                        g.avgScore >= 70 ? 'bg-emerald-500'
                          : g.avgScore >= 40 ? 'bg-amber-400'
                          : g.avgScore > 0 ? 'bg-red-400'
                          : 'bg-slate-200'
                      }`}
                      style={{ width: `${g.avgScore}%` }}
                    />
                  </div>
                </div>
                <span className="w-8 text-right text-xs tabular-nums font-semibold text-slate-600">
                  {g.avgScore > 0 ? g.avgScore.toFixed(0) : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* LLM Graders + Validation */}
        <div className="rounded-xl bg-white border border-slate-200/80 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <span className="w-2 h-2 rounded-sm bg-purple-500" />
            <h3 className="text-sm font-semibold text-slate-700">LLM Graders</h3>
            <span className="text-[10px] text-slate-400 ml-auto">Binary PASS/FAIL · Agent-as-Judge</span>
          </div>
          <div className="divide-y divide-slate-100/80">
            {llmGraders.map(g => {
              const v = validation[g.name]
              return (
                <div key={g.name} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-700">
                        {g.name.replace(/_/g, ' ')}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        权重 {(g.weight * 100).toFixed(0)}%
                      </div>
                    </div>
                    <div className="w-24">
                      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-1.5 rounded-full ${
                            g.avgScore >= 70 ? 'bg-emerald-500'
                              : g.avgScore >= 40 ? 'bg-amber-400'
                              : g.avgScore > 0 ? 'bg-red-400'
                              : 'bg-slate-200'
                          }`}
                          style={{ width: `${g.avgScore}%` }}
                        />
                      </div>
                    </div>
                    <span className="w-8 text-right text-xs tabular-nums font-semibold text-slate-600">
                      {g.avgScore > 0 ? g.avgScore.toFixed(0) : '—'}
                    </span>
                  </div>

                  {/* Validation Status */}
                  <div className="mt-2 flex items-center gap-3 text-[11px]">
                    {v ? (
                      <>
                        <span className={`font-bold ${
                          v.threshold_met ? 'text-emerald-600' : v.tpr !== null ? 'text-amber-600' : 'text-slate-400'
                        }`}>
                          {v.threshold_met ? '✓ Validated' : v.tpr !== null ? '⚠ Below threshold' : 'Not validated'}
                        </span>
                        {v.tpr !== null && (
                          <>
                            <span className={`tabular-nums ${(v.tpr ?? 0) >= 0.8 ? 'text-emerald-600' : 'text-red-500'}`}>
                              TPR {((v.tpr ?? 0) * 100).toFixed(0)}%
                            </span>
                            <span className={`tabular-nums ${(v.tnr ?? 0) >= 0.8 ? 'text-emerald-600' : 'text-red-500'}`}>
                              TNR {((v.tnr ?? 0) * 100).toFixed(0)}%
                            </span>
                            <span className="text-slate-400">n={v.n_samples}</span>
                          </>
                        )}
                      </>
                    ) : (
                      <span className="text-slate-400">No validation data</span>
                    )}
                    <button
                      onClick={() => handleValidate(g.name)}
                      disabled={validating === g.name}
                      className="ml-auto px-2 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-600 hover:bg-purple-100 disabled:opacity-50"
                    >
                      {validating === g.name ? 'Validating...' : 'Validate'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Pipeline visualization ── */}
      <div className="rounded-xl bg-white border border-slate-200/80 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">评分流水线</h3>
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {[
            { label: 'Gate', desc: 'Pass/Fail 门禁', color: 'bg-slate-500' },
            { label: 'L0', desc: '结构检查', color: 'bg-blue-400' },
            { label: 'L1', desc: '指标计算', color: 'bg-blue-500' },
            { label: 'Code', desc: '确定性评分 (0-100)', color: 'bg-blue-600' },
            { label: 'LLM', desc: 'Binary PASS/FAIL', color: 'bg-purple-500' },
            { label: 'Composite', desc: '加权合成', color: 'bg-emerald-500' },
          ].map((stage, i) => (
            <div key={stage.label} className="flex items-center gap-2">
              {i > 0 && (
                <span className="material-symbols-outlined text-slate-300" style={{ fontSize: '16px' }}>
                  arrow_forward
                </span>
              )}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200/60 min-w-fit">
                <span className={`w-2 h-2 rounded-full ${stage.color}`} />
                <div>
                  <div className="text-xs font-semibold text-slate-700">{stage.label}</div>
                  <div className="text-[10px] text-slate-400">{stage.desc}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
