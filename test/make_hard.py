import make_receipts as m, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np
orig = m.render
def faded(lines):
    im = orig(lines)
    a = np.asarray(im).astype(np.float32)
    # fade ink: text 25 -> ~120, uneven fade across the paper
    h, w = a.shape
    fade = 0.45 + 0.25 * np.linspace(0, 1, w)[None, :] + 0.1 * np.sin(np.linspace(0, 9, h))[:, None]
    a = 250 - (250 - a) * fade
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
m.render = faded
for i, (name, lines) in enumerate(m.RECEIPTS.items()):
    img = m.photo(m.render(lines), angle=random.uniform(-6, 6), persp=0.07, blur=1.5, seed=10 + i)
    img = img.resize((int(img.width * 0.72), int(img.height * 0.72)), Image.BILINEAR)
    img.save(f"img/hard_{name}.jpg", quality=70)
