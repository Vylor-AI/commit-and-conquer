import os
import json

CACHE_DIR = ".vylor_git_cache"
DATA_OUTPUT_FILE = "vylor_empire_history.json"


def manual_compile():
    print(f"📦 Scanning '{CACHE_DIR}' for computed checkpoints...")

    if not os.path.exists(CACHE_DIR):
        print("❌ Cache directory not found!")
        return

    # Grab all JSON files inside the cache directory
    cache_files = [
        f
        for f in os.listdir(CACHE_DIR)
        if f.startswith("checkpoint_") and f.endswith(".json")
    ]

    # Sort them strictly by their sequence index (checkpoint_0000, checkpoint_0001, etc.)
    cache_files.sort()

    print(f"Found {len(cache_files)} cached checkpoints on disk.")

    compiled_history = []
    for file_name in cache_files:
        file_path = os.path.join(CACHE_DIR, file_name)
        try:
            with open(file_path, "r") as f:
                data = json.load(f)
                # Keep tracking dates clean
                if "date" in data and "scores" in data:
                    compiled_history.append(data)
        except Exception as e:
            print(f"⚠️ Skipping corrupted file {file_name}: {e}")

    # Write the complete history to your master file
    with open(DATA_OUTPUT_FILE, "w") as f:
        json.dump(compiled_history, f, indent=2)

    print(
        f"✅ Successfully compiled {len(compiled_history)} frames into {DATA_OUTPUT_FILE}!"
    )


if __name__ == "__main__":
    manual_compile()
