"""Structured output for the final strategy brief."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Trend(BaseModel):
    name: str
    description: str
    evidence: str = Field(description="Source(s) supporting the trend")
    impact: Literal["low", "medium", "high"]


class Opportunity(BaseModel):
    name: str
    rationale: str
    weighted_score: float = Field(ge=0, le=10)
    estimated_value: str = Field(description="Sized prize, e.g. '£12m–£18m SOM by 2029'")


class RoadmapAction(BaseModel):
    horizon: Literal["30 days", "90 days", "12 months"]
    action: str
    owner: str
    outcome: str


class Risk(BaseModel):
    risk: str
    likelihood: Literal["low", "medium", "high"]
    mitigation: str


class StrategyReport(BaseModel):
    title: str
    market_segment: str
    region: str
    executive_summary: str
    key_trends: list[Trend]
    market_sizing_summary: str
    prioritised_opportunities: list[Opportunity]
    roadmap: list[RoadmapAction]
    risks: list[Risk]
    kpis: list[str]
    mentoring_and_capability_needs: list[str]
    confidence_note: str

    def to_markdown(self) -> str:
        lines = [
            f"# {self.title}",
            f"_{self.market_segment} · {self.region}_",
            "",
            "## Executive summary",
            self.executive_summary,
            "",
            "## Key trends",
        ]
        for t in self.key_trends:
            lines.append(f"- **{t.name}** ({t.impact} impact) — {t.description} _Evidence: {t.evidence}_")
        lines += ["", "## Market sizing", self.market_sizing_summary, "", "## Prioritised opportunities",
                  "| # | Opportunity | Score | Value | Rationale |", "|---|---|---|---|---|"]
        for i, o in enumerate(sorted(self.prioritised_opportunities, key=lambda o: -o.weighted_score), 1):
            lines.append(f"| {i} | {o.name} | {o.weighted_score:.1f} | {o.estimated_value} | {o.rationale} |")
        lines += ["", "## Roadmap", "| Horizon | Action | Owner | Outcome |", "|---|---|---|---|"]
        for a in self.roadmap:
            lines.append(f"| {a.horizon} | {a.action} | {a.owner} | {a.outcome} |")
        lines += ["", "## Risks"]
        for r in self.risks:
            lines.append(f"- **{r.risk}** ({r.likelihood}) — {r.mitigation}")
        lines += ["", "## KPIs"] + [f"- {k}" for k in self.kpis]
        lines += ["", "## Mentoring & capability building"] + [f"- {m}" for m in self.mentoring_and_capability_needs]
        lines += ["", "## Confidence", self.confidence_note, ""]
        return "\n".join(lines)
