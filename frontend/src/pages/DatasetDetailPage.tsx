import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getDataset } from '../lib/api.ts'
import type { Dataset, Case } from '../types.ts'

export default function DatasetDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [cases, setCases] = useState<Case[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedCase, setExpandedCase] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    getDataset(Number(id)).then(data => {
      setDataset(data)
      setCases((data as Dataset & { cases: Case[] }).cases || [])
    }).finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="text-slate-400">Loading...</div>
  if (!dataset) return <div className="text-red-500">Dataset not found.</div>

  const typeCounts: Record<string, number> = {}
  for (const c of cases) {
    typeCounts[c.type] = (typeCounts[c.type] || 0) + 1
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <Link to="/datasets" className="text-sm text-blue-600 hover:underline">Datasets</Link>
        <span className="text-slate-300 mx-2">/</span>
        <h1 className="text-2xl font-bold text-slate-900 inline">{dataset.name}</h1>
      </div>

      {dataset.description && (
        <p className="text-sm text-slate-500">{dataset.description}</p>
      )}

      {/* Stats */}
      <div className="flex gap-4">
        <div className="rounded-xl bg-white border border-slate-200 px-4 py-3">
          <div className="text-2xl font-bold text-slate-900">{cases.length}</div>
          <div className="text-xs text-slate-500">Cases</div>
        </div>
        {Object.entries(typeCounts).map(([type, count]) => (
          <div key={type} className="rounded-xl bg-white border border-slate-200 px-4 py-3">
            <div className="text-2xl font-bold text-slate-900">{count}</div>
            <div className="text-xs text-slate-500">{type}</div>
          </div>
        ))}
      </div>

      {/* Cases */}
      <div className="space-y-2">
        {cases.map(c => {
          const isExpanded = expandedCase === c.key
          const golden = c.golden_data || {}
          const scenes = golden.scene_list || []
          const products = golden.product_list || []
          const trapRubric = golden.trap_rubric

          return (
            <div key={c.key} className="rounded-xl bg-white border border-slate-200 overflow-hidden">
              <button
                onClick={() => setExpandedCase(isExpanded ? null : c.key)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-25"
              >
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  c.type === 'shoppingcomp' ? 'bg-blue-50 text-blue-700'
                    : c.type === 'trap' ? 'bg-amber-50 text-amber-700'
                    : 'bg-slate-100 text-slate-600'
                }`}>
                  {c.type}
                </span>
                <span className="text-xs font-mono text-slate-400">{c.key}</span>
                <span className="text-sm text-slate-700 flex-1 truncate">{c.query}</span>
                {scenes.length > 0 && (
                  <span className="text-xs text-slate-400">{scenes.length} scenes</span>
                )}
                {products.length > 0 && (
                  <span className="text-xs text-slate-400">{products.length} products</span>
                )}
                <span className="material-symbols-outlined text-slate-400" style={{ fontSize: '18px' }}>
                  {isExpanded ? 'expand_less' : 'expand_more'}
                </span>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 border-t border-slate-100 space-y-3">
                  {/* Query */}
                  <div className="pt-3">
                    <div className="text-xs font-medium text-slate-500 mb-1">Query</div>
                    <div className="text-sm text-slate-700">{c.query}</div>
                  </div>

                  {/* Scenes */}
                  {scenes.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-slate-500 mb-2">Scenes ({scenes.length})</div>
                      <div className="space-y-2">
                        {scenes.map((scene, i) => (
                          <div key={i} className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-medium">Scene {i + 1}</span>
                            </div>
                            <div className="text-xs text-slate-700 leading-relaxed mb-2">{scene.scene || ''}</div>
                            {scene.rubric && (
                              <div className="bg-emerald-50 border border-emerald-100 rounded p-2">
                                <div className="text-[10px] font-semibold text-emerald-700 mb-1">Rubric</div>
                                <div className="text-[10px] text-emerald-800 leading-relaxed">{scene.rubric}</div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Golden Products */}
                  {products.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-slate-500 mb-2">Golden Products ({products.length})</div>
                      <div className="space-y-2">
                        {products.map((p, i) => {
                          const prod = p as Record<string, unknown>
                          const name = (prod.product_name || prod.name || '') as string
                          const annotations = (prod.scene_annotation_list || []) as Record<string, unknown>[]
                          return (
                            <div key={i} className="rounded-lg bg-emerald-50 border border-emerald-100 p-3">
                              <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-emerald-600" style={{ fontSize: '16px' }}>shopping_bag</span>
                                <span className="text-sm font-medium text-emerald-800">{name || `Product ${i + 1}`}</span>
                                {annotations.length > 0 && (
                                  <span className="text-[10px] text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded">
                                    {annotations.length} scene annotations
                                  </span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Trap Rubric */}
                  {trapRubric && (
                    <div>
                      <div className="text-xs font-medium text-amber-700 mb-1">Trap Rubric</div>
                      <div className="text-xs text-amber-600 bg-amber-50 rounded-lg p-3">{trapRubric}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
