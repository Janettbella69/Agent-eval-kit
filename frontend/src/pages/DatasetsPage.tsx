import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { listDatasets, getDataset, importDataset, importShoppingCompAll, createExperiment, runExperiment } from '../lib/api.ts'
import type { Dataset, Case } from '../types.ts'

// Category display config
const CATEGORY_LABELS: Record<string, string> = {
  camera: '📷 Camera',
  phone: '📱 Phone',
  audio: '🎧 Audio',
  laptop: '💻 Laptop',
  monitor: '🖥️ Monitor',
  tablet: '📲 Tablet',
  keyboard: '⌨️ Keyboard',
  mouse: '🖱️ Mouse',
  gaming: '🎮 Gaming',
  wearables: '⌚ Wearables',
  printer: '🖨️ Printer',
  beauty: '✨ Beauty',
  health: '🏥 Health',
  appliances: '🏠 Appliances',
  other: '📦 Other',
}

export default function DatasetsPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [cases, setCases] = useState<Case[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const navigate = useNavigate()

  const refresh = useCallback(() => {
    listDatasets().then(setDatasets).finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (selectedId) {
      setCategoryFilter('all')
      getDataset(selectedId).then(d => setCases(d.cases))
    }
  }, [selectedId])

  // Collect categories present in the selected dataset
  const availableCategories = useMemo(() => {
    const cats = new Set<string>()
    cases.forEach(c => {
      const cat = (c.golden_data as Record<string, unknown>)?.category as string | undefined
      if (cat) cats.add(cat)
    })
    return Array.from(cats).sort()
  }, [cases])

  const filteredCases = useMemo(() => {
    if (categoryFilter === 'all') return cases
    return cases.filter(c => {
      const cat = (c.golden_data as Record<string, unknown>)?.category as string | undefined
      return cat === categoryFilter
    })
  }, [cases, categoryFilter])

  const handleImport = async (name: string) => {
    setImporting(true)
    setImportMsg(null)
    try {
      const result = await importDataset(name)
      setImportMsg(`Imported ${result.cases_imported} cases into "${name}"`)
      refresh()
    } catch (e) {
      setImportMsg(`Import failed: ${e}`)
    }
    setImporting(false)
  }

  const handleImportShoppingComp = async () => {
    setImporting(true)
    setImportMsg(null)
    try {
      const result = await importShoppingCompAll()
      const summary = result.results
        .map(r => r.error ? `${r.name}: error` : `${r.name}: ${r.imported} cases`)
        .join(' · ')
      setImportMsg(`ShoppingComp imported — ${result.total_imported} total cases · ${summary}`)
      refresh()
    } catch (e) {
      setImportMsg(`Import failed: ${e}`)
    }
    setImporting(false)
  }

  const handleNewExperiment = async () => {
    if (!selectedId) return
    const tag = prompt('Experiment tag (optional):') ?? ''
    try {
      const { id } = await createExperiment({ dataset_id: selectedId, tag, trials: 1, concurrency: 1 })
      await runExperiment(id)
      navigate(`/experiments/${id}`)
    } catch (e) {
      alert(`Failed: ${e}`)
    }
  }

  if (loading) return <div className="text-slate-400">Loading...</div>

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Datasets</h1>
        <div className="flex flex-wrap gap-2">
          <Link to="/datasets/create" className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">
            + 新建评测集
          </Link>
          <button
            onClick={handleImportShoppingComp}
            disabled={importing}
            className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
          >
            {importing ? 'Importing…' : '↑ Import ShoppingComp'}
          </button>
          <button
            onClick={() => handleImport('legacy_v1')}
            disabled={importing}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            Import Legacy V1
          </button>
          <button
            onClick={() => handleImport('deepshop_v1')}
            disabled={importing}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            Import DeepShop V1
          </button>
        </div>
      </div>

      {importMsg && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2 text-sm text-emerald-800">
          {importMsg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {datasets.map(d => (
          <button
            key={d.id}
            onClick={() => setSelectedId(d.id)}
            className={`text-left rounded-xl border p-4 transition-colors ${
              selectedId === d.id
                ? 'border-emerald-300 bg-emerald-50'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-900">{d.name}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  d.name.startsWith('ShoppingComp')
                    ? 'bg-violet-50 text-violet-700'
                    : d.suite_type === 'regression'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-blue-50 text-blue-700'
                }`}>
                  {d.name.startsWith('ShoppingComp') ? 'shoppingcomp' : (d.suite_type || 'capability')}
                </span>
              </div>
              <Link
                to={`/datasets/${d.id}`}
                onClick={e => e.stopPropagation()}
                className="text-xs text-blue-600 hover:underline"
              >
                Details
              </Link>
            </div>
            <div className="text-xs text-slate-500 mt-1">{d.case_count} cases</div>
            {d.description && <div className="text-xs text-slate-400 mt-1 line-clamp-1">{d.description}</div>}
          </button>
        ))}
        {datasets.length === 0 && (
          <div className="col-span-3 text-center text-slate-400 py-8">
            No datasets yet. Click "↑ Import ShoppingComp" to get started.
          </div>
        )}
      </div>

      {selectedId && cases.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-800">
              Cases ({filteredCases.length}{categoryFilter !== 'all' ? ` / ${cases.length}` : ''})
            </h3>
            <button
              onClick={handleNewExperiment}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
            >
              New Experiment
            </button>
          </div>

          {/* Category filter chips — shown only when categories exist */}
          {availableCategories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setCategoryFilter('all')}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  categoryFilter === 'all'
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                All ({cases.length})
              </button>
              {availableCategories.map(cat => {
                const count = cases.filter(c =>
                  ((c.golden_data as Record<string, unknown>)?.category as string) === cat
                ).length
                return (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      categoryFilter === cat
                        ? 'bg-violet-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {CATEGORY_LABELS[cat] ?? cat} ({count})
                  </button>
                )
              })}
            </div>
          )}

          <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Key</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Query</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Category</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredCases.map(c => {
                  const cat = (c.golden_data as Record<string, unknown>)?.category as string | undefined
                  return (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-xs text-slate-600">{c.key}</td>
                      <td className="px-4 py-2 max-w-sm">
                        <span className="line-clamp-2 text-xs leading-relaxed text-slate-700">{c.query}</span>
                      </td>
                      <td className="px-4 py-2">
                        {cat ? (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-violet-50 text-violet-700">
                            {CATEGORY_LABELS[cat] ?? cat}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <span className="px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-600">{c.type}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
