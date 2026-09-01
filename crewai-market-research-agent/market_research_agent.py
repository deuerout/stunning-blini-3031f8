"""CrewAI Market Researcher agent: identifies market trends and produces
an actionable insights report for a given market segment.

Usage:
    export OPENAI_API_KEY=...      # LLM backing the agent
    export SERPER_API_KEY=...      # web search for MarketAnalysisTool
    python market_research_agent.py "Sustainable Technologies"
"""

import sys

from crewai import Agent, Crew, Process, Task
from crewai_tools import SerperDevTool


class MarketAnalysisTool(SerperDevTool):
    """Search-backed tool scoped to market/industry research queries."""

    name: str = "Market Analysis Search"
    description: str = (
        "Searches the web for market trends, customer preferences, competitor "
        "activity, and growth opportunities for a given market segment."
    )

    def _run(self, search_query: str) -> str:
        return super()._run(search_query=f"{search_query} market trends analysis 2026")


def build_market_researcher() -> Agent:
    return Agent(
        role="Market Researcher",
        goal=(
            "Identify emerging trends, customer preferences, and growth "
            "opportunities in {market_segment}, and turn them into actionable "
            "recommendations."
        ),
        backstory=(
            "Armed with analytical prowess and a knack for spotting trends, "
            "you navigate complex market data to unearth opportunities that "
            "help shape strategic decisions."
        ),
        tools=[MarketAnalysisTool()],
        verbose=True,
        memory=True,
        allow_delegation=False,
    )


def build_market_analysis_task(agent: Agent) -> Task:
    return Task(
        description=(
            "Analyze the {market_segment} market segment. Identify current "
            "trends, shifting customer preferences, key competitors, and "
            "potential growth opportunities."
        ),
        expected_output=(
            "A structured report containing: (1) a summary of current trends, "
            "(2) customer preference shifts, (3) notable competitors or "
            "players, (4) growth opportunities, and (5) concrete, actionable "
            "recommendations."
        ),
        agent=agent,
    )


def build_crew() -> Crew:
    market_researcher = build_market_researcher()
    market_analysis_task = build_market_analysis_task(market_researcher)
    return Crew(
        agents=[market_researcher],
        tasks=[market_analysis_task],
        process=Process.sequential,
        verbose=True,
    )


def main() -> None:
    market_segment = sys.argv[1] if len(sys.argv) > 1 else "Sustainable Technologies"
    crew = build_crew()
    result = crew.kickoff(inputs={"market_segment": market_segment})
    print(result)


if __name__ == "__main__":
    main()
