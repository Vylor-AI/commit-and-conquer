import os
import subprocess
import json
from collections import defaultdict
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
from threading import BoundedSemaphore

# --- CONFIGURATION CONSTANTS ---
REPOS = ["vylor", "vylor-web"]
DAYS_TO_LOOK_BACK = 10000
DATA_OUTPUT_FILE = "vylor_empire_commit_history.json"
CACHE_DIR = ".vylor_git_commit_cache"
ERRORS_OUTPUT_FILE = "vylor_commit_errors.json"

# --- CONCURRENCY THROTTLING ---
OUTER_MAX_WORKERS = 4  # Number of commits in parallel
INNER_MAX_WORKERS = 16  # Lowered to prevent FD exhaustion
SUBPROCESS_SEMAPHORE = BoundedSemaphore(40)  # Max 40 active Git processes globally

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


def get_rich_commits(repo_path, repo_name):
    since_date = (datetime.now() - timedelta(days=DAYS_TO_LOOK_BACK)).strftime(
        "%Y-%m-%d"
    )
    cmd = [
        "git",
        "log",
        "--reverse",
        f"--since={since_date}",
        "--format=%H|%cI|%cn",
        "--numstat",
    ]

    result = subprocess.run(
        cmd, cwd=repo_path, stdout=subprocess.PIPE, text=True, check=True
    )
    commits = []
    current_commit = None

    for line in result.stdout.splitlines():
        if not line.strip():
            continue

        if "|" in line and len(line.split("|")) == 3:
            if current_commit:
                commits.append(current_commit)

            h, d_str, author = line.split("|")
            try:
                dt = datetime.fromisoformat(d_str).replace(tzinfo=None)
            except ValueError:
                dt = datetime.strptime(d_str[:19], "%Y-%m-%dT%H:%M:%S")

            current_commit = {
                "hash": h,
                "date": dt,
                "committer": clean_name(author),
                "repo": repo_name,
                "repo_path": repo_path,
                "changes": {"added": 0, "removed": 0},
            }
        elif current_commit and (
            line.startswith("-") or line[0].isdigit() or line.startswith("\t")
        ):
            parts = line.split()
            if len(parts) >= 3:
                added, removed, file_path = parts[0], parts[1], parts[2]
                if any(file_path.endswith(ext) for ext in VALID_EXTENSIONS) and not any(
                    ex in file_path for ex in EXCLUDED_SUBSTRINGS
                ):
                    try:
                        current_commit["changes"]["added"] += (
                            int(added) if added != "-" else 0
                        )
                        current_commit["changes"]["removed"] += (
                            int(removed) if removed != "-" else 0
                        )
                    except ValueError:
                        pass

    if current_commit:
        commits.append(current_commit)

    return commits


def blame_file_at_commit(repo_path, file_path, commit_hash):
    author_counts = defaultdict(int)
    with SUBPROCESS_SEMAPHORE:
        try:
            cmd = ["git", "blame", "--line-porcelain", commit_hash, "--", file_path]
            result = subprocess.run(
                cmd,
                cwd=repo_path,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            )
            output_text = result.stdout.decode("utf-8", errors="ignore")
            for line in output_text.splitlines():
                if line.startswith("author "):
                    cleaned = clean_name(line[7:].strip())
                    author_counts[cleaned] += 1
        except subprocess.CalledProcessError as e:
            err_msg = e.stderr.decode("utf-8", errors="ignore").strip()
            print(f"❌ Error blaming {file_path} in {commit_hash[:8]}: {err_msg}")
            raise RuntimeError(f"Git blame failed: {err_msg}") from e
    return author_counts


def process_single_commit(args):
    idx, commit_data = args
    cache_file = os.path.join(CACHE_DIR, f"commit_{idx:05d}.json")

    # --- INTELLIGENT CACHE VALIDATION ---
    if os.path.exists(cache_file):
        try:
            with open(cache_file, "r") as f:
                cached_data = json.load(f)
            # Self-healing if scores are empty but files changed
            if (
                not cached_data.get("scores")
                and cached_data.get("changes", {}).get("added", 0) > 0
            ):
                print(
                    f"⚠️ Cache entry {idx} found with 0 scores but has modifications. Forcing reload..."
                )
                os.remove(cache_file)
            else:
                return None  # Valid cache, skip
        except Exception:
            os.remove(cache_file)

    path = commit_data["repo_path"]
    commit_hash = commit_data["hash"]
    date_str = commit_data["date"].strftime("%Y-%m-%d %H:%M")

    step_scores = defaultdict(int)

    try:
        cmd = ["git", "ls-tree", "-r", "--name-only", commit_hash]
        with SUBPROCESS_SEMAPHORE:
            res = subprocess.run(
                cmd,
                cwd=path,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            )
        files_text = res.stdout.decode("utf-8", errors="ignore")

        target_files = []
        for f in files_text.splitlines():
            f = f.strip()
            if f.endswith(VALID_EXTENSIONS) and not any(
                exclude in f for exclude in EXCLUDED_SUBSTRINGS
            ):
                target_files.append(f)

        if target_files:
            with ThreadPoolExecutor(max_workers=INNER_MAX_WORKERS) as inner_executor:
                futures = [
                    inner_executor.submit(blame_file_at_commit, path, f, commit_hash)
                    for f in target_files
                ]

                for future in futures:
                    file_scores = future.result()
                    for author, count in file_scores.items():
                        step_scores[author] += count

        total_matched_lines = sum(step_scores.values())
        if len(target_files) > 0 and total_matched_lines == 0:
            raise ValueError(
                f"Validation failed: Blamed {len(target_files)} files but returned 0 total lines."
            )

        # Cache the isolated scores for just THIS repository's commit
        entry = {
            "index": idx,
            "commit_hash": commit_hash,
            "repo": commit_data["repo"],
            "date": date_str,
            "committer": commit_data["committer"],
            "changes": commit_data["changes"],
            "scores": dict(step_scores),
            "validation": {
                "files_analyzed": len(target_files),
                "total_lines": total_matched_lines,
            },
        }

        with open(cache_file, "w") as f:
            json.dump(entry, f, indent=2)

        return None

    except Exception as e:
        print(f"💥 Failed to process commit {commit_hash[:8]} (Index {idx}): {str(e)}")
        error_info = {
            "index": idx,
            "commit_hash": commit_hash,
            "repo": commit_data["repo"],
            "error": str(e),
        }
        return error_info


def main():
    print("⏳ Initializing cross-repository self-healing timeline engine...")
    os.makedirs(CACHE_DIR, exist_ok=True)

    all_commits = []

    for repo in REPOS:
        path = os.path.abspath(repo)
        if os.path.exists(path):
            print(f"📦 Extracting rich history from: {repo}")
            all_commits.extend(get_rich_commits(path, repo))

    if not all_commits:
        print("❌ No repositories or commits found.")
        return

    all_commits.sort(key=lambda x: x["date"])
    print(f"📦 Total chronological commits to analyze: {len(all_commits)}")

    tasks = [(idx, commit) for idx, commit in enumerate(all_commits)]

    errors = []
    with ThreadPoolExecutor(max_workers=OUTER_MAX_WORKERS) as outer_executor:
        results = outer_executor.map(process_single_commit, tasks)
        for res in iter(results):
            if res:
                errors.append(res)

    # --- COMPILE CACHED ENTRIES INTO MASTER WITH CROSS-REPO STATE ---
    print("\n📦 Structuring repo scores and building composite timeline...")
    compiled_history = []

    # Track the last known score map for each repository to carry forward
    last_known_repo_scores = {repo: {} for repo in REPOS}

    for idx in range(len(all_commits)):
        cache_file = os.path.join(CACHE_DIR, f"commit_{idx:05d}.json")
        if os.path.exists(cache_file):
            with open(cache_file, "r") as f:
                commit_entry = json.load(f)

            active_repo = commit_entry["repo"]

            # Update last known state for the repo that committed
            last_known_repo_scores[active_repo] = commit_entry["scores"]

            # Construct the per-repo scores representation
            structured_repo_scores = {}
            total_composite_scores = defaultdict(int)

            for repo in REPOS:
                repo_scores = last_known_repo_scores[repo]
                structured_repo_scores[repo] = repo_scores

                # Sum individual repo scores to construct a true combined total score
                for author, score in repo_scores.items():
                    total_composite_scores[author] += score

            # Re-architect JSON structure
            commit_entry["repo_scores"] = structured_repo_scores
            commit_entry["scores"] = dict(total_composite_scores)

            # Remove isolated temporary key
            if "validation" in commit_entry >= 0:
                del commit_entry["validation"]

            compiled_history.append(commit_entry)

    with open(DATA_OUTPUT_FILE, "w") as f:
        json.dump(compiled_history, f, indent=2)

    print(f"✅ Finished! Output stored in {DATA_OUTPUT_FILE}")

    if errors:
        with open(ERRORS_OUTPUT_FILE, "w") as f:
            json.dump(errors, f, indent=2)
        print(
            f"⚠️ {len(errors)} non-fatal errors caught. Details stored in: {ERRORS_OUTPUT_FILE}"
        )


if __name__ == "__main__":
    main()
