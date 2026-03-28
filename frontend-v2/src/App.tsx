import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import { antdTheme } from './styles/theme'
import AppShell from './layouts/AppShell'
import PlaygroundPage from './pages/playground/PlaygroundPage'
import DatasetsPage from './pages/evaluation/datasets/DatasetsPage'
import CreateDatasetPage from './pages/evaluation/datasets/CreateDatasetPage'
import EvaluatorsPage from './pages/evaluation/evaluators/EvaluatorsPage'
import CreateEvaluatorPage from './pages/evaluation/evaluators/CreateEvaluatorPage'
import CreateExperimentPage from './pages/evaluation/experiments/CreateExperimentPage'
import TracePage from './pages/observation/TracePage'
import './styles/global.css'

export default function App() {
  return (
    <ConfigProvider theme={antdTheme}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/playground" replace />} />
            <Route path="/playground" element={<PlaygroundPage />} />
            <Route path="/evaluation/datasets" element={<DatasetsPage />} />
            <Route path="/evaluation/datasets/create" element={<CreateDatasetPage />} />
            <Route path="/evaluation/evaluators" element={<EvaluatorsPage />} />
            <Route path="/evaluation/evaluators/create" element={<CreateEvaluatorPage />} />
            <Route path="/evaluation/experiments/create" element={<CreateExperimentPage />} />
            <Route path="/observation/trace" element={<TracePage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  )
}
