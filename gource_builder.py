import os
import subprocess

try:
    from PIL import Image, ImageDraw, ImageFont, ImageOps
except ImportError:
    print("Error: 'pillow' library not found. Please run: pip3 install pillow")
    exit(1)

print("Generating logs from repositories...")
subprocess.run(["gource", "--output-custom-log", "log_vylor.txt", "vylor"])
subprocess.run(["gource", "--output-custom-log", "log_vylor_web.txt", "vylor-web"])

AVATARS_DIR = ".vylor_avatars"

def clean_author(name):
    name_lower = name.lower().strip()

    # Handle the specific Mahmoud conflicts
    if "mahmoud" in name_lower:
        if "hammam" in name_lower:
            return "Mahmoud H."
        if "kandil" in name_lower:
            return "Mahmoud K."
        return "Mahmoud"

    # Standardize Vylor AI
    if "vylor" in name_lower:
        return "Vylor AI"

    # Grab just the first name and capitalize it
    parts = name.split()
    if parts:
        return parts[0].capitalize()
    return "Unknown"


def process_log(input_file, repo_prefix):
    processed_lines = []
    unique_authors = set()
    with open(input_file, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            parts = line.strip().split("|")
            if len(parts) >= 4:
                timestamp, author, action_type, filepath = (
                    parts[0],
                    parts[1],
                    parts[2],
                    parts[3],
                )
                cleaned_name = clean_author(author)
                unique_authors.add(cleaned_name)
                prefixed_path = f"/{repo_prefix}{filepath}"
                processed_lines.append(
                    (
                        int(timestamp),
                        f"{timestamp}|{cleaned_name}|{action_type}|{prefixed_path}",
                    )
                )
    return processed_lines, unique_authors


print("Processing logs and cleaning up author names...")
all_records = []
authors = set()

records1, auth1 = process_log("log_vylor.txt", "vylor")
records2, auth2 = process_log("log_vylor_web.txt", "vylor-web")

all_records.extend(records1)
all_records.extend(records2)
authors.update(auth1)
authors.update(auth2)

all_records.sort(key=lambda x: x[0])

with open("combined.txt", "w", encoding="utf-8") as out:
    for _, line in all_records:
        out.write(line + "\n")

for temp_file in ["log_vylor.txt", "log_vylor_web.txt"]:
    if os.path.exists(temp_file):
        os.remove(temp_file)

# --- AVATAR PROCESSING ---
if not os.path.exists(AVATARS_DIR):
    os.makedirs(AVATARS_DIR)

BRAND_BG_COLOR = (36, 83, 64, 255)  # #245340 in RGBA


def force_circle_background(image_path):
    try:
        with Image.open(image_path) as img:
            img = img.convert("RGBA")
            img_fitted = ImageOps.fit(img, (160, 160), Image.Resampling.LANCZOS)

            final_canvas = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
            draw = ImageDraw.Draw(final_canvas)
            draw.ellipse([10, 10, 190, 190], fill=BRAND_BG_COLOR)

            offset_x = (200 - img_fitted.width) // 2
            offset_y = (200 - img_fitted.height) // 2
            final_canvas.paste(img_fitted, (offset_x, offset_y), mask=img_fitted)

            mask = Image.new("L", (200, 200), 0)
            mask_draw = ImageDraw.Draw(mask)
            mask_draw.ellipse([10, 10, 190, 190], fill=255)

            output = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
            output.paste(final_canvas, (0, 0), mask=mask)

            output.save(image_path, "PNG")
            print(f"Successfully framed {image_path} inside a brand-colored circle!")

    except Exception as e:
        print(f"Error processing circle framing for {image_path}: {e}")


# Process custom profile pictures
my_avatar_path = f"{AVATARS_DIR}/Ahmed.png"
if os.path.exists(my_avatar_path):
    force_circle_background(my_avatar_path)

vylor_logo_path = f"{AVATARS_DIR}/Vylor AI.png"
if os.path.exists(vylor_logo_path):
    force_circle_background(vylor_logo_path)

# Generate consistent circular initials for everyone else
colors = [
    (41, 128, 185),
    (39, 174, 96),
    (155, 89, 182),
    (230, 126, 34),
    (26, 188, 156),
    (241, 196, 15),
    (211, 84, 0),
]

print("Generating circular initial avatars for the team...")
for i, author in enumerate(sorted(authors)):
    avatar_path = f"{AVATARS_DIR}/{author}.png"

    if os.path.exists(avatar_path):
        continue

    if author.endswith("."):
        name_parts = author.split()
        initials = (name_parts[0][0] + name_parts[1][0]).upper()
    else:
        initials = author[:2].upper() if len(author) >= 2 else author.upper()

    img = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    color = colors[i % len(colors)]

    draw.ellipse([10, 10, 190, 190], fill=color)

    try:
        font = ImageFont.truetype("Arial" if os.name == "nt" else "Helvetica", 80)
    except IOError:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), initials, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    x = (200 - text_width) / 2
    y = (190 - text_height) / 2

    draw.text((x, y), initials, fill=(255, 255, 255), font=font)
    img.save(avatar_path)

print("Launching clean, full-screen Gource...")

# 1. Define Gource arguments (adding resolution and output stream flags)
gource_args = [
    "gource",
    "combined.txt",
    "--seconds-per-day",
    "0.1",  # Fast forward!
    "--auto-skip-seconds",
    "1",
    "--hide",
    "dirnames,filenames",
    "--title",
    "Vylor AI Ecosystem Evolution",
    "--max-file-lag",
    "-1",
    "--user-scale",
    "1",
    "--user-friction",
    "0.2",
    "--user-image-dir",
    "avatars",
    "-1920x1080",
    "--stop-at-end",  # Force an immediate exit at the last log entry
    "--output-ppm-stream",
    "-",
]

# 2. Define FFmpeg arguments to compress the incoming stream to a smooth 60fps MP4
ffmpeg_args = [
    "ffmpeg",
    "-y",
    "-r",
    "60",  # Render at a smooth 60 FPS
    "-f",
    "image2pipe",  # Tell FFmpeg to expect an image pipe
    "-vcodec",
    "ppm",  # The stream format coming from Gource
    "-i",
    "-",  # Read from standard input (the pipe)
    "-vcodec",
    "libx264",  # Highly compatible H.264 video codec
    "-preset",
    "medium",  # Compression speed preset
    "-pix_fmt",
    "yuv420p",  # Required pixel format for standard media players
    "-crf",
    "18",  # Visually lossless quality (lower = higher quality)
    "-threads",
    "0",  # Use all available CPU cores for encoding
    "gource.mp4",  # Output filename
]

print("Rendering Gource animation directly to 'gource.mp4'...")
print("This might take a minute as it processes every frame. Please wait...")

# 3. Spin up both processes and pipe Gource's output directly into FFmpeg's input
gource_process = subprocess.Popen(gource_args, stdout=subprocess.PIPE)
ffmpeg_process = subprocess.Popen(ffmpeg_args, stdin=gource_process.stdout)

# Allow Gource to receive a SIGPIPE if FFmpeg exits prematurely
gource_process.stdout.close()

# Wait for FFmpeg to finish encoding the video
ffmpeg_process.communicate()

print("\nProcessing complete! Your final video is saved as 'gource.mp4'.")
