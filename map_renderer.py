import os
import json
import numpy as np
import matplotlib

matplotlib.use("Agg")  # Thread-safe, non-interactive backend
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.offsetbox import OffsetImage, AnnotationBbox
from PIL import Image
from datetime import datetime, timedelta
from matplotlib import font_manager
from concurrent.futures import ProcessPoolExecutor

# --- CONFIGURATION ---
DATA_INPUT_FILE = ".vylor_artifacts/vylor_empire_history.json"
TEMP_FRAME_DIR = "vylor_map_frames"
AVATARS_DIR = ".vylor/avatars"
LINES_PER_BLOCK = 100
MAX_GRID_SIZE = 35
MAX_RENDER_WORKERS = (
    64  # Matplotlib is heavy; 8 parallel processes balances speed and memory
)

# --- FONT CONFIGURATION (INTER) ---
font_reg = font_manager.FontProperties()
font_bold = font_manager.FontProperties()

if os.path.exists("Inter-Regular.ttf"):
    font_manager.fontManager.addfont("Inter-Regular.ttf")
    font_reg = font_manager.FontProperties(fname="Inter-Regular.ttf", weight="normal")
if os.path.exists("Inter-Bold.ttf"):
    font_manager.fontManager.addfont("Inter-Bold.ttf")
    font_bold = font_manager.FontProperties(fname="Inter-Bold.ttf", weight="bold")
else:
    font_bold = font_manager.FontProperties(weight="bold")

plt.rcParams["font.family"] = "sans-serif"
plt.rcParams["font.sans-serif"] = ["Inter", "Helvetica", "Arial", "DejaVu Sans"]

PLAYER_PROFILES = {
    "Abdelrahman": {"color": "#3498db", "id": 1},
    "Ahmad": {"color": "#2980b9", "id": 2},
    "Ahmed R.": {"color": "#e67e22", "id": 3},
    "Hazem": {"color": "#9b59b6", "id": 4},
    "Julius": {"color": "#8e44ad", "id": 5},
    "Mahmoud H": {"color": "#e74c3c", "id": 6},
    "Mahmoud K": {"color": "#c0392b", "id": 7},
    "Shadi": {"color": "#f1c40f", "id": 8},
    "Momen": {"color": "#e84393", "id": 9},
    "Mohamed S": {"color": "#fd79a8", "id": 10},
    "CI": {"color": "#7f8c8d", "id": 11},
    "Vylor": {"color": "#245340", "id": 12},
    "Others": {"color": "#5c646d", "id": 13},
}

ID_TO_COLOR = {p["id"]: p["color"] for p in PLAYER_PROFILES.values()}
ID_TO_COLOR[0] = "#0d1117"


def load_player_avatar(player_name, size=120):
    safe_name = player_name.replace(" ", "_").replace(".", "")
    avatar_path = os.path.join(AVATARS_DIR, f"{safe_name}.png")
    if not os.path.exists(avatar_path):
        avatar_path = os.path.join(AVATARS_DIR, "Others.png")
    if not os.path.exists(avatar_path):
        return Image.new("RGBA", (size, size), (0, 0, 0, 0))
    try:
        return Image.open(avatar_path).convert("RGBA").resize((size, size))
    except Exception:
        return Image.new("RGBA", (size, size), (0, 0, 0, 0))


def build_clustered_map(scores, max_grid_size):
    block_allocations = []
    for player, lines in scores.items():
        profile = PLAYER_PROFILES.get(player, PLAYER_PROFILES["Others"])
        num_blocks = int(lines // LINES_PER_BLOCK)
        block_allocations.append((profile["id"], num_blocks))

    block_allocations = sorted(block_allocations, key=lambda x: x[1], reverse=True)
    grid = np.zeros((max_grid_size, max_grid_size), dtype=int)
    center = max_grid_size // 2

    player_seeds = {
        1: (center - 12, center - 12),
        2: (center - 12, center + 12),
        3: (center + 12, center - 12),
        4: (center + 12, center + 12),
        5: (center - 6, center - 12),
        6: (center - 12, center - 6),
        7: (center + 12, center + 6),
        8: (center + 6, center + 12),
        9: (center - 6, center + 12),
        10: (center + 12, center - 6),
        11: (center - 12, center + 6),
        12: (center, center),
        13: (center + 6, center - 12),
    }

    for player_id, num_blocks in block_allocations:
        if num_blocks <= 0:
            continue
        seed_y, seed_x = player_seeds.get(player_id, (center, center))
        queue = [(seed_y, seed_x)]
        visited = set()
        blocks_placed = 0

        while queue and blocks_placed < num_blocks:
            y, x = queue.pop(0)
            if 0 <= y < max_grid_size and 0 <= x < max_grid_size:
                if grid[y, x] == 0:
                    grid[y, x] = player_id
                    blocks_placed += 1
                for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                    ny, nx = y + dy, x + dx
                    if (ny, nx) not in visited:
                        visited.add((ny, nx))
                        queue.append((ny, nx))
    return grid


# --- ISOLATED RENDERING WITH PERSISTENT FILE-EXISTS CHECK ---
def render_single_frame(task_args):
    idx, step, baseline_monthly_loc, text_metrics = task_args
    output_path = os.path.join(TEMP_FRAME_DIR, f"frame_{idx:04d}.png")

    # Stateful Lock Check: Skip entirely if this exact frame is already rendered!
    if os.path.exists(output_path):
        return

    date_str = step["date"]
    scores = step["scores"]
    total_lines_now = sum(scores.values())

    cached_velocity_text = text_metrics["velocity_text"]
    cached_velocity_color = text_metrics["velocity_color"]
    cached_multiplier_text = text_metrics["multiplier_text"]
    cached_multiplier_color = text_metrics["multiplier_color"]

    grid = build_clustered_map(scores, MAX_GRID_SIZE)

    fig, ax = plt.subplots(figsize=(16, 12), dpi=150)
    fig.patch.set_facecolor("#0d1117")
    ax.set_facecolor("#0d1117")

    for r in range(MAX_GRID_SIZE):
        for c in range(MAX_GRID_SIZE):
            val = grid[r, c]
            if val > 0:
                rect = patches.Rectangle(
                    (c - 0.45, r - 0.45),
                    0.9,
                    0.9,
                    linewidth=0.1,
                    edgecolor="#161b22",
                    facecolor=ID_TO_COLOR[val],
                )
                ax.add_patch(rect)

    avatar_cache = {name: load_player_avatar(name) for name in PLAYER_PROFILES.keys()}
    for name, profile in PLAYER_PROFILES.items():
        player_id = profile["id"]
        y_indices, x_indices = np.where(grid == player_id)
        if len(y_indices) > 0:
            center_y, center_x = np.mean(y_indices), np.mean(x_indices)
            avatar_img = avatar_cache.get(name)
            if avatar_img:
                imagebox = OffsetImage(avatar_img, zoom=0.32)
                ax.add_artist(
                    AnnotationBbox(imagebox, (center_x, center_y), frameon=False)
                )
                ax.text(
                    center_x,
                    center_y - 1.8,
                    name,
                    color="#ffffff",
                    fontsize=8,
                    fontproperties=font_bold,
                    ha="center",
                    va="center",
                    bbox=dict(
                        boxstyle="round,pad=0.25",
                        facecolor="#0d1117",
                        alpha=0.9,
                        edgecolor="none",
                    ),
                )

    sidebar_bg = patches.Rectangle(
        (-17.5, -0.5), 16.0, MAX_GRID_SIZE, linewidth=0, facecolor="#161b22", alpha=0.5
    )
    ax.add_patch(sidebar_bg)

    ax.text(
        -16.0,
        3.0,
        "VYLOR CONQUEST",
        fontsize=22,
        fontproperties=font_bold,
        color="#ffffff",
    )
    ax.text(
        -16.0,
        4.8,
        f"DATE: {date_str}",
        fontsize=11,
        fontproperties=font_reg,
        color="#8b949e",
    )
    ax.text(
        -16.0,
        6.2,
        f"TOTAL EMPIRE: {total_lines_now:,} LoC",
        fontsize=11,
        fontproperties=font_bold,
        color="#ffffff",
    )

    ax.text(
        -16.0,
        7.4,
        cached_velocity_text,
        fontsize=11,
        fontproperties=font_bold,
        color=cached_velocity_color,
    )
    ax.text(
        -16.0,
        8.6,
        cached_multiplier_text,
        fontsize=9,
        fontproperties=font_bold,
        color=cached_multiplier_color,
    )

    ax.plot([-16.0, -2.0], [9.6, 9.6], color="#30363d", linewidth=1.5)
    ax.text(
        -16.0,
        11.2,
        "EMPIRE RANKINGS",
        fontsize=14,
        fontproperties=font_bold,
        color="#8b949e",
    )

    ranked_players = []
    for name, lines in scores.items():
        if name in PLAYER_PROFILES and lines > 0:
            pct_now = (lines / total_lines_now * 100) if total_lines_now > 0 else 0
            share_shift = text_metrics.get(f"share_{name}", 0.0)
            abs_delta = text_metrics.get(f"delta_{name}", 0)
            ranked_players.append((name, lines, pct_now, share_shift, abs_delta))

    ranked_players = sorted(ranked_players, key=lambda x: x[1], reverse=True)

    start_y, row_height = 13.5, 2.8
    for rank, (name, lines, pct, share_shift, abs_delta) in enumerate(ranked_players):
        current_y = start_y + (rank * row_height)
        if current_y > MAX_GRID_SIZE - 2:
            break

        profile = PLAYER_PROFILES[name]
        avatar_img = avatar_cache.get(name)
        if avatar_img:
            ax.add_artist(
                AnnotationBbox(
                    OffsetImage(avatar_img, zoom=0.22),
                    (-15.0, current_y),
                    frameon=False,
                )
            )

        ax.text(
            -16.8,
            current_y,
            f"#{rank + 1}",
            color="#8b949e",
            fontsize=11,
            fontproperties=font_bold,
            va="center",
            ha="right",
        )
        ax.text(
            -13.4,
            current_y - 0.4,
            name,
            color=profile["color"],
            fontsize=12,
            fontproperties=font_bold,
            va="center",
        )
        ax.text(
            -13.4,
            current_y + 0.6,
            f"{lines:,} LoC  ({pct:.1f}%)",
            color="#8b949e",
            fontsize=10,
            fontproperties=font_reg,
            va="center",
        )

        if share_shift > 0.1:
            shift_str, shift_color = f"+{share_shift:.1f}% share", "#2ed573"
        elif share_shift < -0.1:
            shift_str, shift_color = (
                f"{share_shift:.1f}% (Refactored)"
                if abs_delta < -50
                else f"{share_shift:.1f}% share"
            ), ("#e67e22" if abs_delta < -50 else "#ff4757")
        else:
            shift_str, shift_color = "Stable", "#8b949e"

        ax.text(
            -2.5,
            current_y + 0.6,
            shift_str,
            color=shift_color,
            fontsize=9,
            fontproperties=font_bold,
            va="center",
            ha="right",
        )

    ax.set_xlim(-18, MAX_GRID_SIZE)
    ax.set_ylim(-1, MAX_GRID_SIZE)
    ax.invert_yaxis()
    ax.axis("off")

    plt.savefig(
        output_path,
        facecolor=fig.get_facecolor(),
        edgecolor="none",
        bbox_inches="tight",
    )
    plt.close(fig)

    if idx % 100 == 0:
        print(f" 🎬 Frame Pipeline: Rendered frame_{idx:04d}.png successfully.")


def main():
    if not os.path.exists(DATA_INPUT_FILE):
        print(f"❌ Cannot find '{DATA_INPUT_FILE}'.")
        return

    with open(DATA_INPUT_FILE, "r") as f:
        history = json.load(f)

    history = sorted(history, key=lambda x: x["date"])

    print("⏳ Running pre-calculations for historical baseline...")
    baseline_monthly_loc = 6071.0
    jan_start, june_pivot = None, None

    for step in history:
        dt = datetime.strptime(step["date"], "%Y-%m-%d %H:%M")
        if dt <= datetime(2026, 1, 1):
            jan_start = step
        if dt <= datetime(2026, 6, 15):
            june_pivot = step

    if jan_start and june_pivot:
        jan_dt = datetime.strptime(jan_start["date"], "%Y-%m-%d %H:%M")
        pivot_dt = datetime.strptime(june_pivot["date"], "%Y-%m-%d %H:%M")
        baseline_days = (pivot_dt - jan_dt).days
        if baseline_days > 0:
            baseline_monthly_loc = (
                (sum(june_pivot["scores"].values()) - sum(jan_start["scores"].values()))
                / baseline_days
            ) * 30.0

    os.makedirs(TEMP_FRAME_DIR, exist_ok=True)
    # Wiping line removed! It will now only add missing frames.

    print("📊 Pre-compiling decoupled WoW HUD sequences...")
    task_packages = []

    cached_metrics = {
        "velocity_text": "VELOCITY: +0.0% >>",
        "velocity_color": "#8b949e",
        "multiplier_text": "VYLOR STATE: [DORMANT]",
        "multiplier_color": "#8b949e",
    }
    last_hud_update_time = None

    for idx, step in enumerate(history):
        current_dt = datetime.strptime(step["date"], "%Y-%m-%d %H:%M")
        total_lines_now = sum(step["scores"].values())

        if (
            last_hud_update_time is None
            or (current_dt - last_hud_update_time).days >= 7
        ):
            last_hud_update_time = current_dt
            thirty_days_ago = current_dt - timedelta(days=30)
            step_30d_ago = history[0]
            for sb in history:
                if datetime.strptime(sb["date"], "%Y-%m-%d %H:%M") <= thirty_days_ago:
                    step_30d_ago = sb
                else:
                    break

            total_30d_ago = sum(step_30d_ago["scores"].values())
            pct_accel = (
                ((total_lines_now - total_30d_ago) - baseline_monthly_loc)
                / baseline_monthly_loc
            ) * 100

            cached_metrics["velocity_text"] = (
                f"VELOCITY: +{pct_accel:.1f}% >>"
                if pct_accel >= 0
                else f"VELOCITY: {max(pct_accel, -100.0):.1f}%"
            )
            cached_metrics["velocity_color"] = (
                "#2ed573" if pct_accel >= 0 else "#8b949e"
            )

            vylor_output = max(
                step["scores"].get("Vylor", 0) - step_30d_ago["scores"].get("Vylor", 0),
                0,
            )
            vylor_mult = vylor_output / baseline_monthly_loc
            if current_dt >= datetime(2026, 6, 12) and vylor_mult > 0.1:
                cached_metrics["multiplier_text"] = (
                    f"VYLOR OUTPUT: {vylor_mult:.1f}x ENTIRE TEAM COMBINED //"
                )
                cached_metrics["multiplier_color"] = "#2ed573"
            else:
                cached_metrics["multiplier_text"] = "VYLOR STATE: [DORMANT]"
                cached_metrics["multiplier_color"] = "#8b949e"

            for name, lines in step["scores"].items():
                pct_now = (lines / total_lines_now * 100) if total_lines_now > 0 else 0
                lines_30d = step_30d_ago["scores"].get(name, 0)
                cached_metrics[f"share_{name}"] = pct_now - (
                    (lines_30d / total_30d_ago * 100) if total_30d_ago > 0 else 0
                )
                cached_metrics[f"delta_{name}"] = lines - lines_30d

        task_packages.append((idx, step, baseline_monthly_loc, cached_metrics.copy()))

    print(
        f"🎨 Deploying Process Engine across {MAX_RENDER_WORKERS} isolated CPU cores..."
    )
    with ProcessPoolExecutor(max_workers=MAX_RENDER_WORKERS) as executor:
        executor.map(render_single_frame, task_packages)

    print(f"\n🏆 Success! Stateful parallel render completed.")


if __name__ == "__main__":
    main()
