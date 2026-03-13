import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getTrace, annotateGrader, annotateHumanPass } from '../lib/api.ts'
import ScoreBadge from '../components/ScoreBadge.tsx'
import GraderBreakdown from '../components/GraderBreakdown.tsx'
import TraceTimeline from '../components/TraceTimeline.tsx'
import FailureFunnel from '../components/FailureFunnel.tsx'
import type { Trace, GradingLogEntry } from '../types.ts'

type TabKey = 'guide' | 'products' | 'sources' | 'events' | 'scores' | 'logs' | 'rubric'

export default function TracePage() {
  const { id } = useParams<{ id: string }>()
  const [trace, setTrace] = useState<Trace | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('guide')

  useEffect(() => {
    if (!id) return
    getTrace(Number(id)).then(setTrace).finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="text-slate-400">Loading...</div>
  if (!trace) return <div className="text-red-500">Trace not found.</div>

  const tabs: TabKey[] = ['guide', 'products', 'sources', 'events', 'scores', 'logs']
  if (trace.case_type === 'shoppingcomp' || trace.case_type === 'trap') {
    tabs.push('rubric')
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link to={`/experiments/${trace.experiment_id}`} className="text-sm text-blue-600 hover:underline">
              Experiment #{trace.experiment_id}
            </Link>
            <span className="text-slate-300">/</span>
            <h1 className="text-xl font-bold text-slate-900">{trace.case_key}</h1>
            <span className="text-sm text-slate-400">Trial #{trace.trial_num}</span>
          </div>
          <div className="text-sm text-slate-500 mt-1 max-w-2xl">{trace.query}</div>
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
            <span className="px-1.5 py-0.5 rounded bg-slate-100">{trace.case_type}</span>
            <span>{trace.duration_s.toFixed(1)}s</span>
            <span>{trace.products.length} products</span>
            <span>{trace.sources.length} sources</span>
            {trace.grading_duration_s > 0 && (
              <span>grading: {trace.grading_duration_s.toFixed(1)}s</span>
            )}
          </div>
          {(trace.prompt_version || trace.judge_prompt_version || trace.model) && (
            <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-400 font-mono">
              {trace.prompt_version && <span>prompt: {trace.prompt_version}</span>}
              {trace.judge_prompt_version && <span>judge: {trace.judge_prompt_version}</span>}
              {trace.model && <span>model: {trace.model}</span>}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <ScoreBadge score={trace.final_score} pass={trace.final_pass} size="lg" />
          <HumanPassButton trace={trace} onUpdated={setTrace} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === 'products' && ` (${trace.products.length})`}
            {t === 'sources' && ` (${trace.sources.length})`}
            {t === 'events' && ` (${trace.events.length})`}
            {t === 'logs' && trace.grading_log.length > 0 && ` (${trace.grading_log.length})`}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2">
          {tab === 'guide' && (
            <div className="rounded-xl bg-white border border-slate-200 p-6 prose prose-slate max-w-none">
              {trace.guide_text ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {trace.guide_text}
                </ReactMarkdown>
              ) : (
                <div className="text-slate-400 text-center py-8">No guide text generated.</div>
              )}
            </div>
          )}

          {tab === 'products' && (
            <div className="space-y-3">
              {trace.products.map((p, i) => {
                const product = p as Record<string, string>
                return (
                  <div key={i} className="rounded-xl bg-white border border-slate-200 p-4 flex gap-4">
                    {product.imageUrl && (
                      <img
                        src={product.imageUrl}
                        alt=""
                        className="w-16 h-16 rounded-lg object-cover bg-slate-100"
                      />
                    )}
                    <div>
                      <div className="font-medium text-slate-900">
                        {product.name || 'Unknown'}
                      </div>
                      <div className="text-sm text-slate-500">
                        {product.brand || ''} {product.price || ''}
                      </div>
                    </div>
                  </div>
                )
              })}
              {trace.products.length === 0 && (
                <div className="text-slate-400 text-center py-8">No products found.</div>
              )}
            </div>
          )}

          {tab === 'sources' && (
            <div className="space-y-2">
              {trace.sources.map((s, i) => {
                const source = s as Record<string, string>
                return (
                  <div key={i} className="rounded-lg bg-white border border-slate-200 p-3">
                    <a
                      href={source.url || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline font-medium"
                    >
                      {source.title || source.url || 'Source'}
                    </a>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {source.domain || ''}
                    </div>
                  </div>
                )
              })}
              {trace.sources.length === 0 && (
                <div className="text-slate-400 text-center py-8">No sources found.</div>
              )}
            </div>
          )}

          {tab === 'events' && <TraceTimeline events={trace.events} />}

          {tab === 'scores' && <ScoresTab trace={trace} />}

          {tab === 'logs' && <LogsTab trace={trace} />}

          {tab === 'rubric' && <RubricTab trace={trace} />}
        </div>

        {/* Score breakdown sidebar */}
        <div className="space-y-4">
          <GraderBreakdown
            l0={trace.l0_scores}
            l1={trace.l1_scores}
            l2={trace.l2_scores}
            compositeScores={trace.composite_scores}
            failureFunnel={trace.failure_funnel}
            gate={(trace as unknown as Record<string, unknown>).gate as { results: Record<string, boolean>; passed: boolean } | undefined}
          />

          {/* Human Annotation Panel */}
          {trace.composite_scores && Object.keys(trace.composite_scores).length > 0 && (
            <HumanAnnotationPanel trace={trace} onAnnotated={setTrace} />
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Grading Logs Tab ── */
function LogsTab({ trace }: { trace: Trace }) {
  const logs = trace.grading_log || []

  if (logs.length === 0) {
    return (
      <div className="rounded-xl bg-white border border-slate-200 p-6 text-center text-slate-400">
        No grading logs available. Run or re-grade this trace to generate logs.
      </div>
    )
  }

  const codeSteps = logs.filter(l => l.category === 'code')
  const llmSteps = logs.filter(l => l.category === 'llm')
  const systemSteps = logs.filter(l => l.category === 'system')
  const totalEntry = systemSteps.find(s => s.step === 'total')
  const gateEntry = systemSteps.find(s => s.step === 'gate')
  const compositeEntry = systemSteps.find(s => s.step === 'composite')

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-xl bg-white border border-slate-200 p-4">
        <h4 className="text-sm font-semibold text-slate-700 mb-3">Grading Pipeline Log</h4>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>{codeSteps.length} code graders</span>
          <span>{llmSteps.length} LLM graders</span>
          {totalEntry?.duration_s != null && (
            <span>total: {totalEntry.duration_s.toFixed(2)}s</span>
          )}
          {gateEntry && (
            <span className={gateEntry.passed ? 'text-emerald-600' : 'text-red-600'}>
              gate: {gateEntry.passed ? 'PASS' : 'FAIL'}
            </span>
          )}
          {compositeEntry && (
            <span>composite: {compositeEntry.score?.toFixed(1)} ({compositeEntry.is_pass ? 'pass' : 'fail'})</span>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <div className="divide-y divide-slate-50">
          {logs.filter(l => l.category !== 'system' || l.step === 'gate').map((entry, i) => (
            <LogEntry key={i} entry={entry} />
          ))}
        </div>
      </div>

      {/* Gate Details */}
      {gateEntry?.results && (
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <h4 className="text-sm font-semibold text-slate-700 mb-2">Gate Checks</h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(gateEntry.results).map(([k, v]) => (
              <span
                key={k}
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  v ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                }`}
              >
                {v ? '✓' : '✗'} {k.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function LogEntry({ entry }: { entry: GradingLogEntry }) {
  const isError = entry.status === 'error'
  const isGate = entry.step === 'gate'

  return (
    <div className={`px-4 py-3 ${isError ? 'bg-red-50/50' : ''}`}>
      <div className="flex items-center gap-3">
        {/* Category badge */}
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
          entry.category === 'llm' ? 'bg-purple-50 text-purple-600'
            : entry.category === 'system' ? 'bg-slate-100 text-slate-500'
            : 'bg-blue-50 text-blue-600'
        }`}>
          {entry.category}
        </span>

        {/* Step name */}
        <span className="text-sm font-medium text-slate-700 flex-1">
          {entry.step.replace(/_/g, ' ')}
        </span>

        {/* Score */}
        {entry.score != null && (
          <span className={`text-sm font-bold tabular-nums ${
            entry.score >= 70 ? 'text-emerald-600' : entry.score >= 40 ? 'text-amber-600' : 'text-red-600'
          }`}>
            {entry.score.toFixed(0)}
          </span>
        )}

        {/* Gate pass/fail */}
        {isGate && (
          <span className={entry.passed ? 'text-emerald-600 text-sm font-bold' : 'text-red-600 text-sm font-bold'}>
            {entry.passed ? 'PASS' : 'FAIL'}
          </span>
        )}

        {/* Weight */}
        {entry.weight != null && (
          <span className="text-[10px] text-slate-400 tabular-nums">w={entry.weight.toFixed(2)}</span>
        )}

        {/* Duration */}
        {entry.duration_s != null && (
          <span className="text-[10px] text-slate-400 tabular-nums">{entry.duration_s.toFixed(3)}s</span>
        )}

        {/* Status indicator */}
        <span className={`w-2 h-2 rounded-full ${
          isError ? 'bg-red-500' : 'bg-emerald-500'
        }`} />

        {/* Revision badge */}
        {entry.revisions != null && entry.revisions > 1 && (
          <span className="text-[10px] text-amber-500 font-medium">revised ×{entry.revisions - 1}</span>
        )}
      </div>

      {/* Error message */}
      {isError && entry.error && (
        <div className="mt-1.5 text-xs text-red-600 font-mono bg-red-50 rounded p-2">
          {entry.error}
        </div>
      )}

      {/* Error types */}
      {entry.error_types && entry.error_types.length > 0 && (
        <div className="mt-1.5 flex gap-1">
          {entry.error_types.map((et, i) => (
            <span key={i} className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-[10px]">{et}</span>
          ))}
        </div>
      )}

      {/* LLM reasoning preview */}
      {entry.reasoning_preview && (
        <div className="mt-1.5 text-[11px] text-slate-500 bg-slate-50 rounded p-2 line-clamp-3">
          {entry.reasoning_preview}
        </div>
      )}
    </div>
  )
}

/* ── Human PASS/FAIL Button ── */
function HumanPassButton({ trace, onUpdated }: { trace: Trace; onUpdated: (t: Trace) => void }) {
  const [saving, setSaving] = useState(false)

  const handleClick = async (passed: boolean) => {
    setSaving(true)
    try {
      await annotateHumanPass(trace.id, passed)
      onUpdated({ ...trace, human_pass: passed })
    } finally {
      setSaving(false)
    }
  }

  if (trace.human_pass !== null && trace.human_pass !== undefined) {
    const agrees = trace.human_pass === trace.final_pass
    return (
      <div className="flex items-center gap-1.5">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
          trace.human_pass ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
        }`}>
          Human: {trace.human_pass ? 'PASS' : 'FAIL'}
        </span>
        {!agrees && (
          <span className="text-[10px] text-amber-600 font-medium">disagrees</span>
        )}
        <button
          onClick={() => handleClick(!trace.human_pass)}
          disabled={saving}
          className="text-[10px] text-slate-400 hover:text-blue-600"
        >
          flip
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => handleClick(true)}
        disabled={saving}
        className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
      >
        PASS
      </button>
      <button
        onClick={() => handleClick(false)}
        disabled={saving}
        className="px-2 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
      >
        FAIL
      </button>
    </div>
  )
}


/* ── Human Annotation Panel ── */
function HumanAnnotationPanel({ trace, onAnnotated }: { trace: Trace; onAnnotated: (t: Trace) => void }) {
  const [editingGrader, setEditingGrader] = useState<string | null>(null)
  const [humanScore, setHumanScore] = useState('')
  const [humanReasoning, setHumanReasoning] = useState('')
  const [saving, setSaving] = useState(false)

  const graderNames = Object.keys(trace.composite_scores)
  const humanScores = trace.human_scores || {}

  const handleSave = async () => {
    if (!editingGrader || !humanScore) return
    setSaving(true)
    try {
      const result = await annotateGrader(trace.id, editingGrader, Number(humanScore), humanReasoning)
      // Update local state
      const updated = {
        ...trace,
        human_scores: {
          ...trace.human_scores,
          [editingGrader]: { score: Number(humanScore), reasoning: humanReasoning },
        },
      }
      onAnnotated(updated)
      setEditingGrader(null)
      setHumanScore('')
      setHumanReasoning('')
      if (result.agreement) {
        // Could show a toast here
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl bg-white border border-slate-200 p-4">
      <h4 className="text-sm font-semibold text-slate-700 mb-3">
        Human Calibration
      </h4>
      <p className="text-[11px] text-slate-400 mb-3">
        Score each grader dimension to calibrate LLM judges against human judgment.
      </p>

      <div className="space-y-2">
        {graderNames.map(name => {
          const llmData = trace.composite_scores[name]
          const humanData = humanScores[name]
          const isEditing = editingGrader === name

          return (
            <div key={name} className="rounded-lg border border-slate-100 p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600 flex-1 truncate">{name.replace(/_/g, ' ')}</span>
                <span className="text-xs tabular-nums text-slate-500">LLM: {llmData.score.toFixed(0)}</span>
                {humanData ? (
                  <>
                    <span className={`text-xs tabular-nums font-medium ${
                      Math.abs(humanData.score - llmData.score) <= 15 ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      H: {humanData.score}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Δ{Math.abs(humanData.score - llmData.score).toFixed(0)}
                    </span>
                  </>
                ) : (
                  <button
                    onClick={() => { setEditingGrader(name); setHumanScore(''); setHumanReasoning('') }}
                    className="text-[10px] text-blue-600 hover:underline"
                  >
                    annotate
                  </button>
                )}
              </div>

              {isEditing && (
                <div className="mt-2 space-y-1.5">
                  <input
                    type="number"
                    min="0" max="100"
                    value={humanScore}
                    onChange={e => setHumanScore(e.target.value)}
                    placeholder="Score (0-100)"
                    className="w-full px-2 py-1 rounded border border-slate-200 text-xs"
                  />
                  <textarea
                    value={humanReasoning}
                    onChange={e => setHumanReasoning(e.target.value)}
                    placeholder="Reasoning (optional)"
                    rows={2}
                    className="w-full px-2 py-1 rounded border border-slate-200 text-xs resize-none"
                  />
                  <div className="flex gap-1">
                    <button
                      onClick={handleSave}
                      disabled={saving || !humanScore}
                      className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-medium disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => setEditingGrader(null)}
                      className="px-2 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Agreement summary */}
      {Object.keys(humanScores).length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="text-[11px] text-slate-500">
            {(() => {
              const diffs = graderNames
                .filter(n => humanScores[n])
                .map(n => Math.abs(humanScores[n].score - trace.composite_scores[n].score))
              const avgDiff = diffs.length > 0 ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0
              const aligned = diffs.filter(d => d <= 15).length
              return (
                <>
                  <span>Annotated: {Object.keys(humanScores).length}/{graderNames.length}</span>
                  <span className="mx-2">·</span>
                  <span>Avg Δ: {avgDiff.toFixed(1)}</span>
                  <span className="mx-2">·</span>
                  <span className={aligned === diffs.length ? 'text-emerald-600' : 'text-amber-600'}>
                    Aligned: {aligned}/{diffs.length}
                  </span>
                </>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Scores Tab ── */
function ScoresTab({ trace }: { trace: Trace }) {
  const scores = trace.composite_scores
  if (!scores || Object.keys(scores).length === 0) {
    return (
      <div className="rounded-xl bg-white border border-slate-200 p-6 text-center text-slate-400">
        No composite scores available. This trace may use the legacy scoring system.
      </div>
    )
  }

  const entries = Object.entries(scores)
  const totalWeight = entries.reduce((s, [, g]) => s + g.weight, 0)
  const humanScores = trace.human_scores || {}

  return (
    <div className="space-y-4">
      {/* Score Table */}
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Grader</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">LLM Score</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Human</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Weight</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Contrib</th>
              <th className="px-4 py-2 text-center text-xs font-medium text-slate-500">Type</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {entries.map(([name, g]) => {
              const human = humanScores[name]
              const diff = human ? Math.abs(human.score - g.score) : null
              return (
                <tr key={name} className="hover:bg-slate-25">
                  <td className="px-4 py-2.5 font-medium text-slate-700">
                    {name.replace(/_/g, ' ')}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span className={g.score >= 70 ? 'text-emerald-600' : g.score >= 40 ? 'text-amber-600' : 'text-red-600'}>
                      {g.score.toFixed(0)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {human ? (
                      <span className={diff != null && diff <= 15 ? 'text-emerald-600' : 'text-red-600'}>
                        {human.score.toFixed(0)}
                        <span className="text-[10px] text-slate-400 ml-1">Δ{diff?.toFixed(0)}</span>
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-500 tabular-nums">
                    {g.weight.toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-600 tabular-nums font-medium">
                    {(g.score * g.weight / (totalWeight || 1)).toFixed(1)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      g.category === 'llm' ? 'bg-purple-50 text-purple-600' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {g.category}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Error Types */}
      {trace.error_types.length > 0 && (
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <h4 className="text-sm font-semibold text-slate-700 mb-2">Error Classifications</h4>
          <div className="flex flex-wrap gap-1.5">
            {trace.error_types.map((et, i) => (
              <span key={i} className="px-2 py-0.5 rounded bg-red-50 text-red-700 text-xs">
                {et}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Failure Funnel */}
      <FailureFunnel funnel={trace.failure_funnel} />

      {/* Grader Details */}
      {entries.filter(([, g]) => g.details && Object.keys(g.details).length > 0 && !g.details.skipped).map(([name, g]) => (
        <div key={name} className="rounded-xl bg-white border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <h4 className="text-sm font-semibold text-slate-700">{name.replace(/_/g, ' ')} — Details</h4>
            {g.details.revision_count != null && (g.details.revision_count as number) > 1 && (
              <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 text-[10px] font-medium">
                revised ×{(g.details.revision_count as number) - 1}
              </span>
            )}
          </div>
          <div className="text-xs text-slate-600 space-y-1 font-mono">
            {Object.entries(g.details).filter(([k]) => !['reasoning', 'revisions', 'revision_count'].includes(k)).map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <span className="text-slate-400 min-w-[120px]">{k}:</span>
                <span>{typeof v === 'object' ? JSON.stringify(v).slice(0, 100) : String(v)}</span>
              </div>
            ))}
            {g.details.reasoning ? (
              <div className="mt-2 text-slate-500 whitespace-pre-wrap font-sans text-xs">
                {String(g.details.reasoning)}
              </div>
            ) : null}
          </div>

          {/* Revision History */}
          {Array.isArray(g.details.revisions) && (g.details.revisions as Array<Record<string, unknown>>).length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <h5 className="text-[11px] font-semibold text-slate-500 mb-2">Score Revision History</h5>
              <div className="space-y-2">
                {(g.details.revisions as Array<{ score: number; reasoning: string }>).map((rev, ri) => (
                  <div key={ri} className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] text-slate-400 font-medium">v{ri + 1}</span>
                      <span className={`text-xs font-bold tabular-nums ${
                        rev.score >= 70 ? 'text-emerald-600' : rev.score >= 40 ? 'text-amber-600' : 'text-red-600'
                      }`}>
                        {rev.score.toFixed(0)}
                      </span>
                      <span className="material-symbols-outlined text-slate-300" style={{ fontSize: '12px' }}>
                        arrow_forward
                      </span>
                      <span className="text-[10px] text-slate-400">revised to {g.score.toFixed(0)}</span>
                    </div>
                    {rev.reasoning && (
                      <div className="text-[11px] text-slate-500 whitespace-pre-wrap">
                        {rev.reasoning}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function RubricTab({ trace }: { trace: Trace }) {
  const rubricCompliance = trace.composite_scores?.rubric_compliance
  const rubricCoverage = trace.composite_scores?.rubric_coverage
  const trapDetection = trace.composite_scores?.trap_detection

  return (
    <div className="space-y-4">
      {rubricCoverage && !rubricCoverage.details?.skipped && (
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <h4 className="text-sm font-semibold text-slate-700 mb-2">
            Rubric Keyword Coverage — {rubricCoverage.score.toFixed(0)}/100
          </h4>
          <div className="text-xs text-slate-500 mb-2">
            {(rubricCoverage.details?.hits as number) || 0} / {(rubricCoverage.details?.total as number) || 0} keywords found
          </div>
          {rubricCoverage.details?.miss_examples ? (
            <div className="mt-2">
              <div className="text-xs font-medium text-red-600 mb-1">Missing keywords:</div>
              <div className="flex flex-wrap gap-1">
                {(rubricCoverage.details.miss_examples as string[]).map((kw, i) => (
                  <span key={i} className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-[10px]">{kw}</span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {rubricCompliance && !rubricCompliance.details?.skipped && (
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <h4 className="text-sm font-semibold text-slate-700 mb-2">
            Rubric Compliance (LLM Judge) — {rubricCompliance.score.toFixed(0)}/100
          </h4>
          {rubricCompliance.details?.reasoning ? (
            <div className="text-xs text-slate-600 whitespace-pre-wrap bg-slate-50 rounded-lg p-3 mt-2">
              {String(rubricCompliance.details.reasoning)}
            </div>
          ) : null}
        </div>
      )}

      {trapDetection && !trapDetection.details?.skipped && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
          <h4 className="text-sm font-semibold text-amber-800 mb-2">
            Trap Detection — {trapDetection.score.toFixed(0)}/100
          </h4>
          {trapDetection.details?.reasoning ? (
            <div className="text-xs text-amber-700 whitespace-pre-wrap bg-amber-100/50 rounded-lg p-3 mt-2">
              {String(trapDetection.details.reasoning)}
            </div>
          ) : null}
        </div>
      )}

      {!rubricCoverage && !rubricCompliance && !trapDetection && (
        <div className="text-slate-400 text-center py-8">
          No rubric data available for this trace.
        </div>
      )}
    </div>
  )
}
