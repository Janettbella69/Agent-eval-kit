import { useState, useEffect, useRef } from 'react'
import type { WsMessage } from '../types.ts'

interface RunProgressProps {
  experimentId: number
  onComplete?: () => void
}

interface CaseProgress {
  case_key: string
  status: 'pending' | 'running' | 'collected' | 'grading' | 'done' | 'error'
  score?: number
  passed?: boolean
  duration_s?: number
}

export default function RunProgress({ experimentId, onComplete }: RunProgressProps) {
  const [cases, setCases] = useState<Map<string, CaseProgress>>(new Map())
  const [total, setTotal] = useState(0)
  const [phase, setPhase] = useState<'streaming' | 'done'>('streaming')
  const [gradingDone, setGradingDone] = useState(0)
  const [incrementalStats, setIncrementalStats] = useState<{ avg_score: number; pass_rate: number } | null>(null)
  const [circuitBreak, setCircuitBreak] = useState<string | null>(null)
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
      } else if (msg.type === 'case_collected' && msg.case_key) {
        setCases(prev => {
          const next = new Map(prev)
          next.set(`${msg.case_key}-${msg.trial_num ?? 1}`, {
            case_key: msg.case_key!,
            status: 'collected',
            duration_s: msg.duration_s,
          })
          return next
        })
      } else if (msg.type === 'grading_start') {
        // Legacy: ignored in streaming mode (grading overlaps with collection)
      } else if (msg.type === 'case_grading' && msg.case_key) {
        setCases(prev => {
          const next = new Map(prev)
          const key = `${msg.case_key}-${msg.trial_num ?? 1}`
          const existing = next.get(key)
          if (existing) {
            next.set(key, { ...existing, status: 'grading' })
          }
          return next
        })
      } else if (msg.type === 'incremental_summary') {
        setIncrementalStats({
          avg_score: msg.avg_score ?? 0,
          pass_rate: msg.pass_rate ?? 0,
        })
      } else if (msg.type === 'case_graded' && msg.case_key) {
        setGradingDone(prev => prev + 1)
        setCases(prev => {
          const next = new Map(prev)
          next.set(`${msg.case_key}-${msg.trial_num ?? 1}`, {
            case_key: msg.case_key!,
            status: 'done',
            score: msg.score,
            passed: msg.passed,
          })
          return next
        })
      } else if (msg.type === 'case_error' && msg.case_key) {
        setCases(prev => {
          const next = new Map(prev)
          next.set(`${msg.case_key}-${msg.trial_num ?? 1}`, {
            case_key: msg.case_key!,
            status: 'error',
          })
          return next
        })
      } else if (msg.type === 'case_done' && msg.case_key) {
        // Legacy event — treat as graded
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
      } else if (msg.type === 'circuit_break') {
        setCircuitBreak(msg.reason || 'Circuit breaker triggered')
      } else if (msg.type === 'experiment_done') {
        setPhase('done')
        onComplete?.()
      }
    }

    ws.onerror = () => ws.close()

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [experimentId, onComplete])

  const allCases = Array.from(cases.values())
  const collected = allCases.filter(c => !['pending', 'running'].includes(c.status)).length
  const grading = allCases.filter(c => c.status === 'grading').length
  const done = allCases.filter(c => c.status === 'done').length
  const errors = allCases.filter(c => c.status === 'error').length
  const progressPct = total > 0 ? Math.round(((done + errors) / total) * 100) : 0

  return (
    <div className="rounded-xl bg-white border border-slate-200 p-4 space-y-4">
      {/* Pipeline Progress (single unified bar) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-700">
            {phase === 'done' ? 'Complete' : 'Running...'}
          </h4>
          <div className="flex items-center gap-3 text-xs text-slate-500 tabular-nums">
            {collected > done && <span className="text-blue-600">{collected - done - grading} collected</span>}
            {grading > 0 && <span className="text-purple-600">{grading} grading</span>}
            <span className="text-emerald-600">{done} done</span>
            {errors > 0 && <span className="text-red-500">{errors} errors</span>}
            <span className="font-medium text-slate-700">{done + errors}/{total}</span>
          </div>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-2 rounded-full transition-all duration-500 ${
              phase === 'done' ? 'bg-emerald-500' : 'bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-500'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Incremental Stats */}
      {incrementalStats && (
        <div className="flex items-center gap-4 text-sm">
          <span className="text-slate-500">Avg Score:</span>
          <span className={`font-bold tabular-nums ${incrementalStats.avg_score >= 70 ? 'text-emerald-600' : incrementalStats.avg_score >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
            {incrementalStats.avg_score.toFixed(1)}
          </span>
          <span className="text-slate-500">Pass Rate:</span>
          <span className={`font-bold tabular-nums ${incrementalStats.pass_rate >= 70 ? 'text-emerald-600' : 'text-amber-600'}`}>
            {incrementalStats.pass_rate.toFixed(0)}%
          </span>
          <span className="text-[10px] text-slate-400">(based on {gradingDone} graded)</span>
        </div>
      )}

      {/* Circuit Breaker Warning */}
      {circuitBreak && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <span className="font-medium">Paused:</span> {circuitBreak}
        </div>
      )}

      {/* Case Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {Array.from(cases.values()).map(c => (
          <div
            key={`${c.case_key}`}
            className={`px-2 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 ${
              c.status === 'running' ? 'bg-blue-50 text-blue-700 animate-pulse'
                : c.status === 'collected' ? 'bg-sky-50 text-sky-700'
                : c.status === 'grading' ? 'bg-purple-50 text-purple-700 animate-pulse'
                : c.status === 'done' && c.passed ? 'bg-emerald-50 text-emerald-700'
                : c.status === 'done' ? 'bg-red-50 text-red-700'
                : c.status === 'error' ? 'bg-red-50 text-red-600'
                : 'bg-slate-50 text-slate-500'
            }`}
          >
            {c.status === 'running' && <span className="material-symbols-outlined animate-spin" style={{ fontSize: '14px' }}>progress_activity</span>}
            {c.status === 'collected' && <span>&#x25CB;</span>}
            {c.status === 'grading' && <span className="material-symbols-outlined animate-spin" style={{ fontSize: '14px' }}>grading</span>}
            {c.status === 'done' && c.passed && <span>&#x2713;</span>}
            {c.status === 'done' && !c.passed && <span>&#x2717;</span>}
            {c.status === 'error' && <span>!</span>}
            <span className="truncate">{c.case_key}</span>
            {c.score !== undefined && <span className="ml-auto tabular-nums">{Math.round(c.score)}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
