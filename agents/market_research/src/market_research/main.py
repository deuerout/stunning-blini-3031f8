"""CLI entry point.

    python -m market_research.main --segment "Sustainable Technologies" \
        --region "United Kingdom" --client "a Bedford-based SME manufacturer" \
        --horizon "3 years"
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

DEFAULTS = {
    "market_segment": "Sustainable Technologies",
    "region": "United Kingdom",
    "client_context": "a mid-sized UK business planning its digital and sustainability transformation",
    "time_horizon": "3 years",
}


def build_inputs(argv: list[str] | None = None) -> dict[str, str]:
    p = argparse.ArgumentParser(description="Deverout and Associates market research crew")
    p.add_argument("--segment", default=DEFAULTS["market_segment"])
    p.add_argument("--region", default=DEFAULTS["region"])
    p.add_argument("--client", default=DEFAULTS["client_context"])
    p.add_argument("--horizon", default=DEFAULTS["time_horizon"])
    a = p.parse_args(argv)
    return {
        "market_segment": a.segment,
        "region": a.region,
        "client_context": a.client,
        "time_horizon": a.horizon,
        "current_date": date.today().isoformat(),
    }


def run(argv: list[str] | None = None) -> None:
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except ImportError:
        pass

    from market_research.crew import MarketResearchCrew

    inputs = build_inputs(argv if argv is not None else sys.argv[1:])
    Path("output").mkdir(exist_ok=True)
    result = MarketResearchCrew().crew().kickoff(inputs=inputs)

    report = result.pydantic
    if report is not None:
        md = Path("output/03_strategy_report.md")
        md.write_text(report.to_markdown(), encoding="utf-8")
        print(f"\nStrategy brief written to {md.resolve()}")
    else:
        print(result.raw)
    if result.token_usage:
        print(f"Token usage: {result.token_usage}")


if __name__ == "__main__":
    run()
