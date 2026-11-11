import os
import json
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from datetime import datetime, timedelta

# --- CONFIGURATION ---
DATA_INPUT_FILE = "vylor_empire_history.json"
TEMP_FRAME_DIR = "vylor_map_frames"

# Classic GitHub contribution shades translated for each developer
PLAYER_THEMES = {
    "Ahmad": {
        "shades": ["#0e1117", "#0e4429", "#006d30", "#26a641", "#39d353"],  # Greens
        "label": "Ahmad",
    },
    "Shadi": {
        "shades": ["#0e1117", "#1b2a4a", "#2b4c7e", "#3a6eb0", "#4a90e2"],  # Blues
        "label": "Shadi",
    },
    "Mahmoud H": {
        "shades": ["#0e1117", "#2c1a3b", "#512a6f", "#7c3fa3", "#a854d4"],  # Purples
        "label": "Mahmoud H",
    },
    "Mahmoud K": {
        "shades": ["#0e1117", "#3c211a", "#703b2b", "#a4563d", "#d8714f"],  # Rusts
        "label": "Mahmoud K",
    },
    "Momen": {
        "shades": ["#0e1117", "#3c3c1a", "#70702b", "#a4a43d", "#d8d84f"],  # Yellows
        "label": "Momen",
    },
    "Vylor": {
        "shades": ["#0e1117", "#1a353c", "#2b6370", "#3da1a4", "#4fd8d2"],  # Cyans (AI)
        "label": "Vylor",
    },
}

DEFAULT_EMPTY_COLOR = "#161b22"


def get_color_for_activity(player, lines):
    """
    Returns the appropriate color shade matching the density of lines written.
    Implements the standard GitHub 4-tier activity brightness logic.
    """
    if lines <= 0:
        return DEFAULT_EMPTY_COLOR

    theme = PLAYER_THEMES.get(player)
    if not theme:
        return "#7f8c8d"  # Generic grey fallback

    shades = theme["shades"]
    if lines < 50:
        return shades[1]  # Light activity
    elif lines < 200:
        return shades[2]  # Moderate activity
    elif lines < 1000:
        return shades[3]  # High activity
    else:
        return shades[4]  # Legendary activity


def main():
    if not os.path.exists(DATA_INPUT_FILE):
        print(
            f"❌ Cannot find '{DATA_INPUT_FILE}'. Run 'python3 git_analyzer.py' first!"
        )
        return

    with open(DATA_INPUT_FILE, "r") as f:
        history = json.load(f)

    os.makedirs(TEMP_FRAME_DIR, exist_ok=True)
    # Clear old visual frames
    for f in os.listdir(TEMP_FRAME_DIR):
        if f.endswith(".png"):
            os.remove(os.path.join(TEMP_FRAME_DIR, f))

    print(f"📊 Rendering {len(history)} GitHub activity timelines...")

    # Set up date ranges
    dates = [datetime.strptime(step["date"], "%Y-%m-%d") for step in history]
    start_date = min(dates)
    end_date = max(dates)

    # Pad start_date back to the beginning of its week (Sunday)
    start_sunday = start_date - timedelta(days=(start_date.weekday() + 1) % 7)

    # Calculate how many weeks to render
    total_days = (end_date - start_sunday).days + 1
    total_weeks = (total_days + 6) // 7

    for idx, step in enumerate(history):
        current_date_limit = datetime.strptime(step["date"], "%Y-%m-%d")
        print(
            f"  🎬 Syncing Dashboard checkpoint {idx+1}/{len(history)} [{step['date']}]"
        )

        # Pull activity maps up to the active step date
        active_history = [
            s
            for s in history
            if datetime.strptime(s["date"], "%Y-%m-%d") <= current_date_limit
        ]

        # Store activity per day
        daily_activity = {}
        for s in active_history:
            d = datetime.strptime(s["date"], "%Y-%m-%d")
            daily_activity[d.date()] = s["scores"]

        # --- DRAWING THE GRID ---
        fig, ax = plt.subplots(figsize=(15, 6), dpi=150)
        fig.patch.set_facecolor("#0d1117")
        ax.set_facecolor("#0d1117")

        # Draw columns (weeks) and rows (days)
        for w in range(total_weeks):
            for d in range(7):
                cell_date = start_sunday + timedelta(weeks=w, days=d)

                # If the cell represents a future date relative to current animation frame, make it empty
                if cell_date > current_date_limit:
                    cell_color = DEFAULT_EMPTY_COLOR
                else:
                    day_scores = daily_activity.get(cell_date.date(), {})

                    if day_scores:
                        # Find the developer who was most active on this specific day
                        top_developer = max(day_scores, key=day_scores.get)
                        total_lines = day_scores[top_developer]
                        cell_color = get_color_for_activity(top_developer, total_lines)
                    else:
                        cell_color = DEFAULT_EMPTY_COLOR

                # Draw crisp rounded activity square
                rect = patches.FancyBboxPatch(
                    (w + 0.1, d + 0.1),
                    0.8,
                    0.8,
                    boxstyle="round,pad=0.05",
                    linewidth=0,
                    facecolor=cell_color,
                )
                ax.add_patch(rect)

        # Labels & Axis configuration
        ax.set_xlim(-1, total_weeks + 1)
        ax.set_ylim(-1, 8)
        ax.invert_yaxis()  # Sunday on top
        ax.axis("off")

        # Day of week labels on the left margin
        day_labels = ["Sun", "", "Tue", "", "Thu", "", "Sat"]
        for d, label in enumerate(day_labels):
            if label:
                ax.text(
                    -0.8,
                    d + 0.5,
                    label,
                    color="#8b949e",
                    fontsize=10,
                    va="center",
                    ha="right",
                )

        # Interactive Legend at the Bottom
        legend_start_x = 0
        for p_idx, (name, theme) in enumerate(PLAYER_THEMES.items()):
            # Represent each developer's active color spectrum next to their name
            col_x = legend_start_x + (p_idx * 2.5)
            ax.text(
                col_x,
                7.6,
                name,
                color="#ffffff",
                fontsize=10,
                fontweight="bold",
                va="center",
            )

            # Draw tiny swatch bars showing intensity colors
            for s_idx, shade in enumerate(theme["shades"][1:]):
                swatch = patches.Rectangle(
                    (col_x + (s_idx * 0.3) + 1.1, 7.4),
                    0.25,
                    0.25,
                    linewidth=0,
                    facecolor=shade,
                )
                ax.add_patch(swatch)

        # Dashboard Titles
        ax.text(
            0,
            -0.6,
            "VYLOR CODESPACE CONTRIBUTION CALENDAR",
            fontsize=18,
            fontweight="bold",
            color="#ffffff",
        )
        ax.text(
            0,
            -0.2,
            f"Active Timeline View: Starting {start_sunday.strftime('%B %Y')} — Present Date: {step['date']}",
            fontsize=11,
            color="#8b949e",
        )

        plt.savefig(
            f"{TEMP_FRAME_DIR}/frame_{idx:03d}.png",
            facecolor=fig.get_facecolor(),
            edgecolor="none",
            bbox_inches="tight",
        )
        plt.close(fig)

    print(
        f"\n🎨 Finished! Check your updated contribution timeline frames in '{TEMP_FRAME_DIR}/'"
    )


if __name__ == "__main__":
    main()
