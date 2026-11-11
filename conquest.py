import os
import subprocess
from collections import defaultdict
import matplotlib.pyplot as plt
import pandas as pd
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

# Configuration
REPOS = ["vylor", "vylor-web"]
OUTPUT_VIDEO = "vylor_conquest_history.mp4"
TEMP_FRAME_DIR = "conquest_frames"

# Alias cleanup (same as your leaderboard)
ALIASES = {
    "shadi mohamed": "Shadi",
    "momen rabie": "momen.rabie",
    "vylor": "Vylor",
    "Vylor AI": "Vylor",
}

# How many days to step forward in each video frame
# Decrease this for a smoother/longer video, increase it for a faster build.
TIME_STEP_DAYS = 14


def get_git_commits_by_date(repo_path):
    """
    Returns a list of tuples: (commit_hash, datetime_object)
    ordered from oldest to newest.
    """
    cmd = ["git", "log", "--reverse", "--format=%H|%ad", "--date=short"]
    result = subprocess.run(
        cmd, cwd=repo_path, stdout=subprocess.PIPE, text=True, check=True
    )
    commits = []
    for line in result.stdout.splitlines():
        if not line:
            continue
        h, d_str = line.split("|")
        date_obj = datetime.strptime(d_str, "%Y-%m-%d")
        commits.append((h, date_obj))
    return commits


def get_tracked_files_at_commit(repo_path, commit_hash):
    """
    Gets all tracked files in the repo at a specific historical commit.
    """
    try:
        cmd = ["git", "ls-tree", "-r", "--name-only", commit_hash]
        result = subprocess.run(cmd, cwd=repo_path, stdout=subprocess.PIPE, check=True)
        files_text = result.stdout.decode("utf-8", errors="ignore")
        return [f.strip() for f in files_text.splitlines() if f.strip()]
    except subprocess.CalledProcessError:
        return []


def blame_file_at_commit(repo_path, file_path, commit_hash):
    """
    Runs git blame on a specific file at a specific historical commit.
    """
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
                if not author:
                    author = "Unknown"
                # Resolve alias
                author = ALIASES.get(author, author)
                author_counts[author] += 1
    except subprocess.CalledProcessError:
        pass
    return author_counts


def get_ownership_at_commit(repo_path, commit_hash):
    """
    Finds the total line ownership of the codebase at a specific commit.
    """
    files = get_tracked_files_at_commit(repo_path, commit_hash)
    total_scores = defaultdict(int)

    # Run in parallel to speed up the git blame processes
    with ThreadPoolExecutor() as executor:
        futures = [
            executor.submit(blame_file_at_commit, repo_path, f, commit_hash)
            for f in files
        ]
        for future in futures:
            file_scores = future.result()
            for author, count in file_scores.items():
                total_scores[author] += count

    return total_scores


def main():
    os.makedirs(TEMP_FRAME_DIR, exist_ok=True)

    # 1. Map out chronological history
    print("⏳ Analyzing Git timelines...")
    repo_commits = {}
    all_dates = []

    for repo in REPOS:
        path = os.path.abspath(repo)
        if os.path.exists(path):
            commits = get_git_commits_by_date(path)
            repo_commits[repo] = commits
            all_dates.extend([c[1] for c in commits])

    if not all_dates:
        print("❌ No git history found.")
        return

    start_date = min(all_dates)
    end_date = max(all_dates)

    # Generate time steps
    current_date = start_date
    date_steps = []
    while current_date <= end_date:
        date_steps.append(current_date)
        current_date = current_date + pd.Timedelta(days=TIME_STEP_DAYS)
    # Ensure we include the final day
    if date_steps[-1] != end_date:
        date_steps.append(end_date)

    print(
        f"🗺️  Timeline mapped: {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}"
    )
    print(f"🎬 Generating {len(date_steps)} frames of video...")

    # 2. Extract ownership data for each time step
    history_data = []  # List of dicts

    for idx, target_date in enumerate(date_steps):
        print(
            f"  └─ Frame {idx+1}/{len(date_steps)}: Analyzing state on {target_date.strftime('%Y-%m-%d')}..."
        )
        step_scores = defaultdict(int)

        # For each repository, find the closest commit *before or at* target_date
        for repo in REPOS:
            path = os.path.abspath(repo)
            if not os.path.exists(path):
                continue

            commits = repo_commits[repo]
            # Find closest commit
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

        # Record the data
        step_scores["Date"] = target_date
        history_data.append(step_scores)

    # 3. Process into a Pandas DataFrame
    df = pd.DataFrame(history_data)
    df.set_index("Date", inplace=True)
    df.fillna(0, inplace=True)

    # Clean up low-contribution/bot noise to make the chart readable
    # Keep only contributors who reached at least 500 lines at some point
    significant_cols = [col for col in df.columns if df[col].max() >= 500]
    other_cols = [col for col in df.columns if df[col].max() < 500]

    if other_cols:
        df["Others"] = df[other_cols].sum(axis=1)
        significant_cols.append("Others")

    df = df[significant_cols]

    # Sort columns so the biggest conqueror is on top of the stack
    sorted_cols = df.sum().sort_values(ascending=False).index.tolist()
    df = df[sorted_cols]

    # 4. Generate Images (Frames)
    print("🎨 Rendering frames...")
    # Clean up previous frames to prevent leakage
    for f in os.listdir(TEMP_FRAME_DIR):
        os.remove(os.path.join(TEMP_FRAME_DIR, f))

    for i, date in enumerate(df.index):
        fig, ax = plt.subplots(figsize=(12, 7), dpi=100)

        # Get data up to current index
        sub_df = df.iloc[: i + 1]

        # Color palette
        colors = plt.cm.get_cmap("tab20", len(df.columns))

        # Stacked Area Plot
        ax.stackplot(
            sub_df.index,
            [sub_df[col] for col in df.columns],
            labels=df.columns,
            colors=[colors(c) for c in range(len(df.columns))],
            alpha=0.85,
        )

        # Styling the "Conquest" map
        ax.set_title(
            f"THE GREAT VYLOR CONQUEST\nState on: {date.strftime('%Y-%m-%d')}",
            fontsize=16,
            fontweight="bold",
            pad=20,
        )
        ax.set_ylabel("Total Active Lines of Code", fontsize=12)
        ax.set_xlabel("Timeline", fontsize=12)
        ax.grid(True, linestyle="--", alpha=0.3)

        # Lock limits so it is smooth and doesn't bounce violently
        ax.set_xlim(df.index[0], df.index[-1])
        ax.set_ylim(0, df.sum(axis=1).max() * 1.05)

        # Dynamic, moving legend
        ax.legend(loc="upper left", frameon=True, facecolor="white", edgecolor="none")

        # Format dates nicely on X-axis
        fig.autofmt_xdate()

        # Save frame
        plt.savefig(f"{TEMP_FRAME_DIR}/frame_{i:04d}.png", bbox_inches="tight")
        plt.close(fig)

    # 5. Compile Video using FFmpeg
    print("🎬 Compiling MP4 Video via FFmpeg...")
    try:
        # We target a slow, dramatic frame-rate (e.g., 5 frames per second)
        ffmpeg_cmd = [
            "ffmpeg",
            "-y",
            "-r",
            "5",
            "-i",
            f"{TEMP_FRAME_DIR}/frame_%04d.png",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            OUTPUT_VIDEO,
        ]
        subprocess.run(ffmpeg_cmd, check=True)
        print(f"🎉 SUCCESS! Video compiled perfectly to: {OUTPUT_VIDEO}")
    except subprocess.CalledProcessError:
        print(
            "❌ Failed to compile video using FFmpeg. Are you sure FFmpeg is installed and in your PATH?"
        )
        print(
            "💡 You can still find all the generated frame images inside the 'conquest_frames' folder!"
        )


if __name__ == "__main__":
    main()
