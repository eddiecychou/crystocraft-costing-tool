"""Fictional local-only cards/PDF for customer-files-browser.mjs. No real PII.

Requires Pillow/reportlab. Keeps an existing fixture set to preserve QA evidence;
remove only your generated fixture directory before intentionally regenerating.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4

root = Path('qa/out/customer-files/fixtures')
root.mkdir(parents=True, exist_ok=True)
names = ['Cindy & Tony 中文 🎁 - front.png', 'Cindy & Tony 中文 🎁 - back.png',
         'Customer reference 中文 & specifications.pdf']
if all((root / name).exists() for name in names):
    print('Existing fictional fixtures retained unchanged.')
    raise SystemExit(0)
font_path = Path('/System/Library/Fonts/Supplemental/Arial.ttf')
font = ImageFont.truetype(str(font_path), 30) if font_path.exists() else ImageFont.load_default()
for name, title, side in [(names[0], 'QA ONLY - CINDY', 'FRONT'), (names[1], 'QA ONLY - TONY', 'BACK')]:
    image = Image.new('RGB', (1000, 600), 'white')
    draw = ImageDraw.Draw(image)
    draw.rectangle((30, 30, 970, 570), outline='#6E2433', width=3)
    draw.text((70, 100), title, font=font, fill='#222')
    draw.text((70, 180), 'Fictional business card - ' + side, font=font, fill='#666')
    draw.text((70, 270), 'Not a real person or customer record', font=font, fill='#666')
    image.save(root / name)
pdf = canvas.Canvas(str(root / names[2]), pagesize=A4, invariant=1)
pdf.setTitle('QA ONLY fictional customer reference')
# A valid, two-page PDF larger than one binary chunk; no huge page count needed.
pdf.setSubject('QA ONLY - preserved large original. ' + ('abcdef0123456789' * 205000))
for page in [1, 2]:
    pdf.setFont('Helvetica', 18)
    pdf.drawString(45, 780, 'QA ONLY - FICTIONAL CUSTOMER DOCUMENT')
    pdf.setFont('Helvetica', 12)
    pdf.drawString(45, 740, f'Page {page} of 2 - local upload/preview/download test')
    pdf.drawString(45, 710, 'Cindy and Tony are fictional demonstration contacts.')
    pdf.drawString(45, 680, 'No contact changes, marketing enrollment or outreach.')
    pdf.showPage()
pdf.save()
print('Created two fictional PNG originals and one two-page PDF larger than 3 MiB.')
