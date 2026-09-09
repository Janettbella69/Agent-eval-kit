import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { listExperiments } from '../lib/api.ts'
import type { Experiment } from '../types.ts'

interface NavItem {
  path: string
  label: string
  icon: string
  badge?: string | number
}

interface NavGroup {
  key: string
  label: string
  items: NavItem[]
}

interface NavBarProps {
  collapsed: boolean
  onToggle: () => void
}

/* ── Tiny SVG sparkline ── */
function MiniSparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const w = 56
  const h = 22
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - min) / range) * (h - 4) - 2
    return `${x},${y}`
  })
  return (
    <svg width={w} height={h} className="opacity-50">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/* ── Pulsing dot ── */
function PulsingDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
  )
}

export default function NavBar({ collapsed, onToggle }: NavBarProps) {
  const location = useLocation()
  const acciowork = location.pathname.startsWith('/acciowork')
  const [experiments, setExperiments] = useState<Experiment[]>([])

  useEffect(() => {
    if (acciowork) return
    listExperiments().then(setExperiments).catch(() => {})
  }, [acciowork])

  const completed = experiments.filter(e => e.status === 'complete')
  const running = experiments.filter(e => e.status === 'running')
  const latestScore = completed[0]?.summary?.avg_score
  const latestPassRate = completed[0]?.summary
    ? Math.round(
        (completed[0].summary.passed / Math.max(completed[0].summary.total_cases, 1)) * 100,
      )
    : null
  const sparkData = completed
    .slice(0, 8)
    .reverse()
    .map(e => e.summary?.avg_score ?? 0)

  const navGroups: NavGroup[] = [
    {
      key: 'acciowork',
      label: 'Open-Acciowork',
      items: [
        { path: '/acciowork/experiments', label: '实验归档', icon: 'experiment' },
        { path: '/acciowork/traces', label: '运行 Trace', icon: 'timeline' },
        { path: '/acciowork/review', label: '人工复核', icon: 'fact_check' },
        { path: '/acciowork/compare', label: '实验对比', icon: 'compare_arrows' },
      ],
    },
    {
      key: 'eval',
      label: '评测',
      items: [
        {
          path: '/experiments',
          label: '实验',
          icon: 'experiment',
          badge: running.length > 0 ? running.length : undefined,
        },
        { path: '/datasets', label: 'Prompt 数据集', icon: 'dataset' },
        { path: '/graders', label: '评分器', icon: 'tune' },
        { path: '/automation', label: '自动化评测', icon: 'smart_toy' },
      ],
    },
    {
      key: 'observe',
      label: '观测',
      items: [
        { path: '/traces', label: 'Trace', icon: 'timeline' },
      ],
    },
    {
      key: 'analysis',
      label: '分析',
      items: [
        { path: '/overview', label: '评分概览', icon: 'monitoring' },
        { path: '/analysis', label: 'AI 分析', icon: 'auto_awesome' },
      ],
    },
  ]

  const isActive = (path: string) =>
    location.pathname === path ||
    (path !== '/' && location.pathname.startsWith(path + '/'))

  return (
    <aside
      className={`fixed top-0 left-0 h-screen flex flex-col bg-white border-r border-slate-200/80 transition-all duration-300 z-40 ${
        collapsed ? 'w-16' : 'w-56'
      }`}
    >
      {/* ── Logo ── */}
      <div className="h-14 flex items-center justify-between px-3 border-b border-slate-100">
        <Link
          to={acciowork ? '/acciowork/experiments' : '/experiments'}
          className={`flex items-center gap-2.5 ${collapsed ? 'mx-auto' : ''}`}
        >
          <span className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center shadow-sm shadow-emerald-200/50 flex-shrink-0">
            <span className="text-white text-xs font-bold tracking-tight">E</span>
          </span>
          {!collapsed && (
            <span className="text-[15px] font-semibold text-slate-800 tracking-tight">
              Eval
            </span>
          )}
        </Link>
        {!collapsed && (
          <button
            onClick={onToggle}
            className="text-slate-300 hover:text-slate-500 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
              left_panel_close
            </span>
          </button>
        )}
        {collapsed && (
          <button
            onClick={onToggle}
            className="absolute -right-3 top-4 w-6 h-6 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 shadow-sm cursor-pointer transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
              chevron_right
            </span>
          </button>
        )}
      </div>

      {/* ── Live score card ── */}
      {!collapsed && !location.pathname.startsWith('/acciowork') && (
        <div className="mx-3 mt-3 mb-1 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100/60 border border-slate-200/50 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
              Latest
            </span>
            {running.length > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                <PulsingDot />
                {running.length} running
              </span>
            )}
          </div>
          <div className="flex items-end justify-between">
            <div>
              <span
                className={`text-2xl font-bold tabular-nums leading-none ${
                  latestScore != null
                    ? latestScore >= 70
                      ? 'text-emerald-600'
                      : latestScore >= 40
                        ? 'text-amber-500'
                        : 'text-red-500'
                    : 'text-slate-300'
                }`}
              >
                {latestScore != null ? latestScore.toFixed(1) : '—'}
              </span>
              {latestPassRate != null && (
                <span className="ml-1.5 text-[10px] text-slate-400 tabular-nums">
                  {latestPassRate}% pass
                </span>
              )}
            </div>
            <div className="text-emerald-600">
              <MiniSparkline values={sparkData} />
            </div>
          </div>
        </div>
      )}

      {/* ── Collapsed score dot ── */}
      {collapsed && !acciowork && latestScore != null && (
        <div className="mx-auto mt-3 mb-1">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold tabular-nums ${
              latestScore >= 70
                ? 'bg-emerald-50 text-emerald-600'
                : latestScore >= 40
                  ? 'bg-amber-50 text-amber-600'
                  : 'bg-red-50 text-red-500'
            }`}
          >
            {latestScore.toFixed(0)}
          </div>
        </div>
      )}

      {/* ── Nav groups ── */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-5">
        {navGroups.filter(group => !acciowork || group.key === 'acciowork').map(group => (
          <div key={group.key}>
            {!collapsed && (
              <div className="px-2.5 mb-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                {group.label}
              </div>
            )}
            {collapsed && (
              <div className="w-6 mx-auto mb-2 border-t border-slate-200/60" />
            )}
            <div className="space-y-0.5">
              {group.items.map(item => {
                const active = isActive(item.path)
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    title={collapsed ? item.label : undefined}
                    className={`group relative flex items-center gap-2.5 rounded-lg transition-all duration-150 ${
                      collapsed ? 'justify-center px-2 py-2.5' : 'px-2.5 py-2'
                    } ${
                      active
                        ? 'bg-emerald-50/80 text-emerald-700'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-emerald-500 transition-all" />
                    )}
                    <span
                      aria-hidden="true"
                      className={`material-symbols-outlined flex-shrink-0 transition-colors ${
                        active ? 'text-emerald-600' : ''
                      }`}
                      style={{ fontSize: '20px' }}
                    >
                      {item.icon}
                    </span>
                    {!collapsed && (
                      <>
                        <span className="text-[13px] font-medium truncate">
                          {item.label}
                        </span>
                        {item.badge != null && (
                          <span className="ml-auto flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-emerald-500 text-white text-[10px] font-bold px-1">
                            {item.badge}
                          </span>
                        )}
                      </>
                    )}
                    {collapsed && item.badge != null && (
                      <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white" />
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Footer ── */}
      {!collapsed && (
        <div className="px-4 py-2.5 border-t border-slate-100">
          <div className="text-[10px] text-slate-400 tabular-nums">
            {acciowork ? '独立归档 · 人工复核 · 版本对比' : `${experiments.length} experiments · ${completed.length} completed`}
          </div>
        </div>
      )}
    </aside>
  )
}
