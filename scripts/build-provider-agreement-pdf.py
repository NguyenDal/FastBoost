"""Build the review PDF from the website agreement; requires lxml and reportlab.

Usage: python scripts/build-provider-agreement-pdf.py --font-dir <TTF directory>
The website HTML is the single source of agreement wording. This exports an
unsigned review copy, not an executed agreement or a populated DocuSign template.
"""
from pathlib import Path
import argparse
import html as entities
import re
import shutil
from lxml import html
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--font-dir', type=Path, default=Path('C:/Windows/Fonts'))
args = parser.parse_args()
names = ['LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf', 'LiberationSans-Italic.ttf', 'LiberationSans-BoldItalic.ttf']
if not (args.font_dir / names[0]).exists():
    names = ['arial.ttf', 'arialbd.ttf', 'ariali.ttf', 'arialbi.ttf']
for face, file in zip(['FB', 'FB-Bold', 'FB-Italic', 'FB-BoldItalic'], names):
    pdfmetrics.registerFont(TTFont(face, str(args.font_dir / file)))
pdfmetrics.registerFontFamily('FB', normal='FB', bold='FB-Bold', italic='FB-Italic', boldItalic='FB-BoldItalic')
purple = colors.HexColor('#6740c8')
ink = colors.HexColor('#1a1730')
muted = colors.HexColor('#59566c')
styles = {
    'body': ParagraphStyle('body', fontName='FB', fontSize=10, leading=15, textColor=ink, spaceAfter=10),
    'small': ParagraphStyle('small', fontName='FB', fontSize=8.5, leading=12, textColor=muted, spaceAfter=8),
    'title': ParagraphStyle('title', fontName='FB-Bold', fontSize=27, leading=32, textColor=ink, spaceAfter=14),
    'heading': ParagraphStyle('heading', fontName='FB-Bold', fontSize=14, leading=19, textColor=purple, spaceBefore=16, spaceAfter=10, keepWithNext=True),
    'cell': ParagraphStyle('cell', fontName='FB', fontSize=9, leading=13, textColor=ink),
    'cellhead': ParagraphStyle('cellhead', fontName='FB-Bold', fontSize=9, leading=13, textColor=ink),
}

def clean(text):
    return re.sub(r'[\u2010-\u2015\u2212]', '-', text).replace('\xa0', ' ')

def inline(node):
    result = entities.escape(clean(node.text or ''))
    for child in node:
        content = inline(child)
        if child.tag in ('strong', 'b'):
            result += '<b>' + content + '</b>'
        elif child.tag in ('em', 'i'):
            result += '<i>' + content + '</i>'
        elif child.tag == 'a' and child.get('href', '').startswith(('https://', 'mailto:')):
            result += '<link href="' + entities.escape(child.get('href'), quote=True) + '" color="#6740c8">' + content + '</link>'
        elif child.tag == 'br':
            result += '<br/>'
        else:
            result += content
        result += entities.escape(clean(child.tail or ''))
    return result

def para(node, kind='body'):
    return Paragraph(inline(node), styles[kind])

def table(node):
    rows = []
    for row in node.xpath('./thead/tr | ./tbody/tr | ./tr'):
        rows.append([para(cell, 'cellhead' if cell.tag == 'th' else 'cell') for cell in row])
    tab = Table(rows, colWidths=[170, 334], repeatRows=1, hAlign='LEFT')
    tab.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#eee9fa')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f8f7fc')]),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 10), ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 9), ('BOTTOMPADDING', (0, 0), (-1, -1), 9),
        ('LINEBELOW', (0, 0), (-1, -1), .4, colors.HexColor('#dcd7e8')),
        ('BOX', (0, 0), (-1, -1), .6, colors.HexColor('#dcd7e8')),
    ]))
    tab.spaceAfter = 12
    return [tab]

tree = html.parse(str(ROOT / 'server/private/legal/provider-agreement.html'))
story = [Paragraph('FASTBOOST', ParagraphStyle('brand', fontName='FB-Bold', fontSize=13, textColor=purple, spaceAfter=18))]
story += [para(tree.xpath('//h1')[0], 'title')]
story += [Paragraph('ENGLISH REVIEW DRAFT  |  FB-PA-1.1  |  30 SEPTEMBER 2026', styles['small'])]
story += [para(tree.xpath('//p[@class="fb-intro"]')[0])]
story += [para(tree.xpath('//div[@class="fb-review"]')[0], 'small')]
story += [Spacer(1, 6)]
for section in tree.xpath('//section[contains(concat(" ",normalize-space(@class)," ")," fb-section ")]'):
    if section.get('id') in ('schedule-a', 'signatures'):
        story.append(PageBreak())
    number = section.xpath('.//span[@class="fb-section-number"]')[0].text_content()
    heading = section.xpath('.//h2')[0].text_content()
    story.append(Paragraph(entities.escape(clean(f'{number}  {heading}')), styles['heading']))
    for node in section:
        if node.tag == 'p':
            story.append(para(node, 'small' if 'fb-sources' in node.get('class', '') else 'body'))
        elif node.tag == 'ul':
            for item in node:
                story.append(Paragraph('• ' + inline(item), styles['body']))
        elif node.get('class') == 'fb-table-wrap':
            story.extend(table(node.find('table')))
        elif node.get('class') == 'fb-signatures':
            cards = []
            for card in node:
                cells = [para(card.find('h3'), 'heading')]
                for p in card.findall('p'):
                    if 'fb-signline' in p.get('class', ''):
                        label = p.text_content().split(':')[0]
                        cells.append([Spacer(1, 18), Paragraph(entities.escape(label) + ':', styles['small']), Paragraph('________________________________', styles['body'])])
                    else:
                        cells.append(para(p))
                cards.append(cells)
            signatures = Table(list(zip(*cards)), colWidths=[252, 252], hAlign='LEFT')
            signatures.setStyle(TableStyle([('VALIGN', (0,0),(-1,-1),'TOP'),('BOX',(0,0),(-1,-1),.6,colors.HexColor('#dcd7e8')),('LINEAFTER',(0,0),(0,-1),.6,colors.HexColor('#dcd7e8')),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,-1),(-1,-1),18)]))
            story.append(KeepTogether([Spacer(1, 10), signatures, Spacer(1, 16)]))

def page_chrome(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor('#dcd7e8'))
    canvas.line(54, 746, 558, 746)
    canvas.setFont('FB-Bold', 8)
    canvas.setFillColor(purple)
    canvas.drawString(54, 756, 'FASTBOOST  /  PROVIDER AGREEMENT')
    canvas.setFont('FB', 8)
    canvas.setFillColor(muted)
    canvas.drawRightString(558, 756, 'FB-PA-1.1')
    canvas.line(54, 46, 558, 46)
    canvas.drawString(54, 32, 'Unsigned review draft - complete all required fields before signing')
    canvas.drawRightString(558, 32, f'Page {doc.page}')
    canvas.restoreState()

output = ROOT / 'output/pdf/FastBoost_Provider_Agreement_EN_review.pdf'
output.parent.mkdir(parents=True, exist_ok=True)
doc = SimpleDocTemplate(str(output), pagesize=letter, topMargin=63, bottomMargin=60, leftMargin=54, rightMargin=54,
    title='FastBoost Provider Agreement - FB-PA-1.1 Review Draft', author='FastBoost')
doc.build(story, onFirstPage=page_chrome, onLaterPages=page_chrome)
shutil.copyfile(output, ROOT / 'server/private/legal/provider-agreement-review.pdf')
print(output)
