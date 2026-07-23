# Agent Eval 

通用的 LLM Agent 评测平台：把"这个 Agent 到底好不好"从一句感觉，变成**可测量、可校准、可回归**的工程问题。

被测 Agent 只需暴露一个 HTTP API——平台把它当黑盒，负责其余的一切：数据集管理、批量实验、trace 采集、分层打分（规则 → 指标 → LLM Judge）、人工标注界面、Judge 校准闭环、回归门禁。

AZORA 是第一个完整接入案例（见 `examples/azora/` 与 `datasets/`）。

## 为什么需要它

Agent 产品的迭代困境：改了 prompt / 换了模型 / 加了工具，**你怎么知道变好了还是变坏了？**

- 手动试几个 query —— 样本太小，且你只会试自己想得到的
- 直接上 LLM-as-a-Judge —— 未经校准的 judge 只是把"感觉"外包给了另一个模型
- 只看线上指标 —— 滞后、混杂，无法归因到某次改动

这个平台实现的是完整的评测闭环：

```
trace 采集 → 错误分析(开放编码→taxonomy) → 人工标注(gold) → 分层自动打分
     ↑                                                            │
     └──────────── 回归门禁 ← Judge 校准(TPR/TNR + few-shot) ←────┘
```

## 架构

```
┌─────────────────────────────┐        ┌──────────────────────────┐
│   被测 Agent（黑盒）          │        │   Eval Platform (:8100)   │
│   PRODUCT_API_URL (:8001)   │◄───────│                          │
│                             │  HTTP  │  runner/    批量实验执行   │
│   评测专用隔离实例            │        │  graders/   L0/L1/L2 打分 │
│   (docker-compose.eval.yml, │        │  storage/   SQLite 存储   │
│    固定资源配额,消除基础设施   │        │  api/       REST + WS    │
│    噪声)                     │        │  cli.py     实验 CLI      │
└─────────────────────────────┘        └────────────┬─────────────┘
                                                    │
                                       ┌────────────▼─────────────┐
                                       │  标注前端 (frontend-v2/)  │
                                       │  Trace 查看 / Pass-Fail   │
                                       │  标注 / 开放编码 / 实验对比 │
                                       └──────────────────────────┘
```

## 分层评测体系（L0 → L1 → L2）

便宜、确定性的检查先跑；昂贵、需要判断力的检查后跑。失败在哪一层，就归因到哪一层（`graders/failure_funnel.py`）。

| 层 | 模块 | 检查内容 | 成本 |
|----|------|---------|------|
| L0 | `l0_structure.py` / `l0_constraints.py` | 输出结构完整性、硬约束（预算、必备条件）是否满足 | 免费，纯规则 |
| L1 | `l1_metrics.py` | 可计算指标（数量、覆盖度、来源多样性等） | 免费，纯代码 |
| L2 | `l2_judge.py` / `llm_graders.py` | 需要判断力的维度：groundedness、actionability、rubric 合规、trap 检测 | LLM 调用 |

配套：`error_taxonomy.py`（失效模式分类）、`composite.py`（加权合成总分）、`scoring.py`（阈值判定）。

## Judge 校准闭环（核心差异点）

**未校准的 judge 不可信任。** 平台把校准做成了可重复的工作流：

1. `scripts/sample_for_annotation.py` — 分层采样待标注 trace
2. `ANNOTATION_GUIDE.md` + 标注前端 — 人工标注 gold labels（Pass/Fail 判据显式成文，标注人是人不是模型）
3. `scripts/validate_evaluator.py` — judge 判定 vs 人工 gold，输出 TPR/TNR 对齐报告
4. `scripts/extract_few_shots.py` — 从分歧样本提炼 few-shot 示例（`calibration/few_shots/`）
5. `scripts/calibration_loop.py` — 注入 few-shots 重跑，迭代直到对齐达标

工程保证：

- **Judge 必须强于被测模型**（`config.py`：GRADING_MODEL 默认取更强模型——弱模型抓不住强模型级别的错误，同级模型会共享盲区）
- **Judge prompt 版本哈希**（`JUDGE_PROMPT_VERSION`）——每次实验记录 judge 版本，分数变化可归因："是 Agent 变了，还是尺子变了？"
- **通过阈值由人工标注校准得出**，并随标注量增长定期重校准，不拍脑袋

## 实验管理与回归门禁

```bash
python cli.py import --dataset legacy_v1          # 导入数据集
python cli.py run --dataset "Legacy Baseline V1" --tag v1.2 --trials 2
python cli.py summary --experiment-id 1           # 实验摘要
python cli.py regression --latest --threshold 5   # 回归检查：掉分超过阈值 → 非零退出码
```

`scripts/run_eval.sh` 封装了 CI 场景：`smoke`（冒烟）/ `regression`（回归门禁）/ `capability`（全量能力评估），退出码可直接接入流水线。支持消融实验（选择性关闭 Agent 组件，定位能力来源）。

## 接入你自己的 Agent

领域耦合集中在三层，替换它们即可接入新 Agent：

1. **端点**：让你的 Agent 暴露一个任务 API，设置 `PRODUCT_API_URL` + `EVAL_API_KEY`（`backend/.env.example`）
2. **数据集**：按 `datasets/*.json` 的 schema 编写 cases（`key` / `query` / `type` / `constraints`，可选 `golden_data`）
3. **标注指南 + graders**：参照 `ANNOTATION_GUIDE.md` 写出你的领域 Pass/Fail 判据；替换/增补 L0 约束检查和 L2 judge 维度

平台层（runner / storage / 标注前端 / 校准脚本 / CLI）与领域无关，无需改动。

## Quickstart

```bash
# 评测后端（端口 8100）
cd backend
pip install -r requirements.txt
cp .env.example .env   # 填入 ANTHROPIC_API_KEY、PRODUCT_API_URL、EVAL_API_KEY
python main.py

# 标注/实验前端
cd frontend-v2
npm install && npm run dev
```

被测系统的隔离实例部署示例见 `examples/azora/docker-compose.eval.yml`。

## 目录结构

```
backend/          # FastAPI 评测后端：api/ graders/ runner/ storage/ agent/
frontend/         # 标注与实验 UI（v1，含失效漏斗、分数趋势、实验对比）
frontend-v2/      # 标注与实验 UI（v2，datasets/evaluators/experiments/observation）
calibration/      # Judge 校准 few-shots（groundedness / actionability / rubric / trap）
datasets/         # 数据集（AZORA 案例：deepshop_v1 / legacy_v1）
scripts/          # 采样、标注、校准、回归、LangFuse 导出等工作流脚本
examples/azora/   # 第一个接入案例的部署配置
l2-codex/         # 跨厂商 L2 judge 实验（Codex SDK）
cli.py            # 实验 CLI
ANNOTATION_GUIDE.md  # 标注指南（AZORA 案例实例，可作为你的领域模板）
```

## 现状与边界

- 平台架构与被测系统解耦（HTTP 黑盒），但**第一案例是购物研究场景**：部分 grader（如 `search_quality.py`、`retrieval_grader.py`）和数据集带有该领域印记，接入新领域时按上文三层替换。
- 校准数值（阈值、TPR/TNR）以你自己数据上 `validate_evaluator.py` 的输出为准——不要沿用案例中的数字。
- 生产 trace 导入目前对接 LangFuse（`scripts/export_langfuse.py`）。

## 方法论参考

评测方法论对齐 [Hamel Husain 的 evals 体系](https://hamel.dev/blog/posts/evals/)：错误分析先行、人工 gold 为锚、judge 必须校准、指标服务于迭代而非汇报。
