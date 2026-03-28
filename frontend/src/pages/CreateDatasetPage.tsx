import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

interface SchemaField {
  id: string
  name: string
  dataType: string
  required: boolean
  description: string
}

const INITIAL_FIELDS: SchemaField[] = [
  { id: '1', name: 'input', dataType: 'string', required: true, description: '用户输入的查询内容' },
  { id: '2', name: 'reference_output', dataType: 'string', required: false, description: '参考输出（golden data）' },
]

export default function CreateDatasetPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fields, setFields] = useState<SchemaField[]>(INITIAL_FIELDS)
  const [creating, setCreating] = useState(false)

  const addField = () => {
    setFields([...fields, { id: Date.now().toString(), name: '', dataType: 'string', required: false, description: '' }])
  }

  const updateField = (id: string, updates: Partial<SchemaField>) => {
    setFields(fields.map(f => f.id === id ? { ...f, ...updates } : f))
  }

  const removeField = (id: string) => {
    setFields(fields.filter(f => f.id !== id))
  }

  const handleCreate = async () => {
    if (!name.trim()) return
    setCreating(true)
    try {
      const { importDataset } = await import('../lib/api.ts')
      await importDataset(name)
      navigate('/datasets')
    } catch (e) {
      console.error(e)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="max-w-3xl animate-fadeIn">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-slate-400 mb-6">
        <Link to="/datasets" className="hover:text-slate-600">评测</Link>
        <span>/</span>
        <Link to="/datasets" className="hover:text-slate-600">评测集</Link>
        <span>/</span>
        <span className="text-slate-700 font-medium">新建评测集</span>
      </nav>

      <h1 className="text-2xl font-bold text-slate-900 mb-8">新建评测集</h1>

      {/* Basic Info */}
      <div className="rounded-xl bg-white border border-slate-200 p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-5">基本信息</h3>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1.5 block">名称</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如：Shopping Research V1"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1.5 block">描述</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="描述这个评测集的用途..."
              rows={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none resize-none"
            />
          </div>
        </div>
      </div>

      {/* Schema Fields */}
      <div className="rounded-xl bg-white border border-slate-200 p-6">
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-sm font-semibold text-slate-700">配置列</h3>
          <span className="text-xs text-slate-400">{fields.length} 个字段</span>
        </div>

        <div className="space-y-3">
          {fields.map(f => (
            <div key={f.id} className="rounded-lg border border-slate-200 p-4 hover:border-slate-300 transition-colors">
              <div className="grid grid-cols-[1fr_120px_60px_1fr_32px] gap-3 items-center">
                <div>
                  <label className="text-[10px] font-medium text-slate-400 mb-1 block">名称</label>
                  <input
                    value={f.name}
                    onChange={e => updateField(f.id, { name: e.target.value })}
                    className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-emerald-200 outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-slate-400 mb-1 block">数据类型</label>
                  <select
                    value={f.dataType}
                    onChange={e => updateField(f.id, { dataType: e.target.value })}
                    className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-emerald-200 outline-none"
                  >
                    <option value="string">String</option>
                    <option value="number">Number</option>
                    <option value="boolean">Boolean</option>
                    <option value="json">JSON</option>
                    <option value="array">Array</option>
                  </select>
                </div>
                <div className="text-center">
                  <label className="text-[10px] font-medium text-slate-400 mb-1 block">Required</label>
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={e => updateField(f.id, { required: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-200"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-slate-400 mb-1 block">描述</label>
                  <input
                    value={f.description}
                    onChange={e => updateField(f.id, { description: e.target.value })}
                    placeholder="字段说明..."
                    className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-emerald-200 outline-none"
                  />
                </div>
                <button
                  onClick={() => removeField(f.id)}
                  className="mt-4 text-slate-400 hover:text-red-500 transition-colors"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={addField}
          className="mt-4 w-full rounded-lg border-2 border-dashed border-slate-200 py-2.5 text-sm text-slate-500 hover:border-slate-300 hover:text-slate-700 transition-colors"
        >
          + 添加字段
        </button>
      </div>

      {/* Footer */}
      <div className="flex justify-end mt-6 pb-10">
        <button
          onClick={handleCreate}
          disabled={creating || !name.trim()}
          className="px-6 py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          {creating ? '创建中...' : '创建'}
        </button>
      </div>
    </div>
  )
}
