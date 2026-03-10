import type { Dataset, Case, Experiment, Trace } from '../types.ts'

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

// Traces
export const getTrace = (id: number) => fetchJSON<Trace>(`/traces/${id}`)
export const annotateTrace = (id: number, body: Record<string, unknown>) =>
  fetchJSON<{ ok: boolean }>(`/traces/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
