import { useState, useEffect } from 'react'
import { listExperiments } from '../lib/api.ts'
import type { Experiment } from '../types.ts'

interface GraderInfo {
  name: string
  category: 'code' | 'llm'
  weight: number
  avgScore: number
  sampleCount: number
}

const GRADER_WEIGHTS: Record<string, { weight: number; category: 'code' | 'llm' }> = {
  rubric_coverage: { weight: 0.2, category: 'code' },
  product_matching: { weight: 0.15, category: 'code' },
  rubric_compliance: { weight: 0.15, category: 'llm' },
  source_quality: { weight: 0.1, category: 'code' },
  output_format: { weight: 0.1, category: 'code' },
  trap_detection: { weight: 0.1, category: 'llm' },
  actionability: { weight: 0.1, category: 'llm' },
  constraint_compliance: { weight: 0.05, category: 'code' },
  efficiency: { weight: 0.05, category: 'code' },
}

export default function GradersPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listExperiments().then(setExperiments).finally(() => setLoading(false))
  }, [])

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
          查看各评分器的配置、权重和表现
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
                {g.weight >= 0.1 && `${(g.weight * 100).toFixed(0)}%`}
              </div>
            ))}
        </div>
        <div className="flex items-center gap-4 mt-3">
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" />
            Code Grader
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="w-2.5 h-2.5 rounded-sm bg-purple-500" />
            LLM Grader (Agent-as-Judge)
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
            <span className="text-[10px] text-slate-400 ml-auto">确定性评分</span>
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
                        g.avgScore >= 70
                          ? 'bg-emerald-500'
                          : g.avgScore >= 40
                            ? 'bg-amber-400'
                            : g.avgScore > 0
                              ? 'bg-red-400'
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

        {/* LLM Graders */}
        <div className="rounded-xl bg-white border border-slate-200/80 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <span className="w-2 h-2 rounded-sm bg-purple-500" />
            <h3 className="text-sm font-semibold text-slate-700">LLM Graders</h3>
            <span className="text-[10px] text-slate-400 ml-auto">Agent-as-Judge</span>
          </div>
          <div className="divide-y divide-slate-100/80">
            {llmGraders.map(g => (
              <div key={g.name} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-700">
                    {g.name.replace(/_/g, ' ')}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    权重 {(g.weight * 100).toFixed(0)}% &middot; preset=claude_code
                  </div>
                </div>
                <div className="w-24">
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-1.5 rounded-full ${
                        g.avgScore >= 70
                          ? 'bg-emerald-500'
                          : g.avgScore >= 40
                            ? 'bg-amber-400'
                            : g.avgScore > 0
                              ? 'bg-red-400'
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
      </div>

      {/* ── Pipeline visualization ── */}
      <div className="rounded-xl bg-white border border-slate-200/80 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">评分流水线</h3>
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {[
            { label: 'Gate', desc: 'Pass/Fail 门禁', color: 'bg-slate-500' },
            { label: 'L0', desc: '结构检查', color: 'bg-blue-400' },
            { label: 'L1', desc: '指标计算', color: 'bg-blue-500' },
            { label: 'Code', desc: '确定性评分', color: 'bg-blue-600' },
            { label: 'LLM', desc: 'Agent Judge', color: 'bg-purple-500' },
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
