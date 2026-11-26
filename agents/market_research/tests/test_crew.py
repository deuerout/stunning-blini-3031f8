"""Offline tests: tools, models and crew wiring (no LLM calls)."""

import json

import pytest

from market_research.main import build_inputs
from market_research.models import Opportunity, RoadmapAction, StrategyReport, Trend, Risk
from market_research.tools.market_tools import (
    MarketSizingTool,
    OpportunityScoringTool,
    score_opportunity,
    size_market,
)


def test_size_market_funnel_and_projection():
    r = size_market(10_000, 5_000, 0.4, 0.1, 0.10, years=2)
    assert r["tam"] == 50_000_000
    assert r["sam"] == 20_000_000
    assert r["som"] == 2_000_000
    assert r["projection"][1]["som"] == pytest.approx(2_420_000)


def test_sizing_tool_returns_json():
    out = json.loads(MarketSizingTool().run(
        total_addressable_customers=100, average_annual_value=10,
        serviceable_share=0.5, obtainable_share=0.5, annual_growth_rate=0.0, years=1))
    assert out["som"] == 250


def test_scoring_inverts_negative_criteria():
    best = score_opportunity("a", market_growth=10, market_size=10, competitive_intensity=1,
                             capability_fit=10, regulatory_risk=1, time_to_value=10)
    worst = score_opportunity("b", market_growth=1, market_size=1, competitive_intensity=10,
                              capability_fit=1, regulatory_risk=10, time_to_value=1)
    assert best["weighted_score"] == 10.0 and best["recommendation"] == "pursue"
    assert worst["weighted_score"] == 1.0 and worst["recommendation"] == "deprioritise"


def test_scoring_tool_runs():
    out = json.loads(OpportunityScoringTool().run(
        opportunity="x", market_growth=6, market_size=6, competitive_intensity=5,
        capability_fit=6, regulatory_risk=5, time_to_value=6))
    assert 5 <= out["weighted_score"] <= 7


def test_report_markdown_sorts_opportunities():
    rep = StrategyReport(
        title="T", market_segment="S", region="R", executive_summary="E",
        key_trends=[Trend(name="t", description="d", evidence="e", impact="high")],
        market_sizing_summary="M",
        prioritised_opportunities=[
            Opportunity(name="low", rationale="r", weighted_score=4, estimated_value="v"),
            Opportunity(name="high", rationale="r", weighted_score=8, estimated_value="v"),
        ],
        roadmap=[RoadmapAction(horizon="30 days", action="a", owner="o", outcome="x")],
        risks=[Risk(risk="r", likelihood="low", mitigation="m")],
        kpis=["k"], mentoring_and_capability_needs=["m"], confidence_note="c",
    )
    md = rep.to_markdown()
    assert md.index("| 1 | high") < md.index("| 2 | low")


def test_inputs_defaults():
    i = build_inputs([])
    assert set(i) == {"market_segment", "region", "client_context", "time_horizon", "current_date"}


def test_crew_wiring(monkeypatch):
    monkeypatch.setenv("MODEL", "anthropic/claude-sonnet-5-5")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.delenv("SERPER_API_KEY", raising=False)
    from market_research.crew import MarketResearchCrew

    c = MarketResearchCrew().crew()
    roles = [a.role.strip() for a in c.agents]
    assert len(roles) == 3
    assert roles[1] == "Market Data Analyst"
    assert [t.agent.role for t in c.tasks] == [a.role for a in c.agents]
    assert c.tasks[2].output_pydantic is StrategyReport
    assert {t.name for t in c.agents[1].tools} == {"Market Sizing Calculator", "Opportunity Scoring"}
    assert c.agents[2].allow_delegation is True
