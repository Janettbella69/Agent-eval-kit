import { useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import NavBar from './components/NavBar.tsx'
import ExperimentsPage from './pages/ExperimentsPage.tsx'
import ExperimentPage from './pages/ExperimentPage.tsx'
import DatasetsPage from './pages/DatasetsPage.tsx'
import DatasetDetailPage from './pages/DatasetDetailPage.tsx'
import GradersPage from './pages/GradersPage.tsx'
import OverviewPage from './pages/OverviewPage.tsx'
import AnalyzePage from './pages/AnalyzePage.tsx'
import ComparePage from './pages/ComparePage.tsx'
import TracePage from './pages/TracePage.tsx'
import CreateDatasetPage from './pages/CreateDatasetPage.tsx'
import CreateEvaluatorPage from './pages/CreateEvaluatorPage.tsx'
import CreateExperimentPage from './pages/CreateExperimentPage.tsx'
import TraceListPage from './pages/TraceListPage.tsx'

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <div className="min-h-screen flex">
      <NavBar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(c => !c)}
      />

      <main
        className="flex-1 min-h-screen p-6 transition-all duration-300"
        style={{ marginLeft: sidebarCollapsed ? 64 : 224 }}
      >
        <div className="max-w-7xl mx-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/experiments" replace />} />

            {/* 评测 */}
            <Route path="/experiments" element={<ExperimentsPage />} />
            <Route path="/experiments/:id" element={<ExperimentPage />} />
            <Route path="/datasets" element={<DatasetsPage />} />
            <Route path="/datasets/create" element={<CreateDatasetPage />} />
            <Route path="/datasets/:id" element={<DatasetDetailPage />} />
            <Route path="/graders" element={<GradersPage />} />
            <Route path="/graders/create" element={<CreateEvaluatorPage />} />
            <Route path="/experiments/create" element={<CreateExperimentPage />} />

            {/* 分析 */}
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/analysis" element={<AnalyzePage />} />
            <Route path="/compare" element={<ComparePage />} />

            {/* 观测 */}
            <Route path="/traces" element={<TraceListPage />} />
            <Route path="/traces/:id" element={<TracePage />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
