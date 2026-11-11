import os
import subprocess
import json
from collections import defaultdict
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor

# --- CONFIGURATION CONSTANTS ---
REPOS = ["vylor", "vylor-web"]
DAYS_TO_LOOK_BACK = 10000
TIME_STEP_DAYS = 0.25  # 6-Hour checkpoints
DATA_OUTPUT_FILE = "vylor_empire_history.json"
CACHE_DIR = ".vylor_git_cache"

# --- 2D THREADING SETTINGS ---
OUTER_MAX_WORKERS = 4  # Number of checkpoints to process in parallel
INNER_MAX_WORKERS = 64  # Number of files to blame in parallel per checkpoint

# --- FILE FILTERING ---
VALID_EXTENSIONS = (
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".html",
    ".css",
    ".json",
)
EXCLUDED_SUBSTRINGS = ("package-lock", "yarn.lock")

# --- AUTHOR NORMALIZATION ---
NAME_MAPPING = {
    "shadi": "Shadi",
    "shadi mohamed": "Shadi",
    "momen.rabie": "Momen",
    "momen rabie": "Momen",
    "vylor": "Vylor",
    "vylor staging": "Vylor",
    "vylor ai": "Vylor",
    "ahmad baraka": "Ahmad",
    "ahmad": "Ahmad",
    "mahmoud hammam": "Mahmoud H",
    "mahmoud h": "Mahmoud H",
    "mahmoud k": "Mahmoud K",
    "mahmoud khaled": "Mahmoud K",
}


def clean_name(raw_name):
    lowered = raw_name.lower().strip()
    return NAME_MAPPING.get(lowered, raw_name.split()[0].capitalize())


def get_git_commits_by_date(repo_path):
    since_date = (datetime.now() - timedelta(days=DAYS_TO_LOOK_BACK)).strftime(
        "%Y-%m-%d"
    )
    cmd = ["git", "log", "--reverse", f"--since={since_date}", "--format=%H|%cI"]
    result = subprocess.run(
        cmd, cwd=repo_path, stdout=subprocess.PIPE, text=True, check=True
    )
    commits = []
    for line in result.stdout.splitlines():
        if not line:
            continue
        h, d_str = line.split("|")
        try:
            dt = datetime.fromisoformat(d_str).replace(tzinfo=None)
            commits.append((h, dt))
        except ValueError:
            dt = datetime.strptime(d_str[:19], "%Y-%m-%dT%H:%M:%S")
            commits.append((h, dt))
    return commits


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
                cleaned = clean_name(line[7:].strip())
                author_counts[cleaned] += 1
    except subprocess.CalledProcessError:
        raise
    return author_counts


# --- PROCESSING SINGLE CHECKPOINT (OUTER THREAD DIMENSION) ---
def process_single_checkpoint(args):
    idx, target_date, repo_commits = args
    date_str = target_date.strftime("%Y-%m-%d %H:%M")
    cache_file = os.path.join(CACHE_DIR, f"checkpoint_{idx:04d}.json")

    # Skip if file already exists in cache folder
    if os.path.exists(cache_file):
        return

    # print(f" 🚀 Processing Checkpoint {idx+1} [{date_str}]")
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
            cmd = ["git", "ls-tree", "-r", "--name-only", best_commit]
            try:
                res = subprocess.run(cmd, cwd=path, stdout=subprocess.PIPE, check=True)
                files_text = res.stdout.decode("utf-8", errors="ignore")

                # Gather eligible files
                target_files = []
                for f in files_text.splitlines():
                    f = f.strip()
                    if f.endswith(VALID_EXTENSIONS) and not any(
                        exclude in f for exclude in EXCLUDED_SUBSTRINGS
                    ):
                        target_files.append(f)

                # --- INNER THREAD DIMENSION: Blame files in parallel ---
                with ThreadPoolExecutor(
                    max_workers=INNER_MAX_WORKERS
                ) as inner_executor:
                    futures = [
                        inner_executor.submit(
                            blame_file_at_commit, path, f, best_commit
                        )
                        for f in target_files
                    ]

                    for future in futures:
                        file_scores = future.result()
                        for author, count in file_scores.items():
                            step_scores[author] += count

            except subprocess.CalledProcessError:
                raise

    # Save to disk immediately
    entry = {"date": date_str, "scores": dict(step_scores)}
    with open(cache_file, "w") as f:
        json.dump(entry, f, indent=2)


def main():
    print("⏳ Initializing parallel 2D slice engine...")
    os.makedirs(CACHE_DIR, exist_ok=True)

    repo_commits = {}
    all_dates = []

    for repo in REPOS:
        path = os.path.abspath(repo)
        if os.path.exists(path):
            commits = get_git_commits_by_date(path)
            repo_commits[repo] = commits
            all_dates.extend([c[1] for c in commits])

    if not all_dates:
        print("❌ No repositories found.")
        return

    # Build full checklist of datetimes
    start_date, end_date = min(all_dates), max(all_dates)
    date_steps = []
    current_date = start_date
    while current_date <= end_date:
        date_steps.append(current_date)
        current_date += timedelta(days=TIME_STEP_DAYS)

    print(f"📦 Total slices to analyze: {len(date_steps)}")

    # Map parameters to tuple structure for thread mapping
    tasks = [
        (idx, target_date, repo_commits) for idx, target_date in enumerate(date_steps)
    ]

    # Fire workers across the outer checkpoints
    with ThreadPoolExecutor(max_workers=OUTER_MAX_WORKERS) as outer_executor:
        outer_executor.map(process_single_checkpoint, tasks)

    # --- COMPILE CACHED ENTRIES INTO MASTER ---
    print("\n📦 Combining cache files into master timeline file...")
    compiled_history = []
    for idx in range(len(date_steps)):
        cache_file = os.path.join(CACHE_DIR, f"checkpoint_{idx:04d}.json")
        if os.path.exists(cache_file):
            with open(cache_file, "r") as f:
                compiled_history.append(json.load(f))

    with open(DATA_OUTPUT_FILE, "w") as f:
        json.dump(compiled_history, f, indent=2)

    print(f"✅ Finished! Output stored in {DATA_OUTPUT_FILE}")


if __name__ == "__main__":
    main()
