#!/usr/bin/env python3
"""
Generador reproducible de recursos graficos de prendas y AR para FashionStore.
Genera:
  - 192 recursos en backend-nest/public/assets/prendas/ (96 variantes: 8 tipos x 12 colores,
    cada una en version <tipo>-<color>-ar.png RGBA 400x560 y <tipo>-<color>-foto.jpg RGB 400x560).
  - 6 iconos de identidad movil en mobile-app/assets/ (si no existen o se solicita --icons).
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path
from typing import Dict, List, Tuple
from PIL import Image, ImageDraw, ImageFilter

WIDTH, HEIGHT = 400, 560

TIPOS: List[str] = [
    "blusa",
    "camiseta",
    "cartera",
    "chaqueta",
    "falda",
    "pantalon",
    "vestido",
    "zapato",
]

COLORES: Dict[str, Tuple[int, int, int]] = {
    "azul": (28, 63, 148),
    "beige": (214, 194, 161),
    "blanco": (242, 241, 238),
    "camel": (182, 132, 82),
    "celeste": (128, 178, 219),
    "gris": (132, 136, 142),
    "mostaza": (214, 158, 46),
    "negro": (32, 33, 36),
    "rojo": (184, 34, 42),
    "rosado": (224, 148, 178),
    "verde": (42, 108, 74),
    "vino": (108, 30, 58),
}


def clamp(v: float) -> int:
    return max(0, min(255, int(round(v))))


def shade(rgb: Tuple[int, int, int], factor: float) -> Tuple[int, int, int]:
    return (clamp(rgb[0] * factor), clamp(rgb[1] * factor), clamp(rgb[2] * factor))


def tint(rgb: Tuple[int, int, int], amount: float) -> Tuple[int, int, int]:
    return (
        clamp(rgb[0] + (255 - rgb[0]) * amount),
        clamp(rgb[1] + (255 - rgb[1]) * amount),
        clamp(rgb[2] + (255 - rgb[2]) * amount),
    )


def apply_fabric_shading(base_img: Image.Image, base_rgb: Tuple[int, int, int], seed_val: int) -> Image.Image:
    """Agrega textura textil sutil y sombreado cilindrico sobre los pixeles con alpha > 0."""
    w, h = base_img.size
    px = base_img.load()
    for y in range(h):
        vy = (y / h) - 0.5
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            vx = (x - w / 2.0) / (w * 0.36)
            cyl = math.cos(min(1.0, abs(vx)) * 1.15) * 0.14 - 0.05
            fold = math.sin((x * 0.11) + (y * 0.03) + seed_val) * 0.025
            weave = (((x * 17 + y * 31 + seed_val) % 19) - 9) * 0.0035
            delta = cyl + fold + weave - (vy * 0.06)
            nr = clamp(r * (1.0 + delta))
            ng = clamp(g * (1.0 + delta))
            nb = clamp(b * (1.0 + delta))
            px[x, y] = (nr, ng, nb, a)
    return base_img


def draw_garment_ar(tipo: str, color_name: str, rgb: Tuple[int, int, int]) -> Image.Image:
    img = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    border = shade(rgb, 0.68)
    dark = shade(rgb, 0.82)
    light = tint(rgb, 0.18)

    if tipo == "blusa":
        poly = [
            (150, 72), (175, 118), (200, 146), (225, 118), (250, 72),
            (292, 96), (332, 165), (318, 188), (292, 178), (266, 144),
            (262, 238), (268, 430), (132, 430), (138, 238), (134, 144),
            (108, 178), (82, 188), (68, 165), (108, 96),
        ]
        draw.polygon(poly, fill=(*rgb, 255), outline=(*border, 255))
        draw.line([(200, 146), (200, 428)], fill=(*dark, 235), width=3)
        draw.arc([148, 175, 252, 255], start=15, end=165, fill=(*border, 200), width=2)

    elif tipo == "camiseta":
        poly = [
            (146, 78), (168, 102), (200, 110), (232, 102), (254, 78),
            (312, 108), (334, 152), (298, 182), (264, 154), (262, 438),
            (138, 438), (136, 154), (102, 182), (66, 152), (88, 108),
        ]
        draw.polygon(poly, fill=(*rgb, 255), outline=(*border, 255))
        draw.arc([158, 66, 242, 122], start=0, end=180, fill=(*border, 240), width=4)
        draw.line([(152, 340), (152, 436)], fill=(*dark, 200), width=2)

    elif tipo == "cartera":
        draw.arc([132, 82, 268, 242], start=180, end=360, fill=(*border, 255), width=10)
        draw.arc([136, 86, 264, 238], start=180, end=360, fill=(*light, 255), width=5)
        body = [
            (96, 186), (304, 186), (318, 412), (294, 438),
            (106, 438), (82, 412),
        ]
        draw.polygon(body, fill=(*rgb, 255), outline=(*border, 255))
        flap = [(96, 186), (304, 186), (282, 294), (200, 314), (118, 294)]
        draw.polygon(flap, fill=(*tint(rgb, 0.07), 255), outline=(*border, 255))
        draw.rectangle([188, 288, 212, 312], fill=(168, 156, 140, 255), outline=(90, 82, 72, 255))

    elif tipo == "chaqueta":
        poly = [
            (146, 68), (176, 118), (200, 154), (224, 118), (254, 68),
            (304, 92), (328, 224), (324, 424), (290, 428), (282, 220),
            (268, 168), (268, 448), (132, 448), (132, 168), (118, 220),
            (110, 428), (76, 424), (72, 224), (96, 92),
        ]
        draw.polygon(poly, fill=(*rgb, 255), outline=(*border, 255))
        draw.polygon([(146, 68), (200, 154), (254, 68), (228, 116), (200, 146), (172, 116)], fill=(*dark, 255))
        draw.line([(200, 154), (200, 446)], fill=(*border, 255), width=3)
        for by in (210, 265, 320, 375):
            draw.ellipse([196, by - 4, 204, by + 4], fill=(230, 226, 218, 255), outline=(*border, 255))

    elif tipo == "falda":
        waist = [(138, 86), (262, 86), (266, 114), (134, 114)]
        skirt = [(134, 114), (266, 114), (308, 444), (200, 456), (92, 444)]
        draw.polygon(skirt, fill=(*rgb, 255), outline=(*border, 255))
        draw.polygon(waist, fill=(*dark, 255), outline=(*border, 255))
        for fx in (165, 200, 235):
            draw.line([(fx, 114), (fx + (fx - 200) * 0.45, 448)], fill=(*border, 210), width=2)

    elif tipo == "pantalon":
        waist = [(132, 62), (268, 62), (270, 92), (130, 92)]
        legs = [
            (130, 92), (270, 92), (284, 468), (218, 468),
            (200, 198), (182, 468), (116, 468),
        ]
        draw.polygon(legs, fill=(*rgb, 255), outline=(*border, 255))
        draw.polygon(waist, fill=(*dark, 255), outline=(*border, 255))
        draw.line([(200, 92), (200, 198)], fill=(*border, 235), width=3)
        draw.line([(156, 110), (152, 464)], fill=(*border, 175), width=2)
        draw.line([(244, 110), (248, 464)], fill=(*border, 175), width=2)

    elif tipo == "vestido":
        poly = [
            (156, 62), (168, 62), (176, 116), (200, 126), (224, 116),
            (232, 62), (244, 62), (252, 146), (240, 214), (306, 462),
            (200, 472), (94, 462), (160, 214), (148, 146),
        ]
        draw.polygon(poly, fill=(*rgb, 255), outline=(*border, 255))
        draw.line([(160, 214), (240, 214)], fill=(*border, 220), width=2)
        draw.line([(200, 214), (172, 466)], fill=(*border, 190), width=2)
        draw.line([(200, 214), (228, 466)], fill=(*border, 190), width=2)

    elif tipo == "zapato":
        def draw_heel(ox: int, oy: int, scale: float = 1.0):
            pts = [
                (ox + int(18 * scale), oy + int(10 * scale)),
                (ox + int(52 * scale), oy + int(58 * scale)),
                (ox + int(124 * scale), oy + int(76 * scale)),
                (ox + int(152 * scale), oy + int(88 * scale)),
                (ox + int(72 * scale), oy + int(94 * scale)),
                (ox + int(32 * scale), oy + int(68 * scale)),
                (ox + int(22 * scale), oy + int(142 * scale)),
                (ox + int(12 * scale), oy + int(142 * scale)),
                (ox + int(10 * scale), oy + int(58 * scale)),
                (ox + int(4 * scale), oy + int(34 * scale)),
            ]
            draw.polygon(pts, fill=(*rgb, 255), outline=(*border, 255))

        draw_heel(58, 170, 1.0)
        draw_heel(184, 265, 1.05)

    seed_val = sum(ord(c) for c in f"{tipo}-{color_name}")
    img = apply_fabric_shading(img, rgb, seed_val)
    return img


def render_studio_photo(ar_img: Image.Image, tipo: str, color_name: str, rgb: Tuple[int, int, int]) -> Image.Image:
    bg = Image.new("RGB", (WIDTH, HEIGHT), (240, 236, 232))
    px = bg.load()
    seed_val = sum(ord(c) for c in f"{tipo}_{color_name}")
    tint_r = 236 + ((seed_val * 3) % 12) - 6
    tint_g = 232 + ((seed_val * 5) % 12) - 6
    tint_b = 228 + ((seed_val * 7) % 14) - 7
    for y in range(HEIGHT):
        fy = y / HEIGHT
        r = clamp(tint_r - fy * 22)
        g = clamp(tint_g - fy * 24)
        b = clamp(tint_b - fy * 20)
        for x in range(WIDTH):
            fx = abs((x / WIDTH) - 0.5) * 14
            px[x, y] = (clamp(r - fx), clamp(g - fx), clamp(b - fx))

    alpha = ar_img.split()[3]
    shadow = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    shadow.paste((25, 22, 20, 88), (10, 14), mask=alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=9))

    comp = bg.convert("RGBA")
    comp = Image.alpha_composite(comp, shadow)
    comp = Image.alpha_composite(comp, ar_img)
    return comp.convert("RGB")


def generate_mobile_icons(mobile_assets_dir: Path) -> None:
    mobile_assets_dir.mkdir(parents=True, exist_ok=True)
    wine_bg = (118, 42, 62, 255)

    # 1. android-icon-background.png (512x512)
    bg_img = Image.new("RGBA", (512, 512), wine_bg)
    bg_img.save(mobile_assets_dir / "android-icon-background.png", format="PNG", optimize=True)

    # Vestido blanco/rosado claro para el icono
    dress_ar = draw_garment_ar("vestido", "rosado", (245, 228, 234))
    dress_scaled = dress_ar.resize((320, 448), Image.Resampling.LANCZOS)

    # 2. android-icon-foreground.png (512x512 transparente con vestido centrado)
    fg_img = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    fg_img.paste(dress_scaled, (96, 32), dress_scaled)
    fg_img.save(mobile_assets_dir / "android-icon-foreground.png", format="PNG", optimize=True)

    # 3. android-icon-monochrome.png (512x512 silueta negra)
    mono_img = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    alpha = dress_scaled.split()[3]
    black_sil = Image.new("RGBA", dress_scaled.size, (15, 15, 18, 255))
    mono_img.paste(black_sil, (96, 32), alpha)
    mono_img.save(mobile_assets_dir / "android-icon-monochrome.png", format="PNG", optimize=True)

    # 4. icon.png (512x512 fondo vino + vestido)
    icon_img = Image.new("RGBA", (512, 512), wine_bg)
    icon_img.paste(dress_scaled, (96, 32), dress_scaled)
    icon_img.save(mobile_assets_dir / "icon.png", format="PNG", optimize=True)

    # 5. favicon.png (64x64)
    fav_img = icon_img.resize((64, 64), Image.Resampling.LANCZOS)
    fav_img.save(mobile_assets_dir / "favicon.png", format="PNG", optimize=True)

    # 6. splash-icon.png (512x512)
    splash_img = Image.new("RGBA", (512, 512), (248, 246, 250, 255))
    sdraw = ImageDraw.Draw(splash_img)
    for g in range(64, 460, 64):
        sdraw.line([(g, 32), (g, 480)], fill=(210, 210, 216, 180), width=1)
        sdraw.line([(32, g), (480, g)], fill=(210, 210, 216, 180), width=1)
    for rad in (70, 120, 165):
        sdraw.ellipse([256 - rad, 256 - rad, 256 + rad, 256 + rad], outline=(180, 182, 188, 220), width=3)
    splash_img.save(mobile_assets_dir / "splash-icon.png", format="PNG", optimize=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Genera los 192 recursos de prendas y AR de FashionStore.")
    parser.add_argument(
        "--out-dir",
        default=str(Path(__file__).resolve().parent.parent / "backend-nest" / "public" / "assets" / "prendas"),
        help="Directorio de salida para las 192 imagenes de prendas",
    )
    parser.add_argument(
        "--mobile-assets-dir",
        default=str(Path(__file__).resolve().parent.parent / "mobile-app" / "assets"),
        help="Directorio de salida para los 6 iconos de mobile-app",
    )
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    total = 0
    for tipo in TIPOS:
        for color_name, rgb in COLORES.items():
            ar_img = draw_garment_ar(tipo, color_name, rgb)
            ar_path = out_dir / f"{tipo}-{color_name}-ar.png"
            ar_img.save(ar_path, format="PNG", compress_level=6)

            foto_img = render_studio_photo(ar_img, tipo, color_name, rgb)
            foto_path = out_dir / f"{tipo}-{color_name}-foto.jpg"
            foto_img.save(foto_path, format="JPEG", quality=88, optimize=True)
            total += 2

    generate_mobile_icons(Path(args.mobile_assets_dir))
    print(f"[OK] Generados {total} archivos de prendas en {out_dir} y 6 iconos moviles.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
