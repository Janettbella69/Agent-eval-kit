import { Routes, Route, Link, useLocation } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage.tsx'
import DatasetsPage from './pages/DatasetsPage.tsx'
import ExperimentPage from './pages/ExperimentPage.tsx'
import TracePage from './pages/TracePage.tsx'
import ComparePage from './pages/ComparePage.tsx'

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: 'dashboard' },
  { path: '/datasets', label: 'Datasets', icon: 'dataset' },
  { path: '/compare', label: 'Compare', icon: 'compare_arrows' },
]

export default function App() {
  const location = useLocation()

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="h-14 flex items-center gap-6 px-6 bg-white border-b border-slate-200">
        <span className="text-lg font-bold text-emerald-700">Eval Platform</span>
        <div className="flex gap-1">
          {NAV_ITEMS.map(item => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                location.pathname === item.path
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </div>
      </nav>

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/datasets" element={<DatasetsPage />} />
          <Route path="/experiments/:id" element={<ExperimentPage />} />
          <Route path="/traces/:id" element={<TracePage />} />
          <Route path="/compare" element={<ComparePage />} />
        </Routes>
      </main>
    </div>
  )
}
