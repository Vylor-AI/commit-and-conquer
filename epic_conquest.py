import os
import subprocess
from collections import defaultdict
import numpy as np
import matplotlib.pyplot as plt
import pandas as pd
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor

# --- CONFIGURATION ---
REPOS = ["vylor", "vylor-web"]
TEMP_FRAME_DIR = "vylor_map_frames"

DAYS_TO_LOOK_BACK = 30
TIME_STEP_DAYS = 5
LINES_PER_BLOCK = 100  # 1 Block represents 250 lines of code

# Estimate Max Grid Size based on projected 90,000 lines
# 90,000 LoC / 250 = ~360 blocks. A 23x23 grid provides plenty of expansion space.
MAX_GRID_SIZE = 40


# Player Profiles: Configured with clear Initials and High-Contrast Game Colors
PLAYER_PROFILES = {
    "Ahmad Baraka": {"color": "#1e90ff", "initials": "AB", "id": 1},  # Royal Blue
    "Shadi": {"color": "#ab2ed5", "initials": "SH", "id": 2},  # Emerald Green
    "Mahmoud Hammam": {
        "color": "#9b59b6",
        "initials": "MH",
        "id": 3,
    },  # Amethyst Purple
    "momen.rabie": {"color": "#ff7f50", "initials": "MR", "id": 4},  # Coral Orange
    "Vylor": {"color": "#097422", "initials": "VY", "id": 5},  # Cyber Cyan (AI)
    "Vylor Staging": {"color": "#097422", "initials": "VS", "id": 6},  # Dark Slate
    "Others": {"color": "#7f8c8d", "initials": "??", "id": 7},  # Grey
}

ID_TO_COLOR = {p["id"]: p["color"] for p in PLAYER_PROFILES.values()}
ID_TO_COLOR[0] = "#0d1117"  # Void

ALIASES = {
    "shadi mohamed": "Shadi",
    "momen rabie": "momen.rabie",
    "vylor": "Vylor",
    "Vylor AI": "Vylor",
}


def get_git_commits_by_date(repo_path):
    since_date = (datetime.now() - timedelta(days=DAYS_TO_LOOK_BACK)).strftime(
        "%Y-%m-%d"
    )
    cmd = [
        "git",
        "log",
        "--reverse",
        f"--since={since_date}",
        "--format=%H|%ad",
        "--date=short",
    ]
    result = subprocess.run(
        cmd, cwd=repo_path, stdout=subprocess.PIPE, text=True, check=True
    )
    commits = []
    for line in result.stdout.splitlines():
        if not line:
            continue
        h, d_str = line.split("|")
        commits.append((h, datetime.strptime(d_str, "%Y-%m-%d")))
    return commits


def get_tracked_files_at_commit(repo_path, commit_hash):
    try:
        cmd = ["git", "ls-tree", "-r", "--name-only", commit_hash]
        result = subprocess.run(cmd, cwd=repo_path, stdout=subprocess.PIPE, check=True)
        files_text = result.stdout.decode("utf-8", errors="ignore")

        valid_extensions = (
            ".py",
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".html",
            ".css",
            ".json",
        )
        files = []
        for f in files_text.splitlines():
            f = f.strip()
            if (
                f.endswith(valid_extensions)
                and "package-lock" not in f
                and "yarn.lock" not in f
            ):
                files.append(f)
        return files
    except subprocess.CalledProcessError:
        return []


def blame_file_at_commit(repo_path, file_path, commit_hash):
    author_counts = defaultdict(int)
    try:
        cmd = ["git", "blame", "--line-porcelain", commit_hash, "--", file_path]
        result = subprocess.run(
            cmd,
            cwd=repo_path,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=True,
        )
        output_text = result.stdout.decode("utf-8", errors="ignore")

        for line in output_text.splitlines():
            if line.startswith("author "):
                author = line[7:].strip()
                author = ALIASES.get(author, author)
                author_counts[author] += 1
    except subprocess.CalledProcessError:
        pass
    return author_counts


def get_ownership_at_commit(repo_path, commit_hash):
    files = get_tracked_files_at_commit(repo_path, commit_hash)
    total_scores = defaultdict(int)

    with ThreadPoolExecutor(max_workers=16) as executor:
        futures = [
            executor.submit(blame_file_at_commit, repo_path, f, commit_hash)
            for f in files
        ]
        for future in futures:
            file_scores = future.result()
            for author, count in file_scores.items():
                total_scores[author] += count

    return total_scores


def build_clustered_map(scores, max_grid_size):
    """
    Renders the territories clustered together growing from the center outward.
    """
    block_allocations = []
    for player, lines in scores.items():
        resolved_player = player if player in PLAYER_PROFILES else "Others"
        profile = PLAYER_PROFILES[resolved_player]

        num_blocks = int(lines // LINES_PER_BLOCK)
        block_allocations.append((profile["id"], num_blocks))

    # Sort so that larger domains spawn from their starting territories first
    block_allocations = sorted(block_allocations, key=lambda x: x[1], reverse=True)

    # Initialize the maximum map size grid
    grid = np.zeros((max_grid_size, max_grid_size), dtype=int)
    center = max_grid_size // 2

    # Define distinct seed coordinates (capitals) for each player to anchor their land masses
    player_seeds = {
        1: (center - 2, center - 2),  # Ahmad: Northwest
        2: (center + 2, center + 2),  # Shadi: Southeast
        3: (center - 2, center + 2),  # Mahmoud: Northeast
        4: (center + 2, center - 2),  # Momen: Southwest
        5: (center, center),  # Vylor: Deep Center
        6: (center + 1, center),  # Staging
        7: (center - 1, center),  # Others
    }

    for player_id, num_blocks in block_allocations:
        if num_blocks <= 0:
            continue

        # Start at seed capital
        seed_y, seed_x = player_seeds.get(player_id, (center, center))

        # Grow territory outward from seed using a simple cellular propagation search
        queue = [(seed_y, seed_x)]
        visited = set()
        blocks_placed = 0

        while queue and blocks_placed < num_blocks:
            y, x = queue.pop(0)

            # Bound safety check
            if 0 <= y < max_grid_size and 0 <= x < max_grid_size:
                if grid[y, x] == 0:  # Grab unclaimed land
                    grid[y, x] = player_id
                    blocks_placed += 1
                elif grid[y, x] == player_id:
                    pass  # Already ours
                else:
                    # Encroachment boundary (overwriting/eating neighboring code lines)
                    # For a simple game look, we skip occupied spots unless we're searching neighbors
                    pass

                # Add adjacent spots to expansion queue
                for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                    ny, nx = y + dy, x + dx
                    if (ny, nx) not in visited:
                        visited.add((ny, nx))
                        queue.append((ny, nx))

    return grid


def main():
    os.makedirs(TEMP_FRAME_DIR, exist_ok=True)

    # Clean previous runs
    for f in os.listdir(TEMP_FRAME_DIR):
        if f.endswith(".png"):
            os.remove(os.path.join(TEMP_FRAME_DIR, f))

    print("⏳ Scanning history...")
    repo_commits = {}
    all_dates = []

    for repo in REPOS:
        path = os.path.abspath(repo)
        if os.path.exists(path):
            commits = get_git_commits_by_date(path)
            repo_commits[repo] = commits
            all_dates.extend([c[1] for c in commits])

    if not all_dates:
        print("❌ No commits found in the last 30 days.")
        return

    start_date = min(all_dates)
    end_date = max(all_dates)

    date_steps = []
    current_date = start_date
    while current_date <= end_date:
        date_steps.append(current_date)
        current_date += timedelta(days=TIME_STEP_DAYS)

    print(f"🗺️  Starting Map Conquest: {len(date_steps)} checkpoints.")

    for idx, target_date in enumerate(date_steps):
        print(
            f"  🎬 Rendering Day {idx+1}/{len(date_steps)} [{target_date.strftime('%Y-%m-%d')}]"
        )
        step_scores = defaultdict(int)

        for repo in REPOS:
            path = os.path.abspath(repo)
            if not os.path.exists(path):
                continue

            commits = repo_commits[repo]
            best_commit = None
            for commit_hash, commit_date in commits:
                if commit_date <= target_date:
                    best_commit = commit_hash
                else:
                    break

            if best_commit:
                repo_scores = get_ownership_at_commit(path, best_commit)
                for author, count in repo_scores.items():
                    step_scores[author] += count

        total_lines_now = sum(step_scores.values())
        grid = build_clustered_map(step_scores, MAX_GRID_SIZE)

        # --- PLOTTING ---
        plt.style.use("dark_background")
        fig, ax = plt.subplots(figsize=(10, 10), dpi=100)
        fig.patch.set_facecolor("#0d1117")
        ax.set_facecolor("#0d1117")

        # Color matrix matching
        cmap_colors = [ID_TO_COLOR[i] for i in sorted(ID_TO_COLOR.keys())]
        from matplotlib.colors import ListedColormap

        custom_cmap = ListedColormap(cmap_colors)

        # Display Grid Map
        ax.imshow(
            grid,
            cmap=custom_cmap,
            vmin=0,
            vmax=len(ID_TO_COLOR) - 1,
            interpolation="nearest",
        )

        # Beautiful clean grid overlay
        ax.set_xticks(np.arange(-0.5, grid.shape[1], 1), minor=True)
        ax.set_yticks(np.arange(-0.5, grid.shape[0], 1), minor=True)
        ax.grid(which="minor", color="#161b22", linestyle="-", linewidth=0.1)

        ax.set_xticks([])
        ax.set_yticks([])

        # Overlay territory initials dynamically directly onto the centers of major lands
        for player, profile in PLAYER_PROFILES.items():
            player_id = profile["id"]
            y_indices, x_indices = np.where(grid == player_id)

            # Only draw label if they actually own land in this checkpoint frame
            if len(y_indices) > 0:
                # Find the geographic center of their territory mass
                center_y = int(np.mean(y_indices))
                center_x = int(np.mean(x_indices))

                # Render Initials inside their capital block area
                ax.text(
                    center_x,
                    center_y,
                    profile["initials"],
                    color="#ffffff",
                    fontsize=14,
                    fontweight="extra bold",
                    ha="center",
                    va="center",
                    bbox=dict(
                        boxstyle="round,pad=0.2",
                        facecolor="#000000",
                        alpha=0.6,
                        edgecolor="none",
                    ),
                )

        # Frame Labels
        ax.text(
            0.02,
            0.95,
            f"VYLOR EMPIRE CONQUEST\n{target_date.strftime('%Y-%m-%d')}",
            fontsize=16,
            fontweight="bold",
            color="#ffffff",
            transform=ax.transAxes,
        )
        ax.text(
            0.02,
            0.88,
            f"Conquered Realm: {total_lines_now:,} LoC",
            fontsize=12,
            color="#58a6ff",
            transform=ax.transAxes,
        )

        plt.savefig(
            f"{TEMP_FRAME_DIR}/day_{idx:03d}.png",
            facecolor=fig.get_facecolor(),
            edgecolor="none",
            bbox_inches="tight",
        )
        plt.close(fig)

    print(
        f"\n🗺️  Map rendering complete! Check '{TEMP_FRAME_DIR}/' to watch your territories take shape!"
    )


if __name__ == "__main__":
    main()
