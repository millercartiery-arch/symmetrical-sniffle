from PIL import Image, ImageDraw, ImageFont, ImageFilter


SIZE = 1024
ICON_PATH = "src-tauri/icons/icon.png"
APP_ICON_PATH = "src-tauri/icons/app-icon.png"


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def main() -> None:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # Brand theme gradient: #10A37F -> #37C49F
    c1 = (16, 163, 127)
    c2 = (55, 196, 159)

    margin = 64
    diameter = SIZE - (margin * 2)
    center = SIZE // 2
    radius = diameter // 2

    # Render radial-ish vertical blend inside the circle.
    for y in range(SIZE):
        t = y / (SIZE - 1)
        r = lerp(c1[0], c2[0], t)
        g = lerp(c1[1], c2[1], t)
        b = lerp(c1[2], c2[2], t)
        draw.line([(0, y), (SIZE, y)], fill=(r, g, b, 255))

    # Apply circular alpha mask.
    mask = Image.new("L", (SIZE, SIZE), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.ellipse(
        (center - radius, center - radius, center + radius, center + radius),
        fill=255,
    )
    image.putalpha(mask)

    # Subtle top-left highlight for depth.
    highlight = Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 0))
    hdraw = ImageDraw.Draw(highlight)
    hdraw.ellipse(
        (center - radius + 80, center - radius + 80, center + radius - 260, center + radius - 260),
        fill=(255, 255, 255, 40),
    )
    image = Image.alpha_composite(image, highlight)

    # Soft shadow outside circle.
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.ellipse(
        (center - radius + 16, center - radius + 26, center + radius + 16, center + radius + 26),
        fill=(0, 0, 0, 90),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    shadow.alpha_composite(image)
    image = shadow

    # White CM mark.
    try:
        font = ImageFont.truetype("arialbd.ttf", 350)
    except OSError:
        font = ImageFont.load_default()
    text = "CM"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (SIZE - tw) // 2
    ty = (SIZE - th) // 2 - 24
    text_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    tdraw = ImageDraw.Draw(text_layer)
    tdraw.text((tx, ty), text, font=font, fill=(255, 255, 255, 248))
    image = Image.alpha_composite(image, text_layer)

    image.save(ICON_PATH)
    image.save(APP_ICON_PATH)


if __name__ == "__main__":
    main()
