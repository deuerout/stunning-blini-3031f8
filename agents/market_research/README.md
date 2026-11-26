# Market Research & Transformation Strategy Crew (CrewAI)

A three-agent CrewAI crew for Deverout and Associates. You give it a market, a region, a client and a time horizon. It researches the market, sizes the opportunity, scores it, and writes a board-ready transformation brief.

```
inputs ──► Market Researcher ──► Data Analyst ──► Strategy Advisor ──► StrategyReport (JSON + Markdown)
           (web search,          (sizing + scoring  (roadmap, risks, KPIs,
            scraping)             tools)             mentoring needs)
```

## How it was designed

| Step | Where it lives |
|---|---|
| 1. Purpose and role | Each agent's `role` and `goal` in `config/agents.yaml`. The domain is market research for business transformation. |
| 2. Skills and attributes | Backstories set the analytical, evidence-first, culturally aware behaviour. Autonomy comes from `max_iter`, `allow_delegation` and `max_rpm` in `crew.py`. |
| 3. Backstory and goals | `config/agents.yaml`. Every goal ties to the crew's single output, the strategy brief. |
| 4. Tools | `tools/market_tools.py`: Serper search and website scraping, plus two deterministic tools (the **Market Sizing Calculator** for TAM/SAM/SOM and projections, and **Opportunity Scoring**, a weighted 0–10 matrix). |
| 5. Tasks | `config/tasks.yaml`: research → analysis → strategy report. Each task has an explicit `expected_output`. |
| 6. Interactions and process | Tasks pass results forward through `context`. The process is sequential by default, or `CREW_PROCESS=hierarchical` to have a manager LLM assign the work. The Strategy Advisor can delegate back to fill gaps. |
| 7. Implement and test | `tests/test_crew.py` checks the tools, the output model and the crew wiring without calling an LLM. |

### Fixes compared with the original example
- `Agent` has no `tasks=` or `autonomy=` parameters. Autonomy is controlled through `max_iter`, `allow_delegation` and `max_rpm`.
- A `Task` must have an `agent`. The original task had none.
- Subclassing `SerperDevTool` and overriding `_run` turned off the real search. Search now uses the real `SerperDevTool`, and the analysis tools are proper `BaseTool`s with typed `args_schema`s.
- The final output is a typed `StrategyReport` (Pydantic), not free text.

## Setup

```bash
cd agents/market_research
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env      # add ANTHROPIC_API_KEY (and SERPER_API_KEY for live search)
```

## Run

```bash
python -m market_research.main \
  --segment "Sustainable Technologies" \
  --region "United Kingdom" \
  --client "a Bedford-based SME manufacturer" \
  --horizon "3 years"
```

Outputs go to `output/`:
- `01_research.md`: research dossier with sources and evidence gaps
- `02_analysis.md`: assumptions, TAM/SAM/SOM (conservative and optimistic), opportunity scores
- `03_strategy_report.json` and `03_strategy_report.md`: the final brief

## Test

```bash
pytest
```

## Customising
- **Another domain:** edit the YAML files. No Python changes are needed.
- **Another model:** set `MODEL` (for example `anthropic/claude-opus-5-5` or `openai/gpt-…`) and install the matching CrewAI extra.
- **Different scoring priorities:** change `SCORING_WEIGHTS` in `tools/market_tools.py`.
- **Memory across runs:** set `CREW_MEMORY=true` (needs an embedder; OpenAI embeddings are the default).
- **Scaling up:** add agents such as a Competitor Intelligence Analyst or a Customer Voice Analyst with a task each, and add them to `context` in `strategy_report_task`.
