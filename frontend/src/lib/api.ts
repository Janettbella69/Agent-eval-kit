import type { Dataset, Case, Experiment, Trace, ExperimentSummary, SaturationCase, CaseHistoryEntry, GradingLogEntry, HumanScore, JudgeAlignment, CompareResult, CodingAnalysis, AnalysisResult, StalenessReport, ReviewQueueItem, ReviewStats } from '../types.ts'

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
export const importShoppingCompAll = () =>
  fetchJSON<{ results: Array<{ name: string; dataset_id?: number; imported?: number; categories?: Record<string, number>; error?: string }>; total_imported: number }>(
    '/datasets/import-shoppingcomp-all', { method: 'POST' }
  )
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

// Experiment Comparison
export const compareExperiments = (baseId: number, targetId: number) =>
  fetchJSON<CompareResult>(`/experiments/compare?base=${baseId}&target=${targetId}`)

// Dataset Slicing
export const createDatasetFromExperiment = (body: {
  experiment_id: number
  name: string
  filter: string
  compare_to?: number
  description?: string
}) => fetchJSON<{ dataset_id: number; cases_count: number; filter: string }>(
  '/datasets/from-experiment',
  { method: 'POST', body: JSON.stringify(body) },
)

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
export const annotateHumanPass = (traceId: number, passed: boolean) =>
  fetchJSON<{ ok: boolean; passed: boolean }>(`/traces/${traceId}/annotate-pass`, {
    method: 'POST', body: JSON.stringify({ passed }),
  })

// Judge Alignment
export const getJudgeAlignment = () => fetchJSON<JudgeAlignment>('/traces/alignment')

// Grader Validation (TPR/TNR calibration)
export interface GraderValidation {
  grader_name: string
  tpr: number | null
  tnr: number | null
  tp: number; fp: number; tn: number; fn: number
  n_samples: number
  threshold_met: boolean
  observed_pass_rate?: number
  corrected_pass_rate?: number | null
  error?: string
}
export interface ValidationSummary {
  [graderName: string]: {
    tpr: number | null
    tnr: number | null
    n_samples: number
    threshold_met: boolean
    last_validated: number | null
  }
}
export const validateGrader = (name: string) =>
  fetchJSON<GraderValidation>(`/graders/${name}/validate`, { method: 'POST' })
export const getValidationSummary = () =>
  fetchJSON<ValidationSummary>('/graders/validation-summary')
export const getGraderDefinitions = () =>
  fetchJSON<Array<{ name: string; weight: number; category: string; requires_golden: boolean }>>('/graders/definitions')

// Open Codes (qualitative labels)
export const updateOpenCodes = (traceId: number, add: string[] = [], remove: string[] = []) =>
  fetchJSON<{ ok: boolean; open_codes: string[] }>(`/traces/${traceId}/codes`, {
    method: 'POST', body: JSON.stringify({ add, remove }),
  })

// Coding Analysis
export const getCodingAnalysis = (experimentId?: number) => {
  const params = experimentId ? `?experiment_id=${experimentId}` : ''
  return fetchJSON<CodingAnalysis>(`/traces/coding-analysis${params}`)
}

// AI Trace Analysis
export const startTraceAnalysis = (traceIds: number[], question: string) =>
  fetchJSON<{ request_id: string; status: string }>('/traces/analyze', {
    method: 'POST', body: JSON.stringify({ trace_ids: traceIds, question }),
  })
export const getAnalysisResult = (requestId: string) =>
  fetchJSON<AnalysisResult>(`/traces/analyze/${requestId}`)

// Dataset Staleness
export const getDatasetStaleness = (datasetId: number, maxAgeDays: number = 30) =>
  fetchJSON<StalenessReport>(`/datasets/${datasetId}/staleness?max_age_days=${maxAgeDays}`)

export const validateDatasetCases = (datasetId: number, caseKeys: string[]) =>
  fetchJSON<{ ok: boolean; validated_count: number }>(`/datasets/${datasetId}/validate`, {
    method: 'POST', body: JSON.stringify({ case_keys: caseKeys }),
  })

export const validateAllCases = (datasetId: number) =>
  fetchJSON<{ ok: boolean; validated_count: number }>(`/datasets/${datasetId}/validate`, {
    method: 'POST', body: JSON.stringify({ all: true }),
  })

// Transcript Review
export const getReviewQueue = (n: number = 10, experimentId?: number, strategy: string = 'mixed') => {
  const params = new URLSearchParams({ n: String(n), strategy })
  if (experimentId != null) params.set('experiment_id', String(experimentId))
  return fetchJSON<{ traces: ReviewQueueItem[]; count: number; strategy: string }>(`/traces/review-queue?${params}`)
}

export const updateReviewStatus = (traceId: number, status: string, notes: string = '') =>
  fetchJSON<{ ok: boolean; review_status: string }>(`/traces/${traceId}/review`, {
    method: 'POST', body: JSON.stringify({ status, notes }),
  })

export const getReviewStats = () => fetchJSON<ReviewStats>('/traces/review-stats')
