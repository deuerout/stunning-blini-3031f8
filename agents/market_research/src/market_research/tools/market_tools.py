"""Deterministic analysis tools so agents never do arithmetic in their heads."""

from __future__ import annotations

import json
import os

from crewai.tools import BaseTool
from pydantic import BaseModel, Field


# ---------------------------------------------------------------- sizing
class MarketSizingInput(BaseModel):
    total_addressable_customers: float = Field(..., gt=0, description="Number of potential customers in the whole market")
    average_annual_value: float = Field(..., gt=0, description="Average annual revenue per customer (currency units)")
    serviceable_share: float = Field(..., gt=0, le=1, description="Fraction of TAM the client can realistically serve (0-1)")
    obtainable_share: float = Field(..., gt=0, le=1, description="Fraction of SAM the client can win (0-1)")
    annual_growth_rate: float = Field(..., gt=-1, lt=5, description="Expected CAGR as a decimal, e.g. 0.12 for 12%")
    years: int = Field(3, ge=1, le=15, description="Projection horizon in years")
    currency: str = Field("GBP", description="ISO currency code for display")


def size_market(
    total_addressable_customers: float,
    average_annual_value: float,
    serviceable_share: float,
    obtainable_share: float,
    annual_growth_rate: float,
    years: int = 3,
    currency: str = "GBP",
) -> dict:
    tam = total_addressable_customers * average_annual_value
    sam = tam * serviceable_share
    som = sam * obtainable_share
    projection = [
        {
            "year": y,
            "tam": round(tam * (1 + annual_growth_rate) ** y, 2),
            "sam": round(sam * (1 + annual_growth_rate) ** y, 2),
            "som": round(som * (1 + annual_growth_rate) ** y, 2),
        }
        for y in range(1, years + 1)
    ]
    return {
        "currency": currency,
        "tam": round(tam, 2),
        "sam": round(sam, 2),
        "som": round(som, 2),
        "cagr": annual_growth_rate,
        "projection": projection,
    }


class MarketSizingTool(BaseTool):
    name: str = "Market Sizing Calculator"
    description: str = (
        "Calculates TAM, SAM and SOM from customer count, annual value per customer and "
        "share assumptions, then projects them forward at a CAGR. Returns JSON."
    )
    args_schema: type[BaseModel] = MarketSizingInput

    def _run(self, **kwargs) -> str:
        return json.dumps(size_market(**kwargs), indent=2)


# ---------------------------------------------------------------- scoring
# Positive criteria: higher is better. Negative criteria are inverted (11 - x).
SCORING_WEIGHTS: dict[str, float] = {
    "market_growth": 0.20,
    "market_size": 0.15,
    "competitive_intensity": 0.15,  # inverted
    "capability_fit": 0.25,
    "regulatory_risk": 0.10,        # inverted
    "time_to_value": 0.15,          # 10 = fastest
}
INVERTED = {"competitive_intensity", "regulatory_risk"}


class OpportunityScoringInput(BaseModel):
    opportunity: str = Field(..., description="Short name of the opportunity")
    market_growth: int = Field(..., ge=1, le=10)
    market_size: int = Field(..., ge=1, le=10)
    competitive_intensity: int = Field(..., ge=1, le=10, description="10 = extremely crowded")
    capability_fit: int = Field(..., ge=1, le=10, description="Fit with the client's current capabilities")
    regulatory_risk: int = Field(..., ge=1, le=10, description="10 = very high regulatory risk")
    time_to_value: int = Field(..., ge=1, le=10, description="10 = value realised fastest")


def score_opportunity(opportunity: str, **criteria: int) -> dict:
    contributions = {}
    for key, weight in SCORING_WEIGHTS.items():
        raw = criteria[key]
        adjusted = 11 - raw if key in INVERTED else raw
        contributions[key] = round(adjusted * weight, 3)
    total = round(sum(contributions.values()), 2)
    band = "pursue" if total >= 7 else "explore" if total >= 5 else "deprioritise"
    return {"opportunity": opportunity, "weighted_score": total, "recommendation": band, "contributions": contributions}


class OpportunityScoringTool(BaseTool):
    name: str = "Opportunity Scoring"
    description: str = (
        "Scores a market opportunity 0-10 using a weighted matrix (growth, size, competition, "
        "capability fit, regulatory risk, time to value). Competition and regulatory risk are "
        "inverted so lower raw values score higher. Returns JSON with the band "
        "pursue / explore / deprioritise."
    )
    args_schema: type[BaseModel] = OpportunityScoringInput

    def _run(self, opportunity: str, **criteria: int) -> str:
        return json.dumps(score_opportunity(opportunity, **criteria), indent=2)


# ---------------------------------------------------------------- research
def research_tools() -> list[BaseTool]:
    """Live web tools when credentials exist; empty list otherwise."""
    tools: list[BaseTool] = []
    try:
        from crewai_tools import ScrapeWebsiteTool, SerperDevTool
    except ImportError:
        return tools
    if os.getenv("SERPER_API_KEY"):
        tools.append(SerperDevTool(n_results=10))
    tools.append(ScrapeWebsiteTool())
    return tools
