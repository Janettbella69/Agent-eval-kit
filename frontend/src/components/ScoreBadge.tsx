interface ScoreBadgeProps {
  score: number
  pass: boolean
  size?: 'sm' | 'md' | 'lg'
}

export default function ScoreBadge({ score, pass, size = 'md' }: ScoreBadgeProps) {
  const bg = pass ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-red-50 text-red-700 ring-red-200'
  const sizeClass = size === 'sm' ? 'text-xs px-1.5 py-0.5'
    : size === 'lg' ? 'text-lg px-3 py-1'
    : 'text-sm px-2 py-0.5'

  return (
    <span className={`inline-flex items-center gap-1 rounded-full ring-1 font-semibold tabular-nums ${bg} ${sizeClass}`}>
      {Math.round(score)}
      <span className="text-[0.7em] font-normal opacity-70">{pass ? 'PASS' : 'FAIL'}</span>
    </span>
  )
}
