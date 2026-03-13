import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { listDatasets, getDataset, importDataset, createExperiment, runExperiment } from '../lib/api.ts'
import type { Dataset, Case } from '../types.ts'

export default function DatasetsPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [cases, setCases] = useState<Case[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const navigate = useNavigate()

  const refresh = useCallback(() => {
    listDatasets().then(setDatasets).finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (selectedId) {
      getDataset(selectedId).then(d => setCases(d.cases))
    }
  }, [selectedId])

  const handleImport = async (name: string) => {
    setImporting(true)
    try {
      const result = await importDataset(name)
      alert(`Imported ${result.cases_imported} cases`)
      refresh()
    } catch (e) {
      alert(`Import failed: ${e}`)
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Datasets</h1>
        <div className="flex gap-2">
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
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-900">{d.name}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  d.suite_type === 'regression'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-blue-50 text-blue-700'
                }`}>
                  {d.suite_type || 'capability'}
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
            {d.description && <div className="text-xs text-slate-400 mt-1">{d.description}</div>}
          </button>
        ))}
        {datasets.length === 0 && (
          <div className="col-span-3 text-center text-slate-400 py-8">
            No datasets yet. Import one to get started.
          </div>
        )}
      </div>

      {selectedId && cases.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-800">
              Cases ({cases.length})
            </h3>
            <button
              onClick={handleNewExperiment}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
            >
              New Experiment
            </button>
          </div>
          <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Key</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Query</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Type</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Constraints</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {cases.map(c => (
                  <tr key={c.id}>
                    <td className="px-4 py-2 font-medium text-slate-700">{c.key}</td>
                    <td className="px-4 py-2 text-slate-600 max-w-sm truncate">{c.query}</td>
                    <td className="px-4 py-2">
                      <span className="px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-600">{c.type}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-400">
                      {Object.keys(c.constraints).length > 0 ? JSON.stringify(c.constraints) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
