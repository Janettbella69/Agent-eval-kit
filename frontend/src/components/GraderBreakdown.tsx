import ScoreBar from './ScoreBar.tsx'
import type { CompositeGraderScore, FunnelResult } from '../types.ts'
import FailureFunnel from './FailureFunnel.tsx'

interface GraderBreakdownProps {
  l0: Record<string, unknown>
  l1: Record<string, unknown>
  l2: Record<string, unknown> | null
  compositeScores?: Record<string, CompositeGraderScore>
  failureFunnel?: FunnelResult
  gate?: { results: Record<string, boolean>; passed: boolean }
}

export default function GraderBreakdown({ l0, l1, l2, compositeScores, failureFunnel, gate }: GraderBreakdownProps) {
  const hasComposite = compositeScores && Object.keys(compositeScores).length > 0

  if (hasComposite) {
    return <CompositeView compositeScores={compositeScores!} gate={gate} failureFunnel={failureFunnel} />
  }

  return <LegacyView l0={l0} l1={l1} l2={l2} />
}

function CompositeView({
  compositeScores,
  gate,
  failureFunnel,
}: {
  compositeScores: Record<string, CompositeGraderScore>
  gate?: { results: Record<string, boolean>; passed: boolean }
  failureFunnel?: FunnelResult
}) {
  const entries = Object.entries(compositeScores)
  const totalWeight = entries.reduce((s, [, g]) => s + g.weight, 0)
  const weightedScore = totalWeight > 0
    ? entries.reduce((s, [, g]) => s + g.score * (g.weight / totalWeight), 0)
    : 0

  return (
    <div className="space-y-4">
      {/* Pass/Fail Gate */}
      {gate && (
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <h4 className="text-sm font-semibold text-slate-700 mb-2">
            Pass/Fail Gate {gate.passed
              ? <span className="text-emerald-600 ml-1">PASS</span>
              : <span className="text-red-600 ml-1">FAIL</span>}
          </h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(gate.results).map(([k, v]) => (
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

      {/* Composite Scores */}
      <div className="rounded-xl bg-white border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-slate-700">Composite Score</h4>
          <span className="text-lg font-bold text-slate-900 tabular-nums">{weightedScore.toFixed(1)}</span>
        </div>
        <div className="space-y-2.5">
          {entries.map(([name, g]) => (
            <div key={name}>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="w-40 text-xs text-slate-500 truncate" title={name}>
                  {name.replace(/_/g, ' ')}
                </span>
                <div className="flex-1">
                  <ScoreBar score={g.score} maxScore={100} size="sm" showLabel={false} />
                </div>
                <span className="w-10 text-right text-xs tabular-nums font-medium text-slate-700">
                  {g.score.toFixed(0)}
                </span>
                <span className={`w-10 text-right text-[10px] ${
                  g.category === 'llm' ? 'text-purple-500' : 'text-slate-400'
                }`}>
                  {g.category}
                </span>
              </div>
              <div className="flex items-center gap-2 ml-[168px]">
                <span className="text-[10px] text-slate-400">w={g.weight.toFixed(2)}</span>
                <span className="text-[10px] text-slate-400 tabular-nums">
                  contrib={(g.score * g.weight / (totalWeight || 1)).toFixed(1)}
                </span>
                {g.details?.revision_count != null && (g.details.revision_count as number) > 1 && (
                  <span className="text-[10px] text-amber-500 font-medium" title="Judge revised its score">
                    revised ×{(g.details.revision_count as number) - 1}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Failure Funnel */}
      {failureFunnel && <FailureFunnel funnel={failureFunnel} />}
    </div>
  )
}

function LegacyView({
  l0,
  l1,
  l2,
}: {
  l0: Record<string, unknown>
  l1: Record<string, unknown>
  l2: Record<string, unknown> | null
}) {
  const structure = (l0?.structure ?? {}) as Record<string, boolean>
  const constraints = l0?.constraints as Record<string, unknown> | undefined
  const l1Breakdown = l1 as Record<string, { value: number; threshold: number; earned: number; weight: number; ratio: number }>
  const l2Dims = (l2?.dimensions ?? {}) as Record<string, string>

  return (
    <div className="space-y-4">
      {/* L0 Structure */}
      <div className="rounded-xl bg-white border border-slate-200 p-4">
        <h4 className="text-sm font-semibold text-slate-700 mb-2">L0 Structure</h4>
        <div className="flex flex-wrap gap-2">
          {Object.entries(structure).map(([k, v]) => (
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
        {constraints?.constraint_score != null && (
          <div className="mt-2 text-xs text-slate-500">
            Constraint satisfaction: {Math.round((constraints.constraint_score as number) * 100)}%
          </div>
        )}
      </div>

      {/* L1 Metrics */}
      <div className="rounded-xl bg-white border border-slate-200 p-4">
        <h4 className="text-sm font-semibold text-slate-700 mb-3">L1 Metrics</h4>
        <div className="space-y-2">
          {Object.entries(l1Breakdown).filter(([, v]) => v && typeof v === 'object' && 'weight' in v).map(([metric, data]) => (
            <div key={metric} className="flex items-center gap-3">
              <span className="w-40 text-xs text-slate-500 truncate" title={metric}>
                {metric.replace(/_/g, ' ')}
              </span>
              <div className="flex-1">
                <ScoreBar score={data.earned} maxScore={data.weight} size="sm" showLabel={false} />
              </div>
              <span className="w-14 text-right text-xs tabular-nums text-slate-600">
                {data.earned}/{data.weight}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* L2 Judge */}
      {l2 && Object.keys(l2Dims).length > 0 && (
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <h4 className="text-sm font-semibold text-slate-700 mb-2">L2 Judge</h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(l2Dims).map(([dim, verdict]) => (
              <span
                key={dim}
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  verdict === 'PASS' ? 'bg-emerald-50 text-emerald-700'
                    : verdict === 'FAIL' ? 'bg-red-50 text-red-700'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {verdict === 'PASS' ? '✓' : verdict === 'FAIL' ? '✗' : '?'} {dim}
              </span>
            ))}
          </div>
          {l2.l2_score != null && (
            <div className="mt-2 text-xs text-slate-500">
              L2 Score: {Math.round(l2.l2_score as number)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
