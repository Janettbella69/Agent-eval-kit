import { useState, useEffect, useCallback } from 'react'
import { listExperiments, getValidationSummary, validateGrader, listJudgePrompts, getJudgePrompt, saveJudgePrompt, activatePromptVersion, diffPromptVersions, seedJudgePrompts } from '../lib/api.ts'
import type { Experiment } from '../types.ts'
import type { ValidationSummary, JudgePromptListItem, JudgePrompt } from '../lib/api.ts'

interface GraderInfo {
  name: string
  category: 'code' | 'llm'
  weight: number
  avgScore: number
  sampleCount: number
}

const GRADER_WEIGHTS: Record<string, { weight: number; category: 'code' | 'llm' }> = {
  product_matching: { weight: 0.10, category: 'code' },
  source_authority: { weight: 0.08, category: 'code' },
  retrieval_quality: { weight: 0.07, category: 'code' },
  output_format: { weight: 0.07, category: 'code' },
  rubric_coverage: { weight: 0.05, category: 'code' },
  tool_calls: { weight: 0.05, category: 'code' },
  search_quality: { weight: 0.05, category: 'code' },
  transcript: { weight: 0.04, category: 'code' },
  rubric_compliance: { weight: 0.20, category: 'llm' },
  groundedness: { weight: 0.20, category: 'llm' },
  actionability: { weight: 0.08, category: 'llm' },
  trap_detection: { weight: 0.06, category: 'llm' },
}

export default function GradersPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [loading, setLoading] = useState(true)
  const [validation, setValidation] = useState<ValidationSummary>({})
  const [validating, setValidating] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'prompts'>('overview')

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">评分器</h1>
          <p className="text-sm text-slate-400 mt-1">评分器配置、权重、表现、校准和 Prompt 管理</p>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'overview' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            概览
          </button>
          <button
            onClick={() => setActiveTab('prompts')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'prompts' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Prompt 管理
          </button>
        </div>
      </div>

      {activeTab === 'overview' && (
        <>
          {/* Weight distribution */}
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
                Code Grader (~55%)
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span className="w-2.5 h-2.5 rounded-sm bg-purple-500" />
                LLM Grader (~45%)
              </span>
            </div>
          </div>

          {/* Grader tables */}
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
                      <div className="text-sm font-medium text-slate-700">{g.name.replace(/_/g, ' ')}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">权重 {(g.weight * 100).toFixed(0)}%</div>
                    </div>
                    <div className="w-24">
                      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-1.5 rounded-full ${
                            g.avgScore >= 70 ? 'bg-emerald-500' : g.avgScore >= 40 ? 'bg-amber-400' : g.avgScore > 0 ? 'bg-red-400' : 'bg-slate-200'
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
                <span className="text-[10px] text-slate-400 ml-auto">Binary PASS/FAIL</span>
              </div>
              <div className="divide-y divide-slate-100/80">
                {llmGraders.map(g => {
                  const v = validation[g.name]
                  return (
                    <div key={g.name} className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-700">{g.name.replace(/_/g, ' ')}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">权重 {(g.weight * 100).toFixed(0)}%</div>
                        </div>
                        <div className="w-24">
                          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className={`h-1.5 rounded-full ${
                                g.avgScore >= 70 ? 'bg-emerald-500' : g.avgScore >= 40 ? 'bg-amber-400' : g.avgScore > 0 ? 'bg-red-400' : 'bg-slate-200'
                              }`}
                              style={{ width: `${g.avgScore}%` }}
                            />
                          </div>
                        </div>
                        <span className="w-8 text-right text-xs tabular-nums font-semibold text-slate-600">
                          {g.avgScore > 0 ? g.avgScore.toFixed(0) : '—'}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-3 text-[11px]">
                        {v ? (
                          <>
                            <span className={`font-bold ${v.threshold_met ? 'text-emerald-600' : v.tpr !== null ? 'text-amber-600' : 'text-slate-400'}`}>
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

          {/* Pipeline visualization */}
          <div className="rounded-xl bg-white border border-slate-200/80 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">评分流水线</h3>
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              {[
                { label: 'Gate', desc: 'Pass/Fail 门禁', color: 'bg-slate-500' },
                { label: 'L0', desc: '结构检查', color: 'bg-blue-400' },
                { label: 'L1', desc: '指标计算', color: 'bg-blue-500' },
                { label: 'Code', desc: '确定性评分', color: 'bg-blue-600' },
                { label: 'LLM', desc: 'PASS/FAIL', color: 'bg-purple-500' },
                { label: 'Composite', desc: '加权合成', color: 'bg-emerald-500' },
              ].map((stage, i) => (
                <div key={stage.label} className="flex items-center gap-2">
                  {i > 0 && (
                    <span className="material-symbols-outlined text-slate-300" style={{ fontSize: '16px' }}>arrow_forward</span>
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
        </>
      )}

      {activeTab === 'prompts' && <JudgePromptPanel />}
    </div>
  )
}


/* ── Judge Prompt Management Panel ── */

function JudgePromptPanel() {
  const [prompts, setPrompts] = useState<JudgePromptListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedGrader, setSelectedGrader] = useState<string>('')
  const [editingPrompt, setEditingPrompt] = useState<JudgePrompt | null>(null)
  const [editText, setEditText] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [diffData, setDiffData] = useState<{ diff: string; a: JudgePrompt; b: JudgePrompt } | null>(null)
  const [seeding, setSeeding] = useState(false)

  const LLM_GRADERS = ['rubric_compliance', 'groundedness', 'actionability', 'trap_detection']

  const loadPrompts = useCallback(async () => {
    setLoading(true)
    const data = await listJudgePrompts(selectedGrader || undefined)
    setPrompts(data)
    setLoading(false)
  }, [selectedGrader])

  useEffect(() => { loadPrompts() }, [loadPrompts])

  const handleEdit = async (id: number) => {
    const p = await getJudgePrompt(id)
    if (p) {
      setEditingPrompt(p)
      setEditText(p.system_prompt)
      setEditNotes('')
    }
  }

  const handleSave = async () => {
    if (!editingPrompt || !editText.trim()) return
    setSaving(true)
    try {
      await saveJudgePrompt(editingPrompt.grader_name, editText, editNotes)
      setEditingPrompt(null)
      loadPrompts()
    } catch (e) {
      console.error('Save failed:', e)
    } finally {
      setSaving(false)
    }
  }

  const handleActivate = async (id: number) => {
    await activatePromptVersion(id)
    loadPrompts()
  }

  const handleDiff = async (idA: number, idB: number) => {
    const data = await diffPromptVersions(idA, idB)
    setDiffData(data)
  }

  const handleSeed = async () => {
    setSeeding(true)
    try {
      const res = await seedJudgePrompts()
      alert(`Seeded: ${res.seeded.join(', ') || 'none'}. Skipped: ${res.skipped.join(', ') || 'none'}.`)
      loadPrompts()
    } finally {
      setSeeding(false)
    }
  }

  // Group prompts by grader
  const grouped: Record<string, JudgePromptListItem[]> = {}
  for (const p of prompts) {
    ;(grouped[p.grader_name] ??= []).push(p)
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <select
          value={selectedGrader}
          onChange={e => setSelectedGrader(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="">全部 Graders</option>
          {LLM_GRADERS.map(g => (
            <option key={g} value={g}>{g.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <button
          onClick={handleSeed}
          disabled={seeding}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50"
        >
          {seeding ? 'Seeding...' : '初始化默认 Prompts'}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-slate-400">加载中...</div>
      ) : prompts.length === 0 ? (
        <div className="rounded-xl bg-white border border-slate-200 p-8 text-center">
          <div className="text-slate-400 mb-3">暂无 Judge Prompts</div>
          <p className="text-xs text-slate-400">点击 "初始化默认 Prompts" 从代码导入默认评分器提示词</p>
        </div>
      ) : (
        Object.entries(grouped).map(([graderName, versions]) => (
          <div key={graderName} className="rounded-xl bg-white border border-slate-200/80 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <span className="w-2 h-2 rounded-sm bg-purple-500" />
              <h3 className="text-sm font-semibold text-slate-700">{graderName.replace(/_/g, ' ')}</h3>
              <span className="text-[10px] text-slate-400 ml-auto">{versions.length} version(s)</span>
            </div>
            <div className="divide-y divide-slate-100/80">
              {versions.map((v, i) => (
                <div key={v.id} className={`px-4 py-3 flex items-center gap-3 ${v.is_active ? 'bg-purple-50/30' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-medium text-slate-700">v{v.version}</span>
                      {v.is_active ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-700">ACTIVE</span>
                      ) : null}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {v.prompt_length} chars · {v.notes || 'no notes'} · {new Date(v.created_at * 1000).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleEdit(v.id)}
                      className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 hover:bg-slate-200"
                    >
                      查看/编辑
                    </button>
                    {!v.is_active && (
                      <button
                        onClick={() => handleActivate(v.id)}
                        className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 hover:bg-amber-100"
                      >
                        回滚
                      </button>
                    )}
                    {i < versions.length - 1 && (
                      <button
                        onClick={() => handleDiff(versions[i + 1].id, v.id)}
                        className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600 hover:bg-blue-100"
                      >
                        Diff
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Edit Modal */}
      {editingPrompt && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setEditingPrompt(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {editingPrompt.grader_name.replace(/_/g, ' ')} — v{editingPrompt.version}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {editingPrompt.is_active ? '当前生效版本' : '历史版本'} · 编辑后将保存为新版本
                </p>
              </div>
              <button onClick={() => setEditingPrompt(null)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">System Prompt</label>
                <textarea
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  rows={18}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono text-slate-700 focus:ring-2 focus:ring-purple-200 focus:border-purple-400"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">版本备注</label>
                <input
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  placeholder="描述本次修改..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3">
              <button onClick={() => setEditingPrompt(null)} className="px-4 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100">
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving || editText === editingPrompt.system_prompt}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存为新版本'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diff Modal */}
      {diffData && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setDiffData(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                Diff: v{diffData.a.version} → v{diffData.b.version}
              </h3>
              <button onClick={() => setDiffData(null)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed">
                {diffData.diff.split('\n').map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.startsWith('+') && !line.startsWith('+++') ? 'bg-emerald-50 text-emerald-800'
                        : line.startsWith('-') && !line.startsWith('---') ? 'bg-red-50 text-red-800'
                        : line.startsWith('@@') ? 'bg-blue-50 text-blue-700 font-semibold'
                        : 'text-slate-600'
                    }
                  >
                    {line}
                  </div>
                ))}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
