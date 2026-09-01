# CrewAI Market Research Agent

A single-agent CrewAI crew: a "Market Researcher" that analyzes a given
market segment and produces a trend report with actionable recommendations.

## Design

- **Role**: Market Researcher
- **Goal**: identify emerging trends, customer preferences, and growth
  opportunities in a given market segment, and turn them into actionable
  recommendations.
- **Backstory**: gives the agent an analytical, trend-spotting persona so its
  output reads as strategic insight rather than a raw data dump.
- **Tool**: `MarketAnalysisTool`, a `SerperDevTool` subclass that scopes web
  search queries to market/trend analysis for the segment under research.
- **Task**: analyze the segment and return a structured report (trends,
  customer preference shifts, competitors, growth opportunities,
  recommendations).
- **Process**: sequential — a single task run by a single agent; the crew is
  structured so additional agents/tasks (e.g. a writer or a
  competitor-analysis specialist) can be appended later without changing this
  one.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env   # fill in OPENAI_API_KEY and SERPER_API_KEY
```

## Run

```bash
python market_research_agent.py "Sustainable Technologies"
```

Omit the argument to default to `"Sustainable Technologies"`.
