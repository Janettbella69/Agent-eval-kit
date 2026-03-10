import { useState, useEffect, useRef } from 'react'
import type { WsMessage } from '../types.ts'

interface RunProgressProps {
  experimentId: number
  onComplete?: () => void
}

interface CaseProgress {
  case_key: string
  status: 'pending' | 'running' | 'done' | 'error'
  score?: number
  passed?: boolean
  duration_s?: number
}

export default function RunProgress({ experimentId, onComplete }: RunProgressProps) {
  const [cases, setCases] = useState<Map<string, CaseProgress>>(new Map())
  const [total, setTotal] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const basePath = import.meta.env.BASE_URL.replace(/\/$/, '')
    const ws = new WebSocket(`${protocol}//${window.location.host}${basePath}/ws/experiments/${experimentId}`)
    wsRef.current = ws

    ws.onmessage = (event) => {
      const msg: WsMessage = JSON.parse(event.data)

      if (msg.type === 'experiment_start') {
        setTotal(msg.total ?? 0)
      } else if (msg.type === 'case_start' && msg.case_key) {
        setCases(prev => {
          const next = new Map(prev)
          next.set(`${msg.case_key}-${msg.trial_num ?? 1}`, {
            case_key: msg.case_key!,
            status: 'running',
          })
          return next
        })
      } else if (msg.type === 'case_done' && msg.case_key) {
        setCases(prev => {
          const next = new Map(prev)
          next.set(`${msg.case_key}-${msg.trial_num ?? 1}`, {
            case_key: msg.case_key!,
            status: 'done',
            score: msg.score,
            passed: msg.passed,
            duration_s: msg.duration_s,
          })
          return next
        })
      } else if (msg.type === 'experiment_done') {
        onComplete?.()
      }
    }

    ws.onerror = () => ws.close()

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [experimentId, onComplete])

  const completed = Array.from(cases.values()).filter(c => c.status === 'done').length
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="rounded-xl bg-white border border-slate-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700">Running...</h4>
        <span className="text-sm text-slate-500 tabular-nums">{completed}/{total}</span>
      </div>

      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-2 rounded-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {Array.from(cases.values()).map(c => (
          <div
            key={`${c.case_key}`}
            className={`px-2 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
              c.status === 'running' ? 'bg-blue-50 text-blue-700 animate-pulse'
                : c.status === 'done' && c.passed ? 'bg-emerald-50 text-emerald-700'
                : c.status === 'done' ? 'bg-red-50 text-red-700'
                : 'bg-slate-50 text-slate-500'
            }`}
          >
            {c.status === 'running' && <span className="material-symbols-outlined animate-spin" style={{ fontSize: '14px' }}>progress_activity</span>}
            {c.status === 'done' && c.passed && <span>✓</span>}
            {c.status === 'done' && !c.passed && <span>✗</span>}
            <span className="truncate">{c.case_key}</span>
            {c.score !== undefined && <span className="ml-auto tabular-nums">{Math.round(c.score)}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
