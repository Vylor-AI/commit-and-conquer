import json
from datetime import datetime

DATA_INPUT_FILE = "vylor_empire_history.json"


def analyze_june15_pivot():
    with open(DATA_INPUT_FILE, "r") as f:
        history = json.load(f)

    history = sorted(history, key=lambda x: x["date"])

    jan_start = None
    june_pivot = None
    july_end = None

    for step in history:
        dt = datetime.strptime(step["date"], "%Y-%m-%d")
        if dt <= datetime(2026, 1, 1):
            jan_start = step
        if dt <= datetime(2026, 6, 15):
            june_pivot = step
        if dt <= datetime(2026, 7, 15):
            july_end = step

    jan_dt = datetime.strptime(jan_start["date"], "%Y-%m-%d")
    pivot_dt = datetime.strptime(june_pivot["date"], "%Y-%m-%d")
    july_dt = datetime.strptime(july_end["date"], "%Y-%m-%d")

    baseline_days = (pivot_dt - jan_dt).days
    sprint_days = (july_dt - pivot_dt).days

    print(f"--- REFINED PIVOT ANALYSIS (June 15 Boundary) ---")
    print(
        f"Baseline Era: {jan_start['date']} to {june_pivot['date']} ({baseline_days} days)"
    )
    print(
        f"Sprint Era  : {june_pivot['date']} to {july_end['date']} ({sprint_days} days)\n"
    )
    print(
        f"{'Developer':<15} | {'Jan-MidJune Baseline':<22} | {'Expected July 15':<18} | {'Actual July 15':<15} | {'Net Reclaimed'}"
    )
    print("-" * 95)

    all_players = set(june_pivot["scores"].keys()).union(july_end["scores"].keys())

    for player in sorted(all_players):
        if player == "Vylor":
            continue

        loc_jan = jan_start["scores"].get(player, 0)
        loc_pivot = june_pivot["scores"].get(player, 0)
        net_baseline_added = loc_pivot - loc_jan

        monthly_vel = (
            (net_baseline_added / baseline_days) * 30.0 if baseline_days > 0 else 0
        )
        daily_vel = net_baseline_added / baseline_days if baseline_days > 0 else 0

        expected_growth = daily_vel * sprint_days
        expected_july_total = loc_pivot + expected_growth
        actual_july_total = july_end["scores"].get(player, 0)
        net_reclaimed = actual_july_total - expected_july_total

        if expected_july_total == 0 and actual_july_total == 0:
            continue

        print(
            f"{player:<15} | {monthly_vel:<19,.0f}/mo | {expected_july_total:<18,.0f} | {actual_july_total:<15,} | {net_reclaimed:,.0f}"
        )


if __name__ == "__main__":
    analyze_june15_pivot()
