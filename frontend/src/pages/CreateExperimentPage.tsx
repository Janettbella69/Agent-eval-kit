import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listDatasets, createExperiment } from '../lib/api.ts'
import type { Dataset } from '../types.ts'

export default function CreateExperimentPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [creating, setCreating] = useState(false)

  // Step 1
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [concurrency, setConcurrency] = useState(2)

  // Step 2
  const [datasetId, setDatasetId] = useState<number>(0)

  useEffect(() => {
    listDatasets().then(ds => {
      setDatasets(ds)
      if (ds.length > 0) setDatasetId(ds[0].id)
    }).catch(() => {})
  }, [])

  const handleCreate = async () => {
    if (!datasetId || !name.trim()) return
    setCreating(true)
    try {
      const res = await createExperiment({
        dataset_id: datasetId,
        tag: name,
        concurrency,
        judge_enabled: true,
        auto_run: true,
      })
      navigate(`/experiments/${res.id}`)
    } catch (e) {
      console.error(e)
    } finally {
      setCreating(false)
    }
  }

  const steps = ['基础信息', '评测集', '评测对象（可选）', '评估器（可选）']

  return (
    <div className="max-w-3xl animate-fadeIn">
      <nav className="flex items-center gap-2 text-sm text-slate-400 mb-6">
        <Link to="/experiments" className="hover:text-slate-600">评测</Link>
        <span>/</span>
        <Link to="/experiments" className="hover:text-slate-600">实验</Link>
        <span>/</span>
        <span className="text-slate-700 font-medium">新建实验</span>
      </nav>

      <h1 className="text-2xl font-bold text-slate-900 mb-8">新建实验</h1>

      {/* Stepper */}
      <div className="rounded-xl bg-white border border-slate-200 p-5 mb-6">
        <div className="flex items-center">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center flex-1">
              <div className="flex items-center gap-2.5">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  i < step ? 'bg-emerald-600 text-white'
                    : i === step ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-200'
                    : 'bg-slate-100 text-slate-400'
                }`}>
                  {i < step ? '✓' : i + 1}
                </div>
                <span className={`text-sm font-medium whitespace-nowrap ${
                  i <= step ? 'text-slate-700' : 'text-slate-400'
                }`}>{s}</span>
              </div>
              {i < steps.length - 1 && (
                <div className={`flex-1 h-px mx-4 ${i < step ? 'bg-emerald-300' : 'bg-slate-200'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <div className="rounded-xl bg-white border border-slate-200 p-6">
        {step === 0 && (
          <>
            <h3 className="text-sm font-semibold text-slate-700 mb-5">基础信息</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1.5 block">名称</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="例如：regression-test-20260328"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1.5 block">描述</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="实验目的和期望结果..."
                  rows={3}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none resize-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1.5 block">最大并发执行条数</label>
                <input
                  type="number"
                  value={concurrency}
                  onChange={e => setConcurrency(Number(e.target.value))}
                  min={1}
                  max={10}
                  className="w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
                />
              </div>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h3 className="text-sm font-semibold text-slate-700 mb-5">选择评测集</h3>
            {datasets.length === 0 ? (
              <div className="text-center py-10 text-slate-400">
                暂无评测集。请先<Link to="/datasets/create" className="text-emerald-600 hover:underline ml-1">创建评测集</Link>
              </div>
            ) : (
              <div className="space-y-2">
                {datasets.map(ds => (
                  <label
                    key={ds.id}
                    className={`flex items-center gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                      datasetId === ds.id ? 'border-emerald-500 bg-emerald-50/30' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="dataset"
                      checked={datasetId === ds.id}
                      onChange={() => setDatasetId(ds.id)}
                      className="text-emerald-600 focus:ring-emerald-200"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-slate-700">{ds.name}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{ds.case_count} cases · {ds.suite_type}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <div className="text-center py-12 text-slate-400">
            <span className="material-symbols-outlined text-slate-300 mb-2 block" style={{ fontSize: '32px' }}>tune</span>
            配置评测对象（可选，默认使用当前主站 Agent）
          </div>
        )}

        {step === 3 && (
          <div className="text-center py-12 text-slate-400">
            <span className="material-symbols-outlined text-slate-300 mb-2 block" style={{ fontSize: '32px' }}>analytics</span>
            选择评估器（可选，默认使用所有 graders）
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-3 mt-6 pb-10">
        {step > 0 && (
          <button
            onClick={() => setStep(step - 1)}
            className="px-5 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            上一步
          </button>
        )}
        {step < 3 ? (
          <button
            onClick={() => setStep(step + 1)}
            disabled={step === 0 && !name.trim()}
            className="px-6 py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            下一步：{steps[step + 1]}
          </button>
        ) : (
          <button
            onClick={handleCreate}
            disabled={creating || !datasetId}
            className="px-6 py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {creating ? '创建中...' : '创建实验'}
          </button>
        )}
      </div>
    </div>
  )
}
