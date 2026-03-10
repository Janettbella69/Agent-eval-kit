import { useState } from 'react'

interface TraceTimelineProps {
  events: Record<string, unknown>[]
}

export default function TraceTimeline({ events }: TraceTimelineProps) {
  const [expanded, setExpanded] = useState(false)
  const displayEvents = expanded ? events : events.slice(0, 10)

  return (
    <div className="rounded-xl bg-white border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-slate-700">
          Event Timeline ({events.length} events)
        </h4>
        {events.length > 10 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-blue-600 hover:underline"
          >
            {expanded ? 'Collapse' : `Show all ${events.length}`}
          </button>
        )}
      </div>
      <div className="space-y-1 max-h-96 overflow-y-auto">
        {displayEvents.map((event, i) => {
          const type = (event.type as string) || 'unknown'
          const color = type === 'error' ? 'text-red-600'
            : type === 'product_found' ? 'text-emerald-600'
            : type === 'search_progress' ? 'text-blue-600'
            : type === 'text_delta' ? 'text-slate-400'
            : 'text-slate-600'

          let detail = ''
          if (type === 'search_progress') {
            detail = (event.query as string) || ''
          } else if (type === 'product_found') {
            const product = event.product as Record<string, unknown> | undefined
            detail = (product?.name as string) || ''
          } else if (type === 'error') {
            detail = (event.message as string) || ''
          } else if (type === 'text_delta') {
            detail = `${((event.content as string) || '').length} chars`
          }

          return (
            <div key={i} className="flex items-start gap-2 text-xs font-mono">
              <span className="w-8 text-right text-slate-400 shrink-0">{i + 1}</span>
              <span className={`w-28 shrink-0 font-medium ${color}`}>{type}</span>
              <span className="text-slate-500 truncate">{detail}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
