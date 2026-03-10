interface ScoreBarProps {
  score: number
  maxScore?: number
  showLabel?: boolean
  size?: 'sm' | 'md'
}

export default function ScoreBar({ score, maxScore = 100, showLabel = true, size = 'md' }: ScoreBarProps) {
  const pct = Math.min(Math.round((score / maxScore) * 100), 100)
  const color = score >= 70 ? 'bg-emerald-500' : score >= 40 ? 'bg-amber-400' : 'bg-red-500'
  const textColor = score >= 70 ? 'text-emerald-700' : score >= 40 ? 'text-amber-700' : 'text-red-700'
  const h = size === 'sm' ? 'h-1.5' : 'h-2.5'

  return (
    <div className="flex items-center gap-2">
      <div className={`flex-1 ${h} rounded-full bg-slate-100 overflow-hidden`}>
        <div
          className={`${h} rounded-full ${color} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className={`text-sm font-semibold tabular-nums ${textColor}`}>
          {Math.round(score)}
        </span>
      )}
    </div>
  )
}
