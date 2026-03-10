import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getTrace } from '../lib/api.ts'
import ScoreBadge from '../components/ScoreBadge.tsx'
import GraderBreakdown from '../components/GraderBreakdown.tsx'
import TraceTimeline from '../components/TraceTimeline.tsx'
import type { Trace } from '../types.ts'

export default function TracePage() {
  const { id } = useParams<{ id: string }>()
  const [trace, setTrace] = useState<Trace | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'guide' | 'products' | 'sources' | 'events'>('guide')

  useEffect(() => {
    if (!id) return
    getTrace(Number(id)).then(setTrace).finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="text-slate-400">Loading...</div>
  if (!trace) return <div className="text-red-500">Trace not found.</div>

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link to={`/experiments/${trace.experiment_id}`} className="text-sm text-blue-600 hover:underline">
              Experiment #{trace.experiment_id}
            </Link>
            <span className="text-slate-300">/</span>
            <h1 className="text-xl font-bold text-slate-900">{trace.case_key}</h1>
            <span className="text-sm text-slate-400">Trial #{trace.trial_num}</span>
          </div>
          <div className="text-sm text-slate-500 mt-1">{trace.query}</div>
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
            <span className="px-1.5 py-0.5 rounded bg-slate-100">{trace.case_type}</span>
            <span>{trace.duration_s.toFixed(1)}s</span>
            <span>{trace.products.length} products</span>
            <span>{trace.sources.length} sources</span>
          </div>
        </div>
        <ScoreBadge score={trace.final_score} pass={trace.final_pass} size="lg" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {(['guide', 'products', 'sources', 'events'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === 'products' && ` (${trace.products.length})`}
            {t === 'sources' && ` (${trace.sources.length})`}
            {t === 'events' && ` (${trace.events.length})`}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2">
          {tab === 'guide' && (
            <div className="rounded-xl bg-white border border-slate-200 p-6 prose prose-slate max-w-none">
              {trace.guide_text ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {trace.guide_text}
                </ReactMarkdown>
              ) : (
                <div className="text-slate-400 text-center py-8">No guide text generated.</div>
              )}
            </div>
          )}

          {tab === 'products' && (
            <div className="space-y-3">
              {trace.products.map((p, i) => {
                const product = p as Record<string, string>
                return (
                  <div key={i} className="rounded-xl bg-white border border-slate-200 p-4 flex gap-4">
                    {product.imageUrl && (
                      <img
                        src={product.imageUrl}
                        alt=""
                        className="w-16 h-16 rounded-lg object-cover bg-slate-100"
                      />
                    )}
                    <div>
                      <div className="font-medium text-slate-900">
                        {product.name || 'Unknown'}
                      </div>
                      <div className="text-sm text-slate-500">
                        {product.brand || ''} {product.price || ''}
                      </div>
                    </div>
                  </div>
                )
              })}
              {trace.products.length === 0 && (
                <div className="text-slate-400 text-center py-8">No products found.</div>
              )}
            </div>
          )}

          {tab === 'sources' && (
            <div className="space-y-2">
              {trace.sources.map((s, i) => {
                const source = s as Record<string, string>
                return (
                  <div key={i} className="rounded-lg bg-white border border-slate-200 p-3">
                    <a
                      href={source.url || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline font-medium"
                    >
                      {source.title || source.url || 'Source'}
                    </a>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {source.domain || ''}
                    </div>
                  </div>
                )
              })}
              {trace.sources.length === 0 && (
                <div className="text-slate-400 text-center py-8">No sources found.</div>
              )}
            </div>
          )}

          {tab === 'events' && <TraceTimeline events={trace.events} />}
        </div>

        {/* Score breakdown sidebar */}
        <div className="space-y-4">
          <GraderBreakdown
            l0={trace.l0_scores}
            l1={trace.l1_scores}
            l2={trace.l2_scores}
          />
        </div>
      </div>
    </div>
  )
}
