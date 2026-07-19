#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  run_shell_pipeline.sh -p <workers> -o <output_json> <repo_path> [repo_path...]

Options:
  -p <workers>      Parallel workers for blame tasks (default: 16)
  -o <output_json> Output JSON path (default: ./commit_and_conquer_data.json)

Example:
  bash scripts/cc_analyze/run_shell_pipeline.sh -p 16 -o ./commit_and_conquer_data.json ../vylor ../vylor-web
EOF
}

workers=16
output_file="./commit_and_conquer_data.json"

while getopts ":p:o:h" opt; do
  case "$opt" in
    p) workers="$OPTARG" ;;
    o) output_file="$OPTARG" ;;
    h)
      usage
      exit 0
      ;;
    :)
      echo "Missing value for -$OPTARG" >&2
      usage
      exit 1
      ;;
    \?)
      echo "Invalid option: -$OPTARG" >&2
      usage
      exit 1
      ;;
  esac
done
shift $((OPTIND - 1))

if [ "$#" -lt 1 ]; then
  echo "At least one repository path is required." >&2
  usage
  exit 1
fi

if ! [[ "$workers" =~ ^[0-9]+$ ]] || [ "$workers" -lt 1 ]; then
  echo "-p must be a positive integer." >&2
  exit 1
fi

format_duration() {
  local ms="$1"
  if [ "$ms" -lt 1000 ]; then
    echo "${ms}ms"
    return
  fi

  local total_s=$((ms / 1000))
  local s=$((total_s % 60))
  local m=$(((total_s / 60) % 60))
  local h=$((total_s / 3600))

  if [ "$h" -gt 0 ]; then
    printf "%dh %dm %ds" "$h" "$m" "$s"
  elif [ "$m" -gt 0 ]; then
    printf "%dm %ds" "$m" "$s"
  else
    printf "%ds" "$s"
  fi
}

# Targeted "tracked-but-noisy" excludes only (no broad gitignore-style filtering).
excluded_substrings=(
  "package-lock.json"
  "yarn.lock"
  "pnpm-lock.yaml"
  "cargo.lock"
  "poetry.lock"
  "podfile.lock"
  "composer.lock"
  "gemfile.lock"
  "pipfile.lock"
  "lint.xml"
)
excluded_csv="$(IFS=,; echo "${excluded_substrings[*]}")"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

repos_file="$tmp_dir/repos.txt"
commits_file="$tmp_dir/commits.tsv"
changes_file="$tmp_dir/changes.tsv"
tasks_file="$tmp_dir/tasks.tsv"
tasks_null="$tmp_dir/tasks.null"
results_dir="$tmp_dir/results"

mkdir -p "$results_dir"
: > "$repos_file"
: > "$commits_file"
: > "$changes_file"
: > "$tasks_file"

echo "🔍 Preparing commit metadata + blame tasks..."

for repo_path in "$@"; do
  if [ ! -d "$repo_path/.git" ]; then
    echo "Skipping non-git repo path: $repo_path" >&2
    continue
  fi

  repo_name="$(basename "$repo_path")"
  echo "$repo_name" >> "$repos_file"

  # Commit-level metadata and numstat totals.
  git -C "$repo_path" log \
    --date=format:'%Y-%m-%d %H:%M' \
    --pretty=format:'@@@%H%x09%ct%x09%an%x09%ad' \
    --numstat | awk -F '\t' -v repo="$repo_name" '
    BEGIN {
      c=""; epoch=""; committer=""; date="";
      add=0; rem=0;
    }
    function flush_commit() {
      if (c != "") {
        printf "%s\t%s\t%s\t%s\t%s\t%d\t%d\n", repo, c, epoch, date, committer, add, rem;
      }
    }
    /^@@@/ {
      flush_commit();
      line=$0;
      sub(/^@@@/, "", line);
      split(line, parts, "\t");
      c=parts[1];
      epoch=parts[2];
      committer=parts[3];
      date=parts[4];
      add=0;
      rem=0;
      next;
    }
    NF >= 3 && c != "" {
      a=$1; d=$2;
      if (a ~ /^[0-9]+$/) { add += a; }
      if (d ~ /^[0-9]+$/) { rem += d; }
    }
    END {
      flush_commit();
    }
  ' >> "$commits_file"

  # File-level mutation stream (rename/delete aware) used to replay cumulative ownership.
  git -C "$repo_path" log \
    --pretty=format:'@@@%H' \
    --name-status \
    --find-renames | awk -F '\t' -v repo="$repo_name" -v rpath="$repo_path" -v changes="$changes_file" -v tasks="$tasks_file" -v excluded_csv="$excluded_csv" '
    BEGIN {
      c="";
      exclude_count = split(excluded_csv, exclude, ",");
      for (i = 1; i <= exclude_count; i++) {
        exclude[i] = tolower(exclude[i]);
      }
    }
    function is_excluded(path,   lower_path, i, token) {
      lower_path = tolower(path);
      for (i = 1; i <= exclude_count; i++) {
        token = exclude[i];
        if (token != "" && index(lower_path, token) > 0) {
          return 1;
        }
      }
      return 0;
    }
    /^@@@/ {
      line=$0;
      sub(/^@@@/, "", line);
      c=line;
      next;
    }
    c == "" {
      next;
    }
    NF >= 2 {
      status=$1;

      if (status ~ /^R[0-9]*$/ && NF >= 3) {
        old_path=$2;
        new_path=$3;
        printf "%s\t%s\t%s\t%s\t%s\t%s\n", rpath, repo, c, status, old_path, new_path >> changes;
        if (!is_excluded(new_path)) {
          printf "%s\t%s\t%s\t%s\n", rpath, repo, c, new_path >> tasks;
        }
        next;
      }

      file_path=$2;
      printf "%s\t%s\t%s\t%s\t%s\t%s\n", rpath, repo, c, status, file_path, file_path >> changes;

      if (status != "D" && !is_excluded(file_path)) {
        printf "%s\t%s\t%s\t%s\n", rpath, repo, c, file_path >> tasks;
      }
    }
  '
done

if [ ! -s "$commits_file" ]; then
  echo "No commits found from provided repositories." >&2
  exit 1
fi

if [ -s "$tasks_file" ]; then
  sort -u "$tasks_file" -o "$tasks_file"
fi

if [ ! -s "$tasks_file" ]; then
  echo "No blame tasks found. Generating output with empty scores."
fi

# Build null-separated task args for safe xargs processing.
if [ -s "$tasks_file" ]; then
  while IFS=$'\t' read -r repo_path repo_name commit_hash file_path; do
    printf '%s\0%s\0%s\0%s\0' "$repo_path" "$repo_name" "$commit_hash" "$file_path"
  done < "$tasks_file" > "$tasks_null"
fi

task_total=0
if [ -s "$tasks_file" ]; then
  task_total="$(wc -l < "$tasks_file" | tr -d ' ')"
fi

echo "🧵 Running blame tasks (workers=$workers, total=$task_total)..."

start_ns="$(date +%s%N)"
progress_next=100
progress_pid=""

if [ "$task_total" -gt 0 ]; then
  (
    while true; do
      done_count="$(find "$results_dir" -type f | wc -l | tr -d ' ')"
      if [ "$done_count" -ge "$progress_next" ] || [ "$done_count" -ge "$task_total" ]; then
        now_ns="$(date +%s%N)"
        elapsed_ms=$(((now_ns - start_ns) / 1000000))
        rate="0.00"
        eta_ms=0
        if [ "$elapsed_ms" -gt 0 ] && [ "$done_count" -gt 0 ]; then
          rate="$(awk -v d="$done_count" -v e="$elapsed_ms" 'BEGIN { printf "%.2f", (d*1000)/e }')"
          remaining=$((task_total - done_count))
          if [ "$done_count" -gt 0 ]; then
            eta_ms=$((elapsed_ms * remaining / done_count))
          fi
        fi
        percent="$(awk -v d="$done_count" -v t="$task_total" 'BEGIN { if (t == 0) printf "100.0"; else printf "%.1f", (d*100)/t }')"
        echo "🧵 ${done_count}/${task_total} tasks (${percent}%) | elapsed=$(format_duration "$elapsed_ms") | eta=$(format_duration "$eta_ms") | rate=${rate} tasks/s"
        while [ "$progress_next" -le "$done_count" ]; do
          progress_next=$((progress_next + 100))
        done
      fi
      if [ "$done_count" -ge "$task_total" ]; then
        break
      fi
      sleep 1
    done
  ) &
  progress_pid="$!"
fi

worker_script="$tmp_dir/blame_worker.sh"
cat > "$worker_script" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
results_dir="$1"
repo_path="$2"
repo_name="$3"
commit_hash="$4"
file_path="$5"

task_id="$(printf '%s\t%s\t%s\t%s' "$repo_path" "$repo_name" "$commit_hash" "$file_path" | shasum | awk '{print $1}')"
out_file="${results_dir}/${task_id}.tsv"

# Always create a completion artifact so progress is accurate.
: > "$out_file"

if ! git -C "$repo_path" cat-file -e "${commit_hash}:${file_path}" 2>/dev/null; then
  exit 0
fi

git -C "$repo_path" blame --line-porcelain "$commit_hash" -- "$file_path" 2>/dev/null \
  | awk -v repo="$repo_name" -v c="$commit_hash" -v f="$file_path" '
      /^author / {
        author = substr($0, 8);
        cnt[author] += 1;
      }
      END {
        for (a in cnt) {
          printf "%s\t%s\t%s\t%s\t%d\n", repo, c, f, a, cnt[a];
        }
      }
    ' > "$out_file" || true
EOF
chmod +x "$worker_script"

if [ "$task_total" -gt 0 ]; then
  xargs -0 -n 4 -P "$workers" "$worker_script" "$results_dir" < "$tasks_null"
fi

if [ -n "$progress_pid" ]; then
  wait "$progress_pid" || true
fi

end_ns="$(date +%s%N)"
elapsed_ms=$(((end_ns - start_ns) / 1000000))
echo "✅ Blame stage completed in $(format_duration "$elapsed_ms")"

echo "🐍 Running Python data aggregation and stateful replay..."
py_err_log="$tmp_dir/py_err.log"

set +e
python3 - "$repos_file" "$commits_file" "$changes_file" "$results_dir" "$output_file" 2>"$py_err_log" <<'PY'
import csv
import json
import os
import sys
from collections import defaultdict

repos_path, commits_path, changes_path, results_dir, out_path = sys.argv[1:6]


def apply_counts(target, counts, sign):
    for author, value in counts.items():
        next_value = target.get(author, 0) + sign * value
        if next_value <= 0:
            target.pop(author, None)
        else:
            target[author] = next_value


def sorted_author_map(counts):
    return {
        author: counts[author]
        for author, _ in sorted(
            counts.items(),
            key=lambda item: (-item[1], item[0].lower()),
        )
    }


repos = []
seen_repos = set()
with open(repos_path, "r", encoding="utf-8") as f:
    for line in f:
        repo_name = line.strip()
        if not repo_name or repo_name in seen_repos:
            continue
        seen_repos.add(repo_name)
        repos.append(repo_name)

# Safe file-system based chunk aggregation directly within Python
file_scores = defaultdict(lambda: defaultdict(int))
if os.path.isdir(results_dir):
    for entry in os.scandir(results_dir):
        if entry.is_file() and entry.name.endswith(".tsv"):
            with open(entry.path, "r", encoding="utf-8") as f:
                for row in csv.reader(f, delimiter="\t"):
                    if len(row) != 5:
                        continue
                    repo, commit_hash, file_path, author, value = row
                    file_scores[(repo, commit_hash, file_path)][author] += int(value)

# (repo, commit) -> ordered list of change records
commit_changes = defaultdict(list)
with open(changes_path, "r", encoding="utf-8") as f:
    for row in csv.reader(f, delimiter="\t"):
        if len(row) != 6:
            continue
        _repo_path, repo, commit_hash, status, old_path, new_path = row
        commit_changes[(repo, commit_hash)].append((status, old_path, new_path))

# chronological commits with numstat metadata
commits = []
with open(commits_path, "r", encoding="utf-8") as f:
    for row in csv.reader(f, delimiter="\t"):
        if len(row) != 7:
            continue
        repo, commit_hash, epoch_str, date, committer, add_str, rem_str = row
        try:
            epoch = int(epoch_str)
            added = int(add_str)
            removed = int(rem_str)
        except ValueError:
            continue
        commits.append(
            {
                "repo": repo,
                "commit": commit_hash,
                "epoch": epoch,
                "date": date,
                "committer": committer,
                "added": added,
                "removed": removed,
            }
        )

commits.sort(key=lambda c: c["epoch"])

# Stateful replay
repo_file_ownership = {repo: {} for repo in repos}
repo_totals = {repo: {} for repo in repos}
timeline = []

for index, meta in enumerate(commits):
    repo = meta["repo"]
    commit_hash = meta["commit"]

    if repo not in repo_file_ownership:
        repo_file_ownership[repo] = {}
    if repo not in repo_totals:
        repo_totals[repo] = {}
        if repo not in repos:
            repos.append(repo)

    for status, old_path, new_path in commit_changes.get((repo, commit_hash), []):
        if status.startswith("R"):
            previous = repo_file_ownership[repo].pop(old_path, None)
            if previous:
                apply_counts(repo_totals[repo], previous, -1)

            next_counts = dict(file_scores.get((repo, commit_hash, new_path), {}))
            if next_counts:
                repo_file_ownership[repo][new_path] = next_counts
                apply_counts(repo_totals[repo], next_counts, +1)
            else:
                repo_file_ownership[repo].pop(new_path, None)
            continue

        path = new_path

        previous = repo_file_ownership[repo].pop(path, None)
        if previous:
            apply_counts(repo_totals[repo], previous, -1)

        if status != "D":
            next_counts = dict(file_scores.get((repo, commit_hash, path), {}))
            if next_counts:
                repo_file_ownership[repo][path] = next_counts
                apply_counts(repo_totals[repo], next_counts, +1)

    # Perform step snapshot tracking without exponential deep-copying penalties
    repo_scores_snapshot = {}
    for r in repos:
        if r == repo:
            repo_scores_snapshot[r] = sorted_author_map(repo_totals.get(r, {}))
        else:
            if timeline:
                repo_scores_snapshot[r] = timeline[-1]["repoScores"].get(r, {})
            else:
                repo_scores_snapshot[r] = {}

    timeline.append(
        {
            "index": index,
            "repo": repo,
            "date": meta["date"],
            "committer": meta["committer"],
            "changes": {
                "added": meta["added"],
                "removed": meta["removed"],
            },
            "repoScores": repo_scores_snapshot,
        }
    )

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(timeline, f, ensure_ascii=False, indent=2)

print(f"Wrote {len(timeline)} commits to {out_path}")
PY

py_status=$?
set -e

if [ $py_status -ne 0 ]; then
  echo "❌ Python parsing failed! Check the log below for details:" >&2
  cat "$py_err_log" >&2
  exit 1
fi