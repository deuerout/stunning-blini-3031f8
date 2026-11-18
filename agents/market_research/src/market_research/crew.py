"""Market Research & Transformation Strategy crew."""

from __future__ import annotations

import os

from crewai import Agent, Crew, Process, Task
from crewai.project import CrewBase, agent, crew, task

from market_research.models import StrategyReport
from market_research.tools.market_tools import (
    MarketSizingTool,
    OpportunityScoringTool,
    research_tools,
)


def _llm() -> str:
    return os.getenv("MODEL", "anthropic/claude-sonnet-5-5")


def _flag(name: str) -> bool:
    return os.getenv(name, "false").strip().lower() in {"1", "true", "yes"}


@CrewBase
class MarketResearchCrew:
    """Researcher → Analyst → Strategy Advisor."""

    agents_config = "config/agents.yaml"
    tasks_config = "config/tasks.yaml"

    # ------------------------------------------------------------ agents
    @agent
    def market_researcher(self) -> Agent:
        return Agent(
            config=self.agents_config["market_researcher"],
            tools=research_tools(),
            llm=_llm(),
            allow_delegation=False,
            max_iter=15,
            max_rpm=20,
            inject_date=True,
            verbose=True,
        )

    @agent
    def data_analyst(self) -> Agent:
        return Agent(
            config=self.agents_config["data_analyst"],
            tools=[MarketSizingTool(), OpportunityScoringTool()],
            llm=_llm(),
            allow_delegation=False,
            max_iter=15,
            verbose=True,
        )

    @agent
    def strategy_advisor(self) -> Agent:
        return Agent(
            config=self.agents_config["strategy_advisor"],
            llm=_llm(),
            # may ask the researcher/analyst to fill a gap before writing
            allow_delegation=True,
            max_iter=10,
            verbose=True,
        )

    # ------------------------------------------------------------- tasks
    @task
    def research_task(self) -> Task:
        return Task(config=self.tasks_config["research_task"], output_file="output/01_research.md")

    @task
    def analysis_task(self) -> Task:
        return Task(config=self.tasks_config["analysis_task"], output_file="output/02_analysis.md")

    @task
    def strategy_report_task(self) -> Task:
        return Task(
            config=self.tasks_config["strategy_report_task"],
            output_pydantic=StrategyReport,
            output_file="output/03_strategy_report.json",
        )

    # -------------------------------------------------------------- crew
    @crew
    def crew(self) -> Crew:
        hierarchical = os.getenv("CREW_PROCESS", "sequential").lower() == "hierarchical"
        kwargs = dict(
            agents=self.agents,
            tasks=self.tasks,
            process=Process.hierarchical if hierarchical else Process.sequential,
            memory=_flag("CREW_MEMORY"),
            verbose=True,
        )
        if hierarchical:
            kwargs["manager_llm"] = _llm()
            # the manager assigns work; agents must not be pre-bound to a delegator
        return Crew(**kwargs)
