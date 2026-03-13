import { useState, useMemo } from 'react'

interface TraceTimelineProps {
  events: Record<string, unknown>[]
}

const EVENT_CONFIG: Record<string, { color: string; icon: string; label: string }> = {
  search_progress: { color: 'text-blue-600 bg-blue-50', icon: 'search', label: '搜索' },
  product_found:   { color: 'text-emerald-600 bg-emerald-50', icon: 'shopping_bag', label: '产品' },
  product_preview: { color: 'text-emerald-500 bg-emerald-50', icon: 'image', label: '预览' },
  text:            { color: 'text-slate-600 bg-slate-50', icon: 'article', label: '文本' },
  text_delta:      { color: 'text-slate-400 bg-slate-50', icon: 'edit_note', label: '增量' },
  sources:         { color: 'text-purple-600 bg-purple-50', icon: 'link', label: '来源' },
  clarification:   { color: 'text-amber-600 bg-amber-50', icon: 'help', label: '澄清' },
  search_meta:     { color: 'text-slate-500 bg-slate-50', icon: 'info', label: '元数据' },
  error:           { color: 'text-red-600 bg-red-50', icon: 'error', label: '错误' },
  done:            { color: 'text-emerald-700 bg-emerald-50', icon: 'check_circle', label: '完成' },
}

type EnrichedEvent = Record<string, unknown> & { _index: number; _relativeS: number | null }

function getEventSummary(event: Record<string, unknown>): string {
  const type = event.type as string
  if (type === 'search_progress') return (event.query as string) || (event.phase as string) || ''
  if (type === 'product_found') {
    const p = event.product as Record<string, unknown> | undefined
    const name = (p?.name as string) || ''
    const price = (p?.price as string) || ''
    return price ? `${name} — ${price}` : name
  }
  if (type === 'product_preview') return `${(event.count as number) || 0} images`
  if (type === 'sources') {
    const s = event.sources as unknown[]
    return `${s?.length || 0} sources`
  }
  if (type === 'text' || type === 'text_delta') {
    const content = (event.content as string) || ''
    return content.length > 120 ? content.slice(0, 120) + '…' : content
  }
  if (type === 'error') return (event.message as string) || ''
  if (type === 'clarification') {
    const q = event.question as Record<string, unknown> | undefined
    return (q?.question as string) || ''
  }
  if (type === 'search_meta') return `${(event.products_viewed as number) || 0} products viewed`
  return ''
}

/* ── Phase grouping with duration ── */
interface PhaseGroup {
  label: string
  icon: string
  color: string
  startIdx: number
  endIdx: number
  durationS: number | null
  events: EnrichedEvent[]
}

function computePhases(enriched: EnrichedEvent[]): PhaseGroup[] {
  const phases: PhaseGroup[] = []
  let current: PhaseGroup | null = null

  for (const e of enriched) {
    const type = e.type as string
    let phaseLabel: string | null = null

    if (type === 'search_progress' && current?.label !== 'Searching') {
      phaseLabel = 'Searching'
    } else if (type === 'product_found' && current?.label !== 'Products Found') {
      phaseLabel = 'Products Found'
    } else if ((type === 'text' || type === 'text_delta') && current?.label !== 'Generating Guide') {
      phaseLabel = 'Generating Guide'
    } else if (type === 'sources' && current?.label !== 'Sources') {
      phaseLabel = 'Sources'
    } else if (type === 'clarification' && current?.label !== 'Clarification') {
      phaseLabel = 'Clarification'
    }

    if (phaseLabel) {
      if (current) {
        current.endIdx = e._index - 1
        const lastEvt = enriched.find(x => x._index === current!.endIdx)
        if (current.events[0]._relativeS !== null && lastEvt && lastEvt._relativeS !== null) {
          current.durationS = lastEvt._relativeS - current.events[0]._relativeS
        }
      }
      current = {
        label: phaseLabel,
        icon: EVENT_CONFIG[type]?.icon || 'circle',
        color: EVENT_CONFIG[type]?.color || 'text-slate-500 bg-slate-50',
        startIdx: e._index,
        endIdx: e._index,
        durationS: null,
        events: [],
      }
      phases.push(current)
    }

    if (current) {
      current.events.push(e)
      current.endIdx = e._index
    }
  }

  // Close last phase
  if (current && current.events.length > 0) {
    const first = current.events[0]
    const last = current.events[current.events.length - 1]
    if (first._relativeS !== null && last._relativeS !== null) {
      current.durationS = last._relativeS - first._relativeS
    }
  }

  return phases
}

/* ── Expandable event row ── */
function EventRow({ event, isExpanded, onToggle }: {
  event: EnrichedEvent
  isExpanded: boolean
  onToggle: () => void
}) {
  const type = (event.type as string) || 'unknown'
  const cfg = EVENT_CONFIG[type] || { color: 'text-slate-600 bg-slate-50', icon: 'circle', label: type }
  const summary = getEventSummary(event)

  // Build detail JSON (exclude internal fields)
  const detailKeys = Object.keys(event).filter(k => !k.startsWith('_') && k !== 'type')

  return (
    <div>
      <div
        className="flex items-start gap-2 py-1 text-xs cursor-pointer hover:bg-slate-50/50 rounded -mx-1 px-1 transition-colors"
        onClick={onToggle}
      >
        {/* Timestamp */}
        <span className="w-14 text-right text-slate-400 shrink-0 tabular-nums font-mono pt-0.5">
          {event._relativeS !== null ? `${event._relativeS.toFixed(1)}s` : `#${event._index + 1}`}
        </span>

        {/* Icon */}
        <span className={`material-symbols-outlined shrink-0 ${cfg.color.split(' ')[0]}`} style={{ fontSize: '14px' }}>
          {cfg.icon}
        </span>

        {/* Type badge + summary */}
        <div className="flex-1 min-w-0">
          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${cfg.color}`}>
            {type}
          </span>
          {summary && (
            <span className="ml-2 text-slate-600 break-words">{summary}</span>
          )}
        </div>

        {/* Expand indicator */}
        {detailKeys.length > 0 && (
          <span className="material-symbols-outlined text-slate-300 shrink-0" style={{ fontSize: '14px' }}>
            {isExpanded ? 'expand_less' : 'expand_more'}
          </span>
        )}
      </div>

      {/* Expanded detail */}
      {isExpanded && detailKeys.length > 0 && (
        <div className="ml-[72px] mb-2 rounded-lg bg-slate-50 border border-slate-100 p-2.5 text-[11px]">
          {detailKeys.map(k => {
            const val = event[k]
            const valStr = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val)
            const isLong = valStr.length > 200

            return (
              <div key={k} className="flex gap-2 py-0.5">
                <span className="text-slate-400 font-mono shrink-0 min-w-[80px]">{k}:</span>
                <span className={`text-slate-600 font-mono break-all ${isLong ? 'whitespace-pre-wrap max-h-40 overflow-y-auto' : ''}`}>
                  {valStr}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Main Timeline ── */
export default function TraceTimeline({ events }: TraceTimelineProps) {
  const [expandedIdx, setExpandedIdx] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'timeline' | 'phases'>('phases')
  const [showAll, setShowAll] = useState(false)

  // Enrich events with relative timestamps
  const enriched = useMemo<EnrichedEvent[]>(() => {
    let baseTime = 0
    return events.map((event, i) => {
      const ts = (event._ts as number) || (event.timestamp as number) || 0
      if (i === 0 && ts) baseTime = ts
      const relativeS = ts && baseTime ? (ts - baseTime) / 1000 : null
      return { ...event, _index: i, _relativeS: relativeS }
    })
  }, [events])

  // Unique event types
  const eventTypes = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of events) {
      const t = (e.type as string) || 'unknown'
      counts.set(t, (counts.get(t) || 0) + 1)
    }
    return Array.from(counts.entries())
  }, [events])

  // Phase groups
  const phases = useMemo(() => computePhases(enriched), [enriched])

  // Total duration
  const totalDurationS = useMemo(() => {
    if (enriched.length < 2) return null
    const first = enriched[0]._relativeS
    const last = enriched[enriched.length - 1]._relativeS
    return first !== null && last !== null ? last - first : null
  }, [enriched])

  const filtered = filter ? enriched.filter(e => (e.type as string) === filter) : enriched
  const displayEvents = showAll ? filtered : filtered.slice(0, 30)

  const toggleExpand = (idx: number) => {
    setExpandedIdx(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  return (
    <div className="rounded-xl bg-white border border-slate-200 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-semibold text-slate-700">
            Agent 轨迹
          </h4>
          <span className="text-xs text-slate-400 tabular-nums">
            {events.length} events
            {totalDurationS !== null && ` · ${totalDurationS.toFixed(1)}s`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('phases')}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                viewMode === 'phases' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'
              }`}
            >
              Phases
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                viewMode === 'timeline' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'
              }`}
            >
              Timeline
            </button>
          </div>
        </div>
      </div>

      {/* Type filters */}
      {eventTypes.length > 1 && (
        <div className="flex flex-wrap gap-1 mb-3">
          <button
            onClick={() => setFilter(null)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              !filter ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            All ({events.length})
          </button>
          {eventTypes.map(([t, count]) => {
            const cfg = EVENT_CONFIG[t]
            return (
              <button
                key={t}
                onClick={() => setFilter(filter === t ? null : t)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  filter === t
                    ? 'bg-slate-800 text-white'
                    : `${cfg?.color || 'bg-slate-100 text-slate-500'} hover:opacity-80`
                }`}
              >
                {cfg?.label || t} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Phase View */}
      {viewMode === 'phases' && !filter && (
        <PhaseView
          phases={phases}
          totalDurationS={totalDurationS}
          expandedIdx={expandedIdx}
          onToggle={toggleExpand}
        />
      )}

      {/* Timeline View (or filtered view) */}
      {(viewMode === 'timeline' || filter) && (
        <div className="space-y-0 max-h-[600px] overflow-y-auto">
          {displayEvents.map(event => (
            <EventRow
              key={event._index}
              event={event}
              isExpanded={expandedIdx.has(event._index)}
              onToggle={() => toggleExpand(event._index)}
            />
          ))}
        </div>
      )}

      {/* Show more */}
      {!showAll && filtered.length > 30 && (
        <div className="mt-2 text-center">
          <button
            onClick={() => setShowAll(true)}
            className="text-xs text-blue-600 hover:underline"
          >
            Show remaining {filtered.length - 30} events
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Phase View ── */
function PhaseView({ phases, totalDurationS, expandedIdx, onToggle }: {
  phases: PhaseGroup[]
  totalDurationS: number | null
  expandedIdx: Set<number>
  onToggle: (idx: number) => void
}) {
  const [collapsedPhases, setCollapsedPhases] = useState<Set<number>>(new Set())

  const togglePhase = (i: number) => {
    setCollapsedPhases(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <div className="space-y-2">
      {phases.map((phase, pi) => {
        const isCollapsed = collapsedPhases.has(pi)
        const pct = totalDurationS && phase.durationS != null
          ? Math.max(2, (phase.durationS / totalDurationS) * 100)
          : null

        return (
          <div key={pi} className="rounded-lg border border-slate-100 overflow-hidden">
            {/* Phase header */}
            <div
              className="flex items-center gap-2 px-3 py-2 bg-slate-50/80 cursor-pointer hover:bg-slate-100/80 transition-colors"
              onClick={() => togglePhase(pi)}
            >
              <span className={`material-symbols-outlined ${phase.color.split(' ')[0]}`} style={{ fontSize: '16px' }}>
                {phase.icon}
              </span>
              <span className="text-xs font-semibold text-slate-600 flex-1">
                {phase.label}
              </span>
              <span className="text-[10px] text-slate-400 tabular-nums">
                {phase.events.length} events
              </span>
              {phase.durationS !== null && (
                <span className="text-[10px] text-slate-400 tabular-nums">
                  {phase.durationS.toFixed(1)}s
                </span>
              )}
              {pct !== null && (
                <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      phase.label === 'Searching' ? 'bg-blue-400'
                        : phase.label === 'Products Found' ? 'bg-emerald-400'
                        : phase.label === 'Generating Guide' ? 'bg-slate-400'
                        : 'bg-purple-400'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
              <span className="material-symbols-outlined text-slate-300" style={{ fontSize: '14px' }}>
                {isCollapsed ? 'expand_more' : 'expand_less'}
              </span>
            </div>

            {/* Phase events */}
            {!isCollapsed && (
              <div className="px-2 py-1">
                {phase.events.map(event => (
                  <EventRow
                    key={event._index}
                    event={event}
                    isExpanded={expandedIdx.has(event._index)}
                    onToggle={() => onToggle(event._index)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
