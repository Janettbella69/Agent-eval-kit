import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { saveJudgePrompt } from '../lib/api.ts'

export default function CreateEvaluatorPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [model, setModel] = useState('gpt-5.4')
  const [creating, setCreating] = useState(false)
  const [prompt, setPrompt] = useState(`You are an eval judge for a shopping research guide.

## Task
Evaluate the guide against specific criteria. Determine: PASS or FAIL.

## PASS Definition
Guide addresses requirements with specific evidence (product names, specs, prices, source citations).

## FAIL Definition
Guide misses key requirements or provides only vague/generic content.

## Output Format
Call \`score_grader\` with: grader_name="<name>", result="Pass" or result="Fail", reasoning.`)

  const handleCreate = async () => {
    if (!name.trim() || !prompt.trim()) return
    setCreating(true)
    try {
      await saveJudgePrompt(name, prompt, `model: ${model}. ${description}`)
      navigate('/graders')
    } catch (e) {
      console.error(e)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="max-w-3xl animate-fadeIn">
      <nav className="flex items-center gap-2 text-sm text-slate-400 mb-6">
        <Link to="/graders" className="hover:text-slate-600">评测</Link>
        <span>/</span>
        <Link to="/graders" className="hover:text-slate-600">评估器</Link>
        <span>/</span>
        <span className="text-slate-700 font-medium">新建评估器</span>
      </nav>

      <h1 className="text-2xl font-bold text-slate-900 mb-8">新建评估器</h1>

      {/* Basic Info */}
      <div className="rounded-xl bg-white border border-slate-200 p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-5">基础信息</h3>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1.5 block">名称</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如：actionability_judge"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1.5 block">描述</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="评估器的用途描述..."
              rows={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none resize-none"
            />
          </div>
        </div>
      </div>

      {/* Config */}
      <div className="rounded-xl bg-white border border-slate-200 p-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-5">配置信息</h3>

        <div className="mb-5">
          <label className="text-xs font-medium text-slate-500 mb-1.5 block">模型选择</label>
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="w-64 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
          >
            <option value="gpt-5.4">GPT-5.4 (OpenAI)</option>
            <option value="claude-opus-4-6">Claude Opus 4.6 (Anthropic)</option>
            <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (Anthropic)</option>
            <option value="minimax/minimax-m2.7">MiniMax M2.7</option>
          </select>
        </div>

        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="text-xs font-medium text-slate-500">Prompt</label>
            <div className="flex gap-2">
              <button className="text-xs text-slate-500 hover:text-slate-700 transition-colors">选择模板</button>
              <button
                className="text-xs text-red-400 hover:text-red-600 transition-colors"
                onClick={() => setPrompt('')}
              >
                清空
              </button>
            </div>
          </div>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={16}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono text-slate-700 leading-relaxed focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none resize-y"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-3 mt-6 pb-10">
        <button className="px-5 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
          调试
        </button>
        <button
          onClick={handleCreate}
          disabled={creating || !name.trim() || !prompt.trim()}
          className="px-6 py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          {creating ? '创建中...' : '创建'}
        </button>
      </div>
    </div>
  )
}
