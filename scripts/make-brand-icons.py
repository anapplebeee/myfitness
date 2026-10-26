"""
生成品牌图标。

品牌：练迹。黑底 + 酸橙「练」字，与应用内 brand mark 一致。

为什么要脚本而不是手工切图：图标有 9 个尺寸（PWA 3 个 + Android 6 个），
手改必然漏。而且改了品牌只改字，脚本重跑即可。

用法：python scripts/make-brand-icons.py
"""

from PIL import Image, ImageDraw, ImageFont
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

INK = (17, 20, 17)
LIME = (201, 245, 63)
FONT_PATH = r"C:\Windows\Fonts\msyhbd.ttc"
CHAR = "练"


def rounded(size: int, radius_ratio: float) -> Image.Image:
    """黑底圆角方块。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * radius_ratio)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=INK)
    return img


def draw_char(img: Image.Image, scale: float = 0.56) -> Image.Image:
    """
    在图中居中写字。

    scale 是字号占画布比例。0.56 是在圆形/圆角遮罩下不裁到笔画的值，
    试过 0.62 会顶到边。
    """
    size = img.width
    font = ImageFont.truetype(FONT_PATH, int(size * scale))
    d = ImageDraw.Draw(img)
    bbox = d.textbbox((0, 0), CHAR, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    # 文本基线通常带偏移，按 bbox 精确居中
    x = (size - w) / 2 - bbox[0]
    y = (size - h) / 2 - bbox[1]
    d.text((x, y), CHAR, font=font, fill=LIME)
    return img


def make_icon(size: int, radius_ratio: float = 0.22) -> Image.Image:
    return draw_char(rounded(size, radius_ratio))


def make_maskable(size: int) -> Image.Image:
    """
    Maskable 图标：内容必须留在中心 80% 安全区，四周可能被系统裁掉。
    所以这里画满底、字缩到 0.44。
    """
    img = Image.new("RGBA", (size, size), INK)
    return draw_char(img, scale=0.44)


def make_foreground(size: int) -> Image.Image:
    """
    Android 自适应图标的前景层：透明底 + 居中字，
    字要留在 66% 安全区（系统会裁成圆形/方形）。
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    return draw_char(img, scale=0.42)


def main() -> None:
    icons_dir = os.path.join(ROOT, "icons")
    os.makedirs(icons_dir, exist_ok=True)

    # PWA
    for s in (192, 512):
        make_icon(s).save(os.path.join(icons_dir, f"icon-{s}.png"))
    make_maskable(512).save(os.path.join(icons_dir, "maskable-512.png"))
    make_icon(180, radius_ratio=0.0).save(os.path.join(icons_dir, "apple-touch-icon.png"))

    # Android 传统图标
    density = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    res = os.path.join(ROOT, "android", "app", "src", "main", "res")
    for folder, size in density.items():
        d = os.path.join(res, folder)
        os.makedirs(d, exist_ok=True)
        make_icon(size).save(os.path.join(d, "ic_launcher.png"))
        # round 版本：圆底
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        dr = ImageDraw.Draw(img)
        dr.ellipse([0, 0, size - 1, size - 1], fill=INK)
        draw_char(img).save(os.path.join(d, "ic_launcher_round.png"))

    # 自适应图标前景（108dp 基准 × 4 倍 = 432）
    #
    # 必须同时写 mipmap-* 和 drawable-*：
    # adaptive-icon XML 引用的是 @mipmap/ic_launcher_foreground，
    # 只写 drawable-* 的话桌面仍显示 Capacitor 的默认前景图。
    foreground_density = {
        "mdpi": 108,
        "hdpi": 162,
        "xhdpi": 216,
        "xxhdpi": 324,
        "xxxhdpi": 432,
    }
    for dens, size in foreground_density.items():
        for base in ("mipmap", "drawable"):
            d = os.path.join(res, f"{base}-{dens}")
            os.makedirs(d, exist_ok=True)
            make_foreground(size).save(os.path.join(d, "ic_launcher_foreground.png"))

    print("图标已生成：PWA 4 个 + Android 传统 10 个 + 自适应前景 10 个")

    # 启动图 logo。
    #
    # 原来是一张白色「铁」字 PNG，是为旧的青绿启动背景配的；
    # 背景改成浅纸色之后，白字直接看不见。
    # 这里改成品牌图标本体（黑底 + 酸橙字），在浅色和深色启动背景上都成立。
    splash = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    mark = make_icon(288, radius_ratio=0.26)
    splash.paste(mark, ((512 - 288) // 2, (512 - 288) // 2), mark)
    splash.save(os.path.join(res, "drawable-nodpi", "splash_logo.png"))
    print("启动图 logo 已更新")


if __name__ == "__main__":
    main()
