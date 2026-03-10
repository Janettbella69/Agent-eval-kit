import { Link } from 'react-router-dom'
import ScoreBadge from './ScoreBadge.tsx'
import type { Trace } from '../types.ts'

interface CaseTableProps {
  traces: Trace[]
  sortKey?: string
  onSort?: (key: string) => void
}

export default function CaseTable({ traces, sortKey, onSort }: CaseTableProps) {
  const headers = [
    { key: 'case_key', label: 'Case' },
    { key: 'trial_num', label: 'Trial' },
    { key: 'case_type', label: 'Type' },
    { key: 'final_score', label: 'Score' },
    { key: 'duration_s', label: 'Duration' },
    { key: 'status', label: 'Status' },
  ]

  return (
    <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50">
            {headers.map(h => (
              <th
                key={h.key}
                className={`px-4 py-2.5 text-left text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700 ${
                  sortKey === h.key ? 'text-slate-900' : ''
                }`}
                onClick={() => onSort?.(h.key)}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {traces.map(t => (
            <tr key={t.id} className="hover:bg-slate-25 transition-colors">
              <td className="px-4 py-2.5">
                <Link to={`/traces/${t.id}`} className="text-blue-600 hover:underline font-medium">
                  {t.case_key}
                </Link>
                <div className="text-xs text-slate-400 truncate max-w-xs">{t.query}</div>
              </td>
              <td className="px-4 py-2.5 text-slate-600">#{t.trial_num}</td>
              <td className="px-4 py-2.5">
                <span className="px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-600">
                  {t.case_type}
                </span>
              </td>
              <td className="px-4 py-2.5">
                {t.status === 'done' ? (
                  <ScoreBadge score={t.final_score} pass={t.final_pass} size="sm" />
                ) : (
                  <span className="text-slate-400 text-xs">-</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-slate-600 tabular-nums">
                {t.duration_s > 0 ? `${t.duration_s.toFixed(1)}s` : '-'}
              </td>
              <td className="px-4 py-2.5">
                <span className={`text-xs font-medium ${
                  t.status === 'done' ? 'text-emerald-600'
                    : t.status === 'running' ? 'text-blue-600'
                    : t.status === 'error' ? 'text-red-600'
                    : 'text-slate-400'
                }`}>
                  {t.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
