#!/usr/bin/env python3
"""Solomon AI: Monte Carlo validator for the compliance-investment ROI claim.

WHAT THIS DOES NOT DO: it does not confirm the "543% ROI over 3 years,
14-month payback" figure from the CFO business case. Nothing in the
handover material supplies the underlying risk model (per-framework
incident probabilities, loss severity distributions, or how much the
$400K investment actually reduces either) -- those numbers do not exist
yet anywhere in this repo. This script takes clearly-labeled, editable
placeholder assumptions, decomposes the headline "$6.45M expected annual
risk exposure" figure across the five compliance frameworks actually named
in the handover doc (GDPR, UK GDPR, EU AI Act, NY Local Law 144, EEOC),
and reports whatever ROI distribution falls out of those assumptions.
Swap ASSUMPTIONS below for real actuarial/legal input before this goes in
front of a customer or the board -- the output is only as good as those
numbers, and right now they are illustrative, not sourced.

Model, per risk category, per year, per trial:
    incident occurs ~ Bernoulli(p_baseline)                [no compliance investment]
    incident occurs ~ Bernoulli(p_baseline * (1 - mitigation))  [with investment]
    loss if it occurs ~ Lognormal(fit to given min/mode/max via a
                                   simple percentile-matching heuristic)

3-year totals are summed per trial; ROI = (avoided_loss - investment_cost) / investment_cost.
Investment cost itself carries a modest implementation-overrun uncertainty
band rather than being treated as a fixed number.

Usage:
    python3 solomon_roi_monte_carlo.py [--trials 10000] [--seed 42]
                                        [--years 3] [--investment 400000]
                                        [--csv OUT.csv]

Requires: numpy, pandas.
"""
import argparse
import sys

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# ASSUMPTIONS -- everything in this block is a placeholder pending real
# input (legal's estimate of enforcement probability per framework, actual
# claims-history or industry benchmark loss severities, and an honest
# estimate of how much a compliance program actually moves incident
# probability). Edit these, not the simulation mechanics below.
#
# annual_p_baseline: probability of at least one enforcement/incident event
#   in this category in a given year, WITHOUT the compliance investment.
# mitigation_range: (low, high) fractional reduction in that probability
#   WITH the investment -- sampled per trial, not a fixed multiplier,
#   because "how effective is this program" is itself uncertain.
# loss_min / loss_mode / loss_max: informal PERT-style bounds on loss IF an
#   incident occurs (fines, remediation, lost deals, legal costs combined).
# ---------------------------------------------------------------------------
ASSUMPTIONS = [
    {
        "category": "GDPR",
        "annual_p_baseline": 0.12,
        "mitigation_range": (0.35, 0.65),
        "loss_min": 50_000,
        "loss_mode": 800_000,
        "loss_max": 8_000_000,  # GDPR fines can reach 4% of global turnover
    },
    {
        "category": "UK GDPR",
        "annual_p_baseline": 0.08,
        "mitigation_range": (0.35, 0.65),
        "loss_min": 30_000,
        "loss_mode": 400_000,
        "loss_max": 4_000_000,
    },
    {
        "category": "EU AI Act",
        "annual_p_baseline": 0.06,
        "mitigation_range": (0.30, 0.60),
        "loss_min": 100_000,
        "loss_mode": 1_500_000,
        "loss_max": 15_000_000,  # high-risk AI system violations can reach 15M EUR or 3% turnover
    },
    {
        "category": "NY Local Law 144",
        "annual_p_baseline": 0.10,
        "mitigation_range": (0.40, 0.70),
        "loss_min": 10_000,
        "loss_mode": 150_000,
        "loss_max": 1_500_000,
    },
    {
        "category": "EEOC",
        "annual_p_baseline": 0.09,
        "mitigation_range": (0.30, 0.55),
        "loss_min": 50_000,
        "loss_mode": 600_000,
        "loss_max": 6_000_000,
    },
]

# Sanity check against the headline claim: sum(p_baseline * loss_mode) is
# reported against the cited $6.45M "expected annual risk exposure" so a
# gap between the two is visible up front rather than silently absorbed
# into the simulation. It is NOT tuned to match -- see the printed warning
# in main() when it doesn't.
_naive_expected_annual = sum(a["annual_p_baseline"] * a["loss_mode"] for a in ASSUMPTIONS)
_CITED_ANNUAL_EXPOSURE = 6_450_000


def lognormal_params_from_pert(low, mode, high):
    """Rough percentile-matching fit of a lognormal to (min, mode, max).

    Not a rigorous PERT-to-lognormal conversion -- treats `mode` as
    approximately the median and (low, high) as roughly the 5th/95th
    percentiles, solves for (mu, sigma) accordingly. Adequate for an
    illustrative model; replace with an actual fitted distribution once
    real loss-history data exists.
    """
    if not (low < mode < high):
        raise ValueError(f"expected low < mode < high, got {low}, {mode}, {high}")
    mu = np.log(mode)
    # 90% of a lognormal falls within mu +/- 1.645*sigma (in log space);
    # approximate sigma from the wider of the two half-ranges.
    sigma_hi = (np.log(high) - mu) / 1.645
    sigma_lo = (mu - np.log(low)) / 1.645
    sigma = max(sigma_hi, sigma_lo, 0.05)
    return mu, sigma


def run_simulation(trials, years, investment_base, seed):
    rng = np.random.default_rng(seed)
    n_cat = len(ASSUMPTIONS)

    baseline_total = np.zeros(trials)
    mitigated_total = np.zeros(trials)

    for cat in ASSUMPTIONS:
        p = cat["annual_p_baseline"]
        mu, sigma = lognormal_params_from_pert(cat["loss_min"], cat["loss_mode"], cat["loss_max"])

        # Mitigation effectiveness sampled once per trial (a program is
        # either broadly effective or not, within a trial, not re-rolled
        # per year).
        mitigation = rng.uniform(cat["mitigation_range"][0], cat["mitigation_range"][1], size=trials)
        p_mitigated = p * (1.0 - mitigation)

        for _year in range(years):
            # Common random numbers: a single uniform draw decides whether
            # the underlying incident-triggering event happens, compared
            # against the baseline and mitigated probabilities separately.
            # Since p_mitigated <= p by construction, this guarantees
            # occurs_mitigated <= occurs_baseline in every trial -- a
            # mitigation program can prevent an incident, never cause an
            # extra one. Drawing baseline/mitigated occurrence independently
            # (two separate Bernoulli draws) would let mitigated incidents
            # exceed baseline ones by chance, which doesn't correspond to
            # anything real and just adds spurious variance to avoided_loss.
            u = rng.uniform(0.0, 1.0, size=trials)
            occurs_baseline = (u < p).astype(float)
            occurs_mitigated = (u < p_mitigated).astype(float)
            loss = rng.lognormal(mu, sigma, size=trials)
            loss = np.minimum(loss, cat["loss_max"] * 2)  # cap absurd tail draws

            baseline_total += occurs_baseline * loss
            mitigated_total += occurs_mitigated * loss

    avoided_loss = baseline_total - mitigated_total

    # Investment cost carries its own modest uncertainty (+/-20% implementation
    # overrun/underrun) rather than being a bare constant.
    investment_cost = investment_base * rng.uniform(0.8, 1.2, size=trials)

    roi = (avoided_loss - investment_cost) / investment_cost

    return pd.DataFrame(
        {
            "baseline_3yr_loss": baseline_total,
            "mitigated_3yr_loss": mitigated_total,
            "avoided_loss": avoided_loss,
            "investment_cost": investment_cost,
            "roi": roi,
        }
    )


def payback_months_estimate(avoided_loss_per_trial, years, investment_cost_per_trial):
    """Rough payback estimate: assume avoided loss accrues evenly across
    the period (a simplification -- incidents are actually lumpy/annual,
    but a smooth-accrual estimate is the standard way this kind of payback
    figure gets quoted, so match that convention for comparability)."""
    monthly_avoided = avoided_loss_per_trial / (years * 12.0)
    with np.errstate(divide="ignore", invalid="ignore"):
        months = np.where(monthly_avoided > 0, investment_cost_per_trial / monthly_avoided, np.inf)
    return months


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--trials", type=int, default=10_000)
    parser.add_argument("--years", type=int, default=3)
    parser.add_argument("--investment", type=float, default=400_000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--csv", type=str, default=None, help="Optional path to write raw per-trial results")
    args = parser.parse_args()

    ratio = _CITED_ANNUAL_EXPOSURE / _naive_expected_annual if _naive_expected_annual else float("inf")
    print(f"Assumptions check: naive sum(p_baseline * loss_mode) across categories = "
          f"${_naive_expected_annual:,.0f}/year  vs.  cited claim ${_CITED_ANNUAL_EXPOSURE:,.0f}/year "
          f"({ratio:.1f}x apart).")
    if ratio >= 2 or ratio <= 0.5:
        print(
            "WARNING: these illustrative per-category assumptions do NOT reproduce the "
            "cited $6.45M figure even approximately. Either the placeholder probabilities/"
            "severities here are too conservative, or the $6.45M figure needs its own "
            "documented derivation (which categories, what probabilities, what severities) "
            "before it goes in front of a customer or the board -- right now it does not "
            "trace back to anything in the handover material."
        )
    print()

    df = run_simulation(args.trials, args.years, args.investment, args.seed)

    if args.csv:
        df.to_csv(args.csv, index=False)
        print(f"Wrote {len(df)} raw trial results to {args.csv}\n")

    roi_pct = df["roi"] * 100
    payback = payback_months_estimate(df["avoided_loss"].to_numpy(), args.years, df["investment_cost"].to_numpy())

    print(f"=== Monte Carlo ROI Validation ({args.trials:,} trials, {args.years}-year horizon) ===\n")
    print("ROI distribution (%):")
    print(roi_pct.describe(percentiles=[0.05, 0.25, 0.5, 0.75, 0.95]).to_string())
    print()
    print(f"P(ROI >= 543%)          : {(roi_pct >= 543).mean() * 100:.1f}%")
    print(f"P(ROI > 0%, i.e. any net benefit): {(roi_pct > 0).mean() * 100:.1f}%")
    print(f"P(investment loses money, ROI < 0%): {(roi_pct < 0).mean() * 100:.1f}%")
    print()

    finite_payback = payback[np.isfinite(payback)]
    print("Payback period (months), among trials where the investment ever pays back:")
    if len(finite_payback) > 0:
        pb_series = pd.Series(finite_payback)
        print(pb_series.describe(percentiles=[0.05, 0.25, 0.5, 0.75, 0.95]).to_string())
        print(f"\nP(payback within 14 months): {(finite_payback <= 14).mean() * 100:.1f}%")
    else:
        print("  (no trials paid back within the simulated horizon)")
    print(f"P(never pays back within {args.years} years): {(~np.isfinite(payback)).mean() * 100:.1f}%")

    print("\n--- Assessment ---")
    median_roi = roi_pct.median()
    p_beat_claim = (roi_pct >= 543).mean() * 100
    print(
        f"Under these placeholder assumptions, median simulated 3-year ROI is "
        f"{median_roi:.0f}%, and {p_beat_claim:.0f}% of trials meet or beat the "
        f"cited 543% figure. This is NOT a validation or refutation of the "
        f"actual claim -- it shows what a defensible-looking model produces "
        f"from illustrative inputs. Before this goes near a customer or the "
        f"board: replace ASSUMPTIONS with sourced enforcement-probability and "
        f"loss-severity data (regulator enforcement statistics, actual claims "
        f"history, or a named industry benchmark), and get the mitigation_range "
        f"figures from whoever actually built the compliance program, not from "
        f"this script."
    )


if __name__ == "__main__":
    sys.exit(main())
