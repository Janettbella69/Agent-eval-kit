import type { FunnelResult } from '../types.ts'

const STAGES = ['understand', 'search', 'extract', 'match_rubric', 'generate']

interface FailureFunnelProps {
  funnel: FunnelResult
  compact?: boolean
}

export default function FailureFunnel({ funnel, compact }: FailureFunnelProps) {
  if (!funnel || !funnel.stages || Object.keys(funnel.stages).length === 0) {
    return null
  }

  if (compact) {
    return (
      <div className="flex items-center gap-1 text-xs">
        {STAGES.map((stage, i) => {
          const status = funnel.stages[stage]
          return (
            <span key={stage} className="flex items-center gap-0.5">
              {i > 0 && <span className="text-slate-300">&rarr;</span>}
              <span className={status === 'pass' ? 'text-emerald-600' : status === 'fail' ? 'text-red-600 font-semibold' : 'text-slate-400'}>
                {status === 'pass' ? '✓' : status === 'fail' ? '✗' : '?'}
              </span>
              <span className={status === 'fail' ? 'text-red-600 font-medium' : 'text-slate-500'}>
                {stage.replace('_', ' ')}
              </span>
            </span>
          )
        })}
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-white border border-slate-200 p-4">
      <h4 className="text-sm font-semibold text-slate-700 mb-3">
        Failure Funnel {!funnel.stage && <span className="text-emerald-600 font-normal ml-1">All stages passed</span>}
      </h4>

      <div className="flex items-center gap-2 flex-wrap">
        {STAGES.map((stage, i) => {
          const status = funnel.stages[stage]
          const isFail = status === 'fail'
          const isFirstFail = stage === funnel.stage
          return (
            <div key={stage} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-slate-300 text-lg">&rarr;</span>}
              <div className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                isFail
                  ? isFirstFail
                    ? 'bg-red-100 text-red-700 ring-2 ring-red-300'
                    : 'bg-red-50 text-red-600'
                  : 'bg-emerald-50 text-emerald-700'
              }`}>
                {status === 'pass' ? '✓' : '✗'} {stage.replace('_', ' ')}
              </div>
            </div>
          )
        })}
      </div>

      {funnel.reason && (
        <div className="mt-3 text-xs text-slate-500 bg-slate-50 rounded-lg p-2">
          {funnel.reason}
        </div>
      )}
    </div>
  )
}
