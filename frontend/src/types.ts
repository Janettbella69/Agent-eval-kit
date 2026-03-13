export interface Dataset {
  id: number
  name: string
  description: string
  suite_type: 'capability' | 'regression'
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
  golden_data: GoldenData
  reference_output: Record<string, unknown> | null
}

export interface GoldenData {
  scene_list?: SceneItem[]
  product_list?: ProductItem[]
  trap_rubric?: string
  source?: string
}

export interface SceneItem {
  uuid: string
  scene: string
  rubric: string
}

export interface ProductItem {
  product_name: string
  scene_annotation_list?: SceneAnnotation[]
  [key: string]: unknown
}

export interface SceneAnnotation {
  uuid: string
  scene: string
  rubric: string
  reason: string
  reference?: { urls: string[] }
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
  pass_rate: number
  pass_all_rate: number
  consistency_rate: number
  failure_funnel_dist: Record<string, number>
  grader_averages: Record<string, number>
  pass_at_k: Record<string, number>
  pass_pow_k: Record<string, number>
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
  composite_scores: Record<string, CompositeGraderScore>
  failure_funnel: FunnelResult
  error_types: string[]
  grading_duration_s: number
  human_scores: Record<string, HumanScore>
  grading_log: GradingLogEntry[]
  prompt_version: string
  model: string
  judge_prompt_version: string
  human_pass: boolean | null
  input_tokens: number
  output_tokens: number
  turn_count: number
  system_prompt: string
  tool_names: string[]
  judge_prompts: Record<string, unknown>
  open_codes: string[]
  review_status: 'pending' | 'reviewed' | 'flagged'
  reviewed_at: number | null
  review_notes: string
  created_at: number
}

export interface HumanScore {
  score: number
  reasoning: string
}

export interface GradingLogEntry {
  step: string
  category: 'code' | 'llm' | 'system'
  score?: number | null
  weight?: number
  duration_s?: number
  status?: string
  error?: string
  error_types?: string[]
  revisions?: number
  reasoning_preview?: string
  // system entries
  passed?: boolean
  results?: Record<string, boolean>
  is_pass?: boolean
  n_graders?: number
}

export interface CompositeGraderScore {
  score: number
  weight: number
  category: 'code' | 'llm'
  details: Record<string, unknown>
  error_types: string[]
}

export interface FunnelResult {
  stage: string | null
  reason: string
  stages: Record<string, 'pass' | 'fail'>
}

export interface SaturationCase {
  case_key: string
  total_trials: number
  passes: number
  pass_rate: number
  avg_score: number
  n_experiments: number
  saturated: boolean
}

export interface CaseHistoryEntry {
  case_key: string
  final_score: number
  final_pass: boolean
  trial_num: number
  experiment_id: number
  tag: string
  exp_created: number
}

export interface JudgeAlignment {
  total_labeled: number
  tp?: number
  fp?: number
  tn?: number
  fn?: number
  tpr: number | null
  tnr: number | null
  human_pass_rate?: number
  auto_pass_rate?: number
  total_traces?: number
  observed_pass_rate: number | null
  corrected_pass_rate: number | null
}

// ── Experiment Comparison ──────────────────────
export interface CompareCase {
  case_key: string
  query: string
  case_type: string
  base_score: number | null
  target_score: number | null
  delta: number | null
  base_pass: boolean | null
  target_pass: boolean | null
  status: 'improved' | 'regressed' | 'unchanged' | 'new' | 'removed'
}

export interface CompareExperimentInfo {
  id: number
  tag: string
  avg_score: number
  pass_rate: number
}

export interface CompareSummary {
  improved: number
  regressed: number
  unchanged: number
  new: number
  removed: number
  net_delta: number
  base_avg: number
  target_avg: number
}

export interface CompareResult {
  base: CompareExperimentInfo
  target: CompareExperimentInfo
  cases: CompareCase[]
  summary: CompareSummary
}

// ── Open/Axial Coding ─────────────────────────
export interface OpenCodeStat {
  code: string
  count: number
  pass_rate: number
  example_case_keys: string[]
}

export interface AxialCode {
  theme: string
  codes: string[]
  count: number
}

export interface CodingAnalysis {
  open_codes: OpenCodeStat[]
  axial_codes: AxialCode[]
  total_traces: number
}

// ── AI Analysis ───────────────────────────────
export interface AnalysisResult {
  status: 'running' | 'done' | 'error'
  result: string | null
  error: string | null
  finished_at?: number
  trace_count?: number
}

// ── Dataset Staleness ─────────────────────────
export interface StalenessCase {
  key: string
  query: string
  last_validated_at: number
  status: 'fresh' | 'stale' | 'never_validated'
  age_days: number | null
}

export interface StalenessReport {
  total_cases: number
  validated: number
  stale: number
  never_validated: number
  fresh: number
  staleness_pct: number
  max_age_days: number
  cases: StalenessCase[]
}

// ── Transcript Review ────────────────────────
export interface ReviewQueueItem {
  trace_id: number
  case_key: string
  score: number
  passed: boolean
  experiment_id: number
  duration_s: number
  case_type: string
}

export interface ReviewStats {
  total: number
  reviewed: number
  flagged: number
  pending: number
  coverage_pct: number
}

// ── Production Import (LangFuse → Eval) ─────
export interface ProductionImportResult {
  experiment_id: number | null
  dataset_id?: number
  traces_imported: number
  traces_skipped: number
  detail?: string
}

export interface LangfuseStatus {
  connected: boolean
  reason?: string
  host?: string
  trace_count?: number
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
  error?: string
  reason?: string
  consecutive_errors?: number
}
