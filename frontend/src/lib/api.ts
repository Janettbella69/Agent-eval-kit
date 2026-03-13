import type { Dataset, Case, Experiment, Trace, ExperimentSummary, SaturationCase, CaseHistoryEntry, GradingLogEntry, HumanScore } from '../types.ts'

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '') + '/api'

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(body.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

// Datasets
export const listDatasets = () => fetchJSON<Dataset[]>('/datasets')
export const getDataset = (id: number) => fetchJSON<Dataset & { cases: Case[] }>(`/datasets/${id}`)
export const importDataset = (name: string) =>
  fetchJSON<{ dataset_id: number; cases_imported: number }>(`/datasets/import?name=${name}`, { method: 'POST' })
export const updateDataset = (id: number, body: Record<string, unknown>) =>
  fetchJSON<{ ok: boolean }>(`/datasets/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const getDatasetSaturation = (id: number) =>
  fetchJSON<{ dataset_id: number; total_cases: number; saturated_cases: number; cases: SaturationCase[] }>(`/datasets/${id}/saturation`)

// Case history
export const getCaseHistory = (caseKey: string, datasetId?: number) => {
  const params = new URLSearchParams({ case_key: caseKey })
  if (datasetId != null) params.set('dataset_id', String(datasetId))
  return fetchJSON<{ case_key: string; history: CaseHistoryEntry[] }>(`/datasets/cases/history?${params}`)
}

// Experiments
export const listExperiments = () => fetchJSON<Experiment[]>('/experiments')
export const getExperiment = (id: number) => fetchJSON<Experiment>(`/experiments/${id}`)
export const createExperiment = (body: {
  dataset_id: number
  tag?: string
  cases?: string[]
  trials?: number
  concurrency?: number
  judge_enabled?: boolean
}) => fetchJSON<{ id: number }>('/experiments', { method: 'POST', body: JSON.stringify(body) })
export const runExperiment = (id: number) =>
  fetchJSON<{ status: string }>(`/experiments/${id}/run`, { method: 'POST' })
export const stopExperiment = (id: number) =>
  fetchJSON<{ status: string }>(`/experiments/${id}/stop`, { method: 'POST' })
export const regradeExperiment = (id: number) =>
  fetchJSON<{ status: string; traces_regraded: number }>(`/experiments/${id}/regrade`, { method: 'POST' })
export const getExperimentSummary = (id: number) =>
  fetchJSON<ExperimentSummary>(`/experiments/${id}/summary`)

// Traces
export const getTrace = (id: number) => fetchJSON<Trace>(`/traces/${id}`)
export const annotateTrace = (id: number, body: Record<string, unknown>) =>
  fetchJSON<{ ok: boolean }>(`/traces/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const annotateGrader = (traceId: number, graderName: string, humanScore: number, humanReasoning: string = '') =>
  fetchJSON<{ ok: boolean; agreement: { llm_score: number; human_score: number; diff: number; aligned: boolean } | null }>(
    `/traces/${traceId}/annotate`,
    { method: 'POST', body: JSON.stringify({ grader_name: graderName, human_score: humanScore, human_reasoning: humanReasoning }) },
  )
export const getTraceLogs = (id: number) =>
  fetchJSON<{ trace_id: number; grading_log: GradingLogEntry[]; grading_duration_s: number; human_scores: Record<string, HumanScore> }>(`/traces/${id}/logs`)
