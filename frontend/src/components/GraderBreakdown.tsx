import ScoreBar from './ScoreBar.tsx'

interface GraderBreakdownProps {
  l0: Record<string, unknown>
  l1: Record<string, unknown>
  l2: Record<string, unknown> | null
}

export default function GraderBreakdown({ l0, l1, l2 }: GraderBreakdownProps) {
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
