export interface Dataset {
  id: number
  name: string
  description: string
  case_count: number
  created_at: number
}

export interface Case {
  id: number
  dataset_id: number
  key: string
  query: string
  type: string
  constraints: Record<string, unknown>
}

export interface Experiment {
  id: number
  dataset_id: number
  tag: string
  status: string
  config: ExperimentConfig
  summary: ExperimentSummary
  created_at: number
  finished_at: number | null
  traces?: Trace[]
}

export interface ExperimentConfig {
  cases: string[] | null
  trials: number
  concurrency: number
  judge_enabled: boolean
}

export interface ExperimentSummary {
  total_cases: number
  completed: number
  passed: number
  failed: number
  errored: number
  avg_score: number
  median_score: number
  avg_duration: number
}

export interface Trace {
  id: number
  experiment_id: number
  case_key: string
  trial_num: number
  query: string
  case_type: string
  status: string
  duration_s: number
  guide_text: string
  products: Record<string, unknown>[]
  sources: Record<string, unknown>[]
  events: Record<string, unknown>[]
  hook_metrics: Record<string, unknown>
  error_events: Record<string, unknown>[]
  clarification: Record<string, unknown> | null
  l0_scores: Record<string, unknown>
  l1_scores: Record<string, unknown>
  l2_scores: Record<string, unknown> | null
  final_score: number
  final_pass: boolean
  created_at: number
}

export interface WsMessage {
  type: string
  case_key?: string
  trial_num?: number
  trace_id?: number
  score?: number
  passed?: boolean
  duration_s?: number
  total?: number
  summary?: ExperimentSummary
}
