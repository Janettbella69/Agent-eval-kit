import { Link } from 'react-router-dom'
import ScoreBadge from './ScoreBadge.tsx'
import type { Trace } from '../types.ts'

interface CaseTableProps {
  traces: Trace[]
  sortKey?: string
  onSort?: (key: string) => void
  compact?: boolean
}

export default function CaseTable({ traces, sortKey, onSort, compact }: CaseTableProps) {
  const headers = [
    { key: 'case_key', label: 'Case', width: 'min-w-[180px]' },
    { key: 'final_score', label: 'Score', width: 'w-20' },
    { key: 'human_pass', label: 'Human', width: 'w-16' },
    { key: 'status', label: 'Status', width: 'w-20' },
    { key: 'products', label: 'Prods', width: 'w-14' },
    { key: 'sources', label: 'Srcs', width: 'w-14' },
    { key: 'guide_length', label: 'Guide', width: 'w-16' },
    { key: 'duration_s', label: 'Time', width: 'w-16' },
    { key: 'tokens', label: 'Tokens', width: 'w-20' },
    { key: 'searches', label: 'Searches', width: 'w-16' },
    { key: 'error_types', label: 'Issues', width: 'w-24' },
  ]

  if (compact) {
    // Compact mode: fewer columns
    const compactKeys = ['case_key', 'final_score', 'human_pass', 'status', 'products', 'sources', 'duration_s', 'error_types']
    headers.splice(0, headers.length, ...headers.filter(h => compactKeys.includes(h.key)))
  }

  return (
    <div className="rounded-xl bg-white border border-slate-200 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/80">
            {headers.map(h => (
              <th
                key={h.key}
                className={`px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700 select-none ${h.width} ${
                  sortKey === h.key ? 'text-slate-900 bg-slate-100/50' : ''
                }`}
                onClick={() => onSort?.(h.key)}
              >
                <span className="flex items-center gap-1">
                  {h.label}
                  {sortKey === h.key && (
                    <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>arrow_downward</span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {traces.map(t => {
            const funnelStage = t.failure_funnel?.stage
            const errorCount = t.error_types?.length || 0
            const hm = t.hook_metrics as Record<string, unknown> | undefined
            const searchCount = (hm?.search_count as number) || 0
            const toolHistory = (hm?.tool_call_history as unknown[]) || []
            const totalTokens = (t.input_tokens || 0) + (t.output_tokens || 0)
            const guideLen = t.guide_text?.length || 0

            return (
              <tr key={t.id} className="hover:bg-slate-50/50 transition-colors group">
                {/* Case */}
                <td className="px-3 py-2.5">
                  <Link to={`/traces/${t.id}`} className="text-blue-600 hover:underline font-medium text-xs">
                    {t.case_key}
                  </Link>
                  <div className="text-[10px] text-slate-400 truncate max-w-[200px] mt-0.5">{t.query}</div>
                </td>

                {/* Score */}
                {headers.some(h => h.key === 'final_score') && (
                  <td className="px-3 py-2.5">
                    {t.status === 'done' || t.status === 'graded' || t.status === 'collected' ? (
                      <ScoreBadge score={t.final_score} pass={t.final_pass} size="sm" />
                    ) : (
                      <span className="text-slate-300 text-xs">-</span>
                    )}
                  </td>
                )}

                {/* Human verdict */}
                {headers.some(h => h.key === 'human_pass') && (
                  <td className="px-3 py-2.5">
                    {t.human_pass === true ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700">P</span>
                    ) : t.human_pass === false ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-700">F</span>
                    ) : (
                      <span className="text-slate-300 text-[10px]">—</span>
                    )}
                  </td>
                )}

                {/* Status */}
                {headers.some(h => h.key === 'status') && (
                  <td className="px-3 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      t.status === 'graded' ? 'bg-emerald-50 text-emerald-700'
                        : t.status === 'done' || t.status === 'collected' ? 'bg-blue-50 text-blue-700'
                        : t.status === 'running' ? 'bg-amber-50 text-amber-700'
                        : t.status === 'error' ? 'bg-red-50 text-red-700'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {t.status}
                    </span>
                  </td>
                )}

                {/* Products */}
                {headers.some(h => h.key === 'products') && (
                  <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600 text-center">
                    {t.products?.length || 0}
                  </td>
                )}

                {/* Sources */}
                {headers.some(h => h.key === 'sources') && (
                  <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600 text-center">
                    {t.sources?.length || 0}
                  </td>
                )}

                {/* Guide length */}
                {headers.some(h => h.key === 'guide_length') && (
                  <td className="px-3 py-2.5 text-[10px] tabular-nums text-slate-500">
                    {guideLen > 0 ? `${(guideLen / 1000).toFixed(1)}k` : '-'}
                  </td>
                )}

                {/* Duration */}
                {headers.some(h => h.key === 'duration_s') && (
                  <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600">
                    {t.duration_s > 0 ? `${t.duration_s.toFixed(0)}s` : '-'}
                  </td>
                )}

                {/* Tokens */}
                {headers.some(h => h.key === 'tokens') && (
                  <td className="px-3 py-2.5 text-[10px] tabular-nums text-slate-500">
                    {totalTokens > 0 ? `${(totalTokens / 1000).toFixed(0)}k` : '-'}
                  </td>
                )}

                {/* Searches */}
                {headers.some(h => h.key === 'searches') && (
                  <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600 text-center">
                    {searchCount > 0 ? searchCount : toolHistory.length > 0 ? toolHistory.length : '-'}
                  </td>
                )}

                {/* Issues */}
                {headers.some(h => h.key === 'error_types') && (
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      {funnelStage && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-600 truncate max-w-[80px]">
                          {funnelStage.replace('_', ' ')}
                        </span>
                      )}
                      {errorCount > 0 && !funnelStage && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-600">
                          {errorCount}
                        </span>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            )
          })}
          {traces.length === 0 && (
            <tr>
              <td colSpan={headers.length} className="px-4 py-8 text-center text-slate-400 text-sm">
                No traces found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
