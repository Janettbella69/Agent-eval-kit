import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import type { Experiment } from '../types.ts'

interface ScoreTrendChartProps {
  experiments: Experiment[]
}

export default function ScoreTrendChart({ experiments }: ScoreTrendChartProps) {
  const data = experiments
    .filter(e => e.status === 'complete' && e.summary?.avg_score > 0)
    .reverse()
    .map(e => ({
      name: e.tag || `#${e.id}`,
      avg: e.summary.avg_score,
      median: e.summary.median_score,
      passRate: e.summary.total_cases > 0
        ? Math.round((e.summary.passed / e.summary.total_cases) * 100)
        : 0,
    }))

  if (data.length < 2) {
    return (
      <div className="rounded-xl bg-white border border-slate-200 p-6 text-center text-sm text-slate-400">
        Need at least 2 completed experiments to show trends.
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-white border border-slate-200 p-4">
      <h4 className="text-sm font-semibold text-slate-700 mb-3">Score Trend</h4>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
          <Tooltip />
          <ReferenceLine y={70} stroke="#f59e0b" strokeDasharray="5 5" label="Pass" />
          <Line type="monotone" dataKey="avg" stroke="#059669" strokeWidth={2} name="Avg Score" />
          <Line type="monotone" dataKey="median" stroke="#2563eb" strokeWidth={1.5} strokeDasharray="4 4" name="Median" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
