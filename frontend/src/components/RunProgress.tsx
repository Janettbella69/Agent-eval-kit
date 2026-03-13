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
  const [phase, setPhase] = useState<'collecting' | 'grading' | 'done'>('collecting')
  const [gradingTotal, setGradingTotal] = useState(0)
  const [gradingDone, setGradingDone] = useState(0)
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
        setPhase('grading')
        setGradingTotal(msg.total ?? 0)
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

  const collected = Array.from(cases.values()).filter(c => c.status !== 'pending' && c.status !== 'running').length
  const collectPct = total > 0 ? Math.round((collected / total) * 100) : 0
  const gradePct = gradingTotal > 0 ? Math.round((gradingDone / gradingTotal) * 100) : 0

  return (
    <div className="rounded-xl bg-white border border-slate-200 p-4 space-y-4">
      {/* Phase 1: Collecting */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-700">
            {phase === 'collecting' ? 'Collecting...' : 'Collection Complete'}
          </h4>
          <span className="text-sm text-slate-500 tabular-nums">{collected}/{total}</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-2 rounded-full transition-all duration-300 ${
              phase === 'collecting' ? 'bg-blue-500' : 'bg-emerald-500'
            }`}
            style={{ width: `${collectPct}%` }}
          />
        </div>
      </div>

      {/* Phase 2: Grading */}
      {(phase === 'grading' || phase === 'done') && gradingTotal > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-700">
              {phase === 'grading' ? 'Grading...' : 'Grading Complete'}
            </h4>
            <span className="text-sm text-slate-500 tabular-nums">{gradingDone}/{gradingTotal}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-2 rounded-full transition-all duration-300 ${
                phase === 'grading' ? 'bg-purple-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${gradePct}%` }}
            />
          </div>
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
                : c.status === 'done' && c.passed ? 'bg-emerald-50 text-emerald-700'
                : c.status === 'done' ? 'bg-red-50 text-red-700'
                : c.status === 'error' ? 'bg-red-50 text-red-600'
                : 'bg-slate-50 text-slate-500'
            }`}
          >
            {c.status === 'running' && <span className="material-symbols-outlined animate-spin" style={{ fontSize: '14px' }}>progress_activity</span>}
            {c.status === 'collected' && <span>&#x25CB;</span>}
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
