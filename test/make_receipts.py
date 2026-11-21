"""Generate synthetic, photo-like receipt images (DE + IT) for OCR/parser testing."""
import math, random, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

random.seed(7)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

RECEIPTS = {
 "lidl_de": [
  ("C", "LIDL", True), ("C", "Lidl Vertriebs GmbH & Co. KG"), ("C", "Friedrichstr. 120"), ("C", "10117 Berlin"), ("", ""),
  ("R", "EUR"),
  ("LR", "Bio Bananen", "1,29 A"),
  ("L", "  0,646 kg x 1,99 EUR/kg"),
  ("LR", "Vollmilch 3,5% 1L", "1,09 A"),
  ("LR", "Gouda jung Scheiben", "1,79 A"),
  ("L", "  2 x 0,79"),
  ("LR", "Spaghetti 500g", "1,58 A"),
  ("LR", "Mineralwasser 1,5L", "0,25 B"),
  ("LR", "Pfand", "0,25 B"),
  ("LR", "Rabatt Gouda", "-0,30"),
  ("LR", "Toilettenpapier 8x", "3,49 B"),
  ("", ""), ("LR", "zu zahlen", "9,44", True),
  ("LR", "Kartenzahlung girocard", "9,44"),
  ("", ""), ("L", "MWST%    MWST   +  Netto  =  Brutto"), ("L", "A 7 %    0,37      5,30      5,67"),
  ("", ""), ("L", "21.11.2026 10:42   4711 03/12"),
 ],
 "rewe_de": [
  ("C", "REWE", True), ("C", "REWE Markt GmbH"), ("C", "Kastanienallee 12"), ("C", "10435 Berlin"), ("C", "UID Nr.: DE812706034"), ("", ""),
  ("R", "EUR"),
  ("LR", "H-MILCH 3,5%", "1,19 B"),
  ("LR", "BANANE", "1,78 B"),
  ("L", "   2 Stk x   0,89"),
  ("LR", "TOMATEN RISPEN", "1,51 B"),
  ("L", "   0,756 kg x  1,99 EUR/kg"),
  ("LR", "JA! BUTTER 250G", "2,29 B"),
  ("LR", "COCA COLA 1,0L", "1,49 A"),
  ("LR", "PFAND 0,25 EURO", "0,25 A"),
  ("LR", "BAGUETTE", "0,99 B"),
  ("L", "-" * 38),
  ("LR", "SUMME", "EUR 9,50", True),
  ("L", "=" * 38),
  ("LR", "Geg. EC-Cash", "EUR 9,50"),
  ("", ""), ("L", "Datum: 19.11.2026"), ("L", "Uhrzeit: 18:03:22 Uhr"),
 ],
 "esselunga_it": [
  ("C", "esselunga", True), ("C", "ESSELUNGA S.P.A."), ("C", "VIA GIAMBOLOGNA 1"), ("C", "20090 LIMITO DI PIOLTELLO (MI)"),
  ("C", "P.IVA 04916380159"), ("", ""),
  ("C", "DOCUMENTO COMMERCIALE"), ("C", "di vendita o prestazione"),
  ("L", "DESCRIZIONE              IVA  Prezzo(€)"),
  ("LR", "LATTE PS ESSELUNGA 1L    4%", "1,29"),
  ("LR", "BANANE CHIQUITA          4%", "1,62"),
  ("L", "  KG 0,812 X 1,99 €/KG"),
  ("LR", "MOZZARELLA S.LUCIA      4%", "0,99"),
  ("LR", "PASTA BARILLA PENNE     10%", "1,58"),
  ("L", "  2 X 0,79"),
  ("LR", "SCONTO", "-0,30"),
  ("LR", "ACQUA SAN BENEDETTO 6X 22%", "2,49"),
  ("LR", "DETERSIVO PIATTI SVELTO 22%", "1,99"),
  ("", ""),
  ("LR", "TOTALE COMPLESSIVO", "9,66", True),
  ("LR", "DI CUI IVA", "1,02"),
  ("LR", "Pagamento elettronico", "9,66"),
  ("LR", "Importo pagato", "9,66"),
  ("", ""), ("L", "20-11-2026 17:21"), ("L", "DOCUMENTO N. 0412-0087"),
 ],
 "conad_it": [
  ("C", "CONAD", True), ("C", "SUPERSTORE"), ("C", "Via Roma 45 - 39100 Bolzano"), ("C", "P.IVA 02345678901"), ("", ""),
  ("C", "DOCUMENTO COMMERCIALE"),
  ("L", "DESCRIZIONE               IVA  Prezzo(€)"),
  ("LR", "PANE CASERECCIO          4%", "2,10"),
  ("LR", "PROSCIUTTO COTTO         10%", "3,45"),
  ("LR", "POMODORI DATTERINI       4%", "1,99"),
  ("LR", "PARMIGIANO REGG. 24M     4%", "5,90"),
  ("LR", "VINO ROSSO CHIANTI      22%", "6,49"),
  ("LR", "OLIO EXTRA VERGINE 1L   4%", "8,99"),
  ("", ""),
  ("LR", "SUBTOTALE", "28,92"),
  ("LR", "SCONTO CARTA INSIEME", "-1,00"),
  ("LR", "TOTALE EURO", "27,92", True),
  ("LR", "CONTANTI", "30,00"), ("LR", "RESTO", "2,08"),
  ("", ""), ("L", "15/11/2026 11:05"),
 ],
}

W = 560  # receipt paper width in px

def render(lines):
    f = ImageFont.truetype(FONT, 22); fb = ImageFont.truetype(FONT_B, 40)
    h = 40 + sum(52 if (len(l) > 2 and l[-1] is True and l[0] == "C") else 30 for l in lines) + 40
    img = Image.new("L", (W, h), 250)
    d = ImageDraw.Draw(img)
    y = 30
    for l in lines:
        kind = l[0]
        big = l[-1] is True
        font = fb if (big and kind == "C") else (ImageFont.truetype(FONT_B, 22) if big else f)
        if kind == "C":
            t = l[1]; tw = d.textlength(t, font=font); d.text(((W - tw) / 2, y), t, font=font, fill=25)
        elif kind == "R":
            t = l[1]; tw = d.textlength(t, font=font); d.text((W - 24 - tw, y), t, font=font, fill=25)
        elif kind == "L":
            d.text((20, y), l[1], font=font, fill=25)
        elif kind == "LR":
            d.text((20, y), l[1], font=font, fill=25)
            tw = d.textlength(l[2], font=font); d.text((W - 24 - tw, y), l[2], font=font, fill=25)
        y += 52 if (big and kind == "C") else 30
    return img

def photo(rec, angle, persp=0.04, blur=0.9, seed=0):
    rnd = random.Random(seed)
    rec = rec.convert("RGB")
    # scale like a phone photo
    s = 1.9
    rec = rec.resize((int(rec.width * s), int(rec.height * s)), Image.BICUBIC)
    bw, bh = rec.width + 500, rec.height + 420
    bg = np.zeros((bh, bw, 3), np.float32)
    yy, xx = np.mgrid[0:bh, 0:bw]
    bg[..., 0] = 95 + 25 * np.sin(xx / 37.0) + 10 * np.sin(yy / 13.0)
    bg[..., 1] = 70 + 18 * np.sin(xx / 37.0)
    bg[..., 2] = 45 + 10 * np.sin(xx / 37.0)
    bgim = Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8))
    rr = rec.rotate(angle, expand=True, fillcolor=(0, 0, 0), resample=Image.BICUBIC)
    mask = Image.new("L", rec.size, 255).rotate(angle, expand=True, fillcolor=0)
    ox, oy = (bw - rr.width) // 2, (bh - rr.height) // 2
    bgim.paste(rr, (ox, oy), mask)
    # perspective
    w, h = bgim.size
    dx, dy = persp * w, persp * h
    coeffs = find_coeffs([(0, 0), (w, 0), (w, h), (0, h)],
                         [(rnd.uniform(0, dx), rnd.uniform(0, dy)), (w - rnd.uniform(0, dx), rnd.uniform(0, dy)),
                          (w - rnd.uniform(0, dx), h - rnd.uniform(0, dy)), (rnd.uniform(0, dx), h - rnd.uniform(0, dy))])
    bgim = bgim.transform((w, h), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    a = np.asarray(bgim).astype(np.float32)
    # lighting gradient + shadow
    shade = 0.62 + 0.38 * (xx[:h, :w] / w) ** 0.8
    shade *= 1 - 0.25 * np.exp(-((yy[:h, :w] - h * 0.7) ** 2) / (2 * (h * 0.08) ** 2))
    a *= shade[..., None]
    a += np.random.default_rng(seed).normal(0, 6, a.shape)
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))
    return out

def find_coeffs(pa, pb):
    m = []
    for p1, p2 in zip(pa, pb):
        m.append([p1[0], p1[1], 1, 0, 0, 0, -p2[0] * p1[0], -p2[0] * p1[1]])
        m.append([0, 0, 0, p1[0], p1[1], 1, -p2[1] * p1[0], -p2[1] * p1[1]])
    A = np.array(m, dtype=np.float64); B = np.array(pb, dtype=np.float64).reshape(8)
    return np.linalg.solve(A, B).tolist()

if __name__ == "__main__":
    out = sys.argv[1]
    for i, (name, lines) in enumerate(RECEIPTS.items()):
        img = photo(render(lines), angle=random.uniform(-4, 4), seed=i)
        img.save(f"{out}/{name}.jpg", quality=88)
        print(name, img.size)
