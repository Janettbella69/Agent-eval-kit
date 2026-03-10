"""Pydantic models for eval platform data."""

from pydantic import BaseModel


class CaseIn(BaseModel):
    key: str
    query: str
    type: str = "clear_en"
    constraints: dict = {}


class DatasetIn(BaseModel):
    name: str
    description: str = ""
    cases: list[CaseIn] = []


class Dataset(BaseModel):
    id: int
    name: str
    description: str = ""
    case_count: int = 0
    created_at: float = 0


class Case(BaseModel):
    id: int
    dataset_id: int
    key: str
    query: str
    type: str
    constraints: dict = {}


class ExperimentIn(BaseModel):
    dataset_id: int
    tag: str = ""
    cases: list[str] | None = None  # subset of case keys; None = all
    trials: int = 1
    concurrency: int = 1
    judge_enabled: bool = False


class Experiment(BaseModel):
    id: int
    dataset_id: int
    tag: str = ""
    status: str = "pending"
    config: dict = {}
    summary: dict = {}
    created_at: float = 0
    finished_at: float | None = None


class Trace(BaseModel):
    id: int
    experiment_id: int
    case_key: str
    trial_num: int = 1
    query: str = ""
    case_type: str = ""
    status: str = "pending"
    duration_s: float = 0
    guide_text: str = ""
    products: list = []
    sources: list = []
    events: list = []
    hook_metrics: dict = {}
    error_events: list = []
    clarification: dict | None = None
    l0_scores: dict = {}
    l1_scores: dict = {}
    l2_scores: dict | None = None
    final_score: float = 0
    final_pass: bool = False
    created_at: float = 0


class ExperimentSummary(BaseModel):
    total_cases: int = 0
    completed: int = 0
    passed: int = 0
    failed: int = 0
    errored: int = 0
    avg_score: float = 0
    median_score: float = 0
    avg_duration: float = 0
