import os
from PIL import Image, ImageDraw, ImageFont

# --- TARGET DIRECTORY ---
AVATARS_DIR = ".vylor_avatars"

# --- HUMAN AND SYSTEM TEAM COLOR SCHEME ---
PLAYER_PROFILES = {
    "Abdelrahman": {"color": "#3498db", "initials": "AG"},  # Bright Blue
    "Ahmad": {"color": "#2980b9", "initials": "AB"},  # Dark Blue
    "Ahmed R.": {"color": "#e67e22", "initials": "AR"},  # Orange
    "Hazem": {"color": "#9b59b6", "initials": "HZ"},  # Purple
    "Julius": {"color": "#8e44ad", "initials": "JK"},  # Deep Purple
    "Mahmoud H": {"color": "#e74c3c", "initials": "MH"},  # Red
    "Mahmoud K": {"color": "#c0392b", "initials": "MK"},  # Dark Red
    "Shadi": {"color": "#f1c40f", "initials": "SH"},  # Yellow
    "Momen": {"color": "#e84393", "initials": "MR"},  # Pink/Magenta
    "Mohamed S": {"color": "#fd79a8", "initials": "MS"},  # Light Pink
    "CI": {"color": "#7f8c8d", "initials": "CI"},  # Concrete Grey
    "Vylor": {"color": "#245340", "initials": "VY"},  # Vylor Signature Green
}


def load_system_font(size):
    """
    Attempts to load a standard system font across macOS and Linux.
    """
    # Common system font paths
    font_names = [
        # macOS paths
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        # Linux paths
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf",
        # Fallbacks (looking in current working directory or system PATH)
        "arialbd.ttf",
        "Arial Bold.ttf",
        "DejaVuSans-Bold.ttf",
    ]

    for font_path in font_names:
        try:
            return ImageFont.truetype(font_path, int(size))
        except IOError:
            continue

    # Absolute last-resort fallback
    return ImageFont.load_default()


def create_circular_initials_badge(name, profile, size=300):
    """
    Generates a high-quality circular badge with a solid background,
    a subtle inner/outer border, and perfectly centered large initials.
    """
    # Create an image canvas with transparency (RGBA)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    color = profile["color"]
    initials = profile["initials"]

    # Draw a clean filled base circle
    padding = 4
    draw.ellipse(
        (padding, padding, size - padding, size - padding),
        fill=color,
        outline="#ffffff",
        width=3,
    )

    # We want the font size to be roughly 45% of the total canvas size so it fills the badge
    font_size = int(size * 0.45)
    font = load_system_font(font_size)

    # Center-align text perfectly inside the circle
    # "mm" anchor stands for Middle-Middle alignment (perfect centering)
    draw.text((size // 2, size // 2), initials, fill="#ffffff", anchor="mm", font=font)

    return img


def main():
    os.makedirs(AVATARS_DIR, exist_ok=True)
    print("🎨 Generating team initials avatars with scaled fonts...")

    for name, profile in PLAYER_PROFILES.items():
        # Clean file names (replacing dots or spaces with underscores)
        safe_filename = name.replace(" ", "_").replace(".", "")
        file_path = os.path.join(AVATARS_DIR, f"{safe_filename}.png")

        badge_img = create_circular_initials_badge(name, profile)
        badge_img.save(file_path, "PNG")
        print(f"  ✓ Saved: {file_path} ({profile['initials']})")

    print("\n✨ All avatars are ready with large, crisp initials!")


if __name__ == "__main__":
    main()
