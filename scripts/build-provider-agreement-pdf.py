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
import json
import base64
from lxml import html
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, Flowable

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--font-dir', type=Path, default=Path('C:/Windows/Fonts'))
parser.add_argument('--sandbox-template', action='store_true', help='Export a separate sandbox-only PDF and DocuSign field definitions')
args = parser.parse_args()
field_positions = []
field_names = {
    'AGREEMENT_ID': ('AgreementId', 'Agreement reference', '2'),
    'PROVIDER_LEGAL_NAME': ('ProviderLegalName', 'Provider legal name', '2'),
    'PROVIDER_EMAIL': ('ProviderEmail', 'Provider email', '2'),
    'PROVIDER_ACCOUNT_ID': ('ProviderAccountId', 'FastBoost account ID', '2'),
    'EFFECTIVE_DATE': ('EffectiveDate', 'Requested effective date', '2'),
    'SIGNATORY_NAME_AND_TITLE / NOT APPLICABLE': ('AuthorizedSignatory', 'Business signatory, or Not applicable', '1'),
    'WORK_COUNTRY_AND_STATE_OR_PROVINCE': ('WorkLocation', 'Work country and state / province', '1'),
    'END_DATE_OR_ONGOING': ('EndDate', 'End date, or Ongoing', '1'),
    'PAYMENT_METHOD': ('PaymentMethod', 'Payment method', '1'),
    'PAYEE_LEGAL_NAME': ('PayeeLegalName', 'Verified payee legal name', '1'),
    'PAYOUT_CURRENCY_CODE': ('PayoutCurrency', 'Payout currency code', '1'),
    'NO CONVERSION / AGREED RATE SOURCE AND QUOTE TIMING': ('ConversionRule', 'No conversion, or rate source and quote timing', '1'),
    'NONE / WRITTEN REPLACEMENT RULE': ('TransferFeeVariation', 'None, or agreed replacement fee rule', '1'),
    'GAMES / SERVICES / REGIONS / PERMITTED METHODS': ('ServiceScope', 'Games, services, regions and permitted methods', '1'),
    'PROVIDER_TIME_ZONE': ('ProviderTimeZone', 'Provider time zone', '1'),
    'COUNTRIES': ('DataAccessCountries', 'Approved data-access countries', '1'),
    'ENGLISH / IDENTIFY REVIEWED TRANSLATION AND AGREED CONFLICT RULE': ('ReferenceLanguage', 'English, or translation and conflict rule', '1'),
    'NONE AFTER LOCAL REVIEW / IDENTIFIED SIGNED ADDENDUM': ('JurisdictionAddendum', 'None after review, or identified signed addendum', '1'),
}
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

class SigningField(Flowable):
    """Visible blank plus the exact DocuSign rectangle, without hidden PDF form data."""
    def __init__(self, label, caption, recipient, width=310, height=24, tab_type='textTabs'):
        Flowable.__init__(self)
        self.label, self.caption, self.recipient = label, caption, recipient
        self.width, self.box_height, self.height = width, height, height + 20
        self.tab_type = tab_type

    def draw(self):
        canvas = self.canv
        canvas.setFont('FB', 7.5)
        canvas.setFillColor(muted)
        canvas.drawString(0, self.box_height + 7, self.caption)
        canvas.setStrokeColor(colors.HexColor('#c8bce3'))
        canvas.setFillColor(colors.white)
        canvas.roundRect(0, 0, self.width, self.box_height, 3, stroke=1, fill=1)
        x, y = canvas.absolutePosition(2, self.box_height - 2)
        field_positions.append({'tabLabel': self.label, 'recipientId': self.recipient,
            'documentId': '1', 'pageNumber': str(canvas.getPageNumber()),
            'xPosition': str(round(x)), 'yPosition': str(round(letter[1] - y)),
            'width': str(round(self.width - 4)), 'height': str(round(self.box_height - 4)),
            'type': self.tab_type})

def signing_cell(node):
    content = inline(node)
    parts = re.split(r'(\[[^\]]+\])', content)
    result = []
    for part in parts:
        if part.startswith('[') and part.endswith(']'):
            label, caption, recipient = field_names[entities.unescape(part[1:-1])]
            height = 42 if label in ('ServiceScope', 'ConversionRule', 'JurisdictionAddendum', 'ReferenceLanguage', 'TransferFeeVariation') else 24
            result += [SigningField(label, caption, recipient, height=height), Spacer(1, 5)]
        elif part.strip(' ./;'):
            result += [Paragraph(part, styles['cell']), Spacer(1, 4)]
    return result

def table(node):
    rows = []
    for row in node.xpath('./thead/tr | ./tbody/tr | ./tr'):
        rows.append([signing_cell(cell) if args.sandbox_template and cell.tag != 'th' and '[' in cell.text_content() else para(cell, 'cellhead' if cell.tag == 'th' else 'cell') for cell in row])
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
if args.sandbox_template:
    story += [Paragraph('<b>SANDBOX TEST COPY - NOT FOR REAL CONTRACT EXECUTION.</b> Field layout for integration testing. Commercial settings remain subject to approval.', styles['body'])]
story += [para(tree.xpath('//p[@class="fb-intro"]')[0])]
story += [para(tree.xpath('//div[@class="fb-review"]')[0], 'small')]
story += [Spacer(1, 6)]
for section in tree.xpath('//section[contains(concat(" ",normalize-space(@class)," ")," fb-section ")]'):
    if section.get('id') == 'schedule-a' or (section.get('id') == 'signatures' and not args.sandbox_template):
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
                recipient = '1' if 'FASTBOOST' in card.find('h3').text_content() else '2'
                for p in card.findall('p'):
                    if args.sandbox_template and 'fb-signline' in p.get('class', ''):
                        label = p.text_content().split(':')[0]
                        kind = 'signHereTabs' if label == 'Signature' else 'dateSignedTabs' if label == 'Date' else 'initialHereTabs'
                        cells.append(SigningField(('Company' if recipient == '1' else 'Provider') + kind, label, recipient,
                            width=216, height=46 if kind == 'signHereTabs' else 32, tab_type=kind))
                    elif args.sandbox_template and '[' in p.text_content():
                        cells.append(SigningField('ProviderSignatureName', 'Provider / authorized signatory', recipient, width=216, tab_type='fullNameTabs'))
                    elif 'fb-signline' in p.get('class', ''):
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
    canvas.drawRightString(558, 756, 'FB-PA-1.1 / SANDBOX' if args.sandbox_template else 'FB-PA-1.1')
    canvas.line(54, 46, 558, 46)
    canvas.drawString(54, 32, 'SANDBOX TEST COPY - NOT FOR REAL CONTRACT EXECUTION' if args.sandbox_template else 'Unsigned review draft - complete all required fields before signing')
    canvas.drawRightString(558, 32, f'Page {doc.page}')
    canvas.restoreState()

output = ROOT / ('output/pdf/FastBoost_Provider_Agreement_EN_sandbox.pdf' if args.sandbox_template else 'output/pdf/FastBoost_Provider_Agreement_EN_review.pdf')
output.parent.mkdir(parents=True, exist_ok=True)
doc = SimpleDocTemplate(str(output), pagesize=letter, topMargin=63, bottomMargin=60, leftMargin=54, rightMargin=54,
    title='FastBoost Provider Agreement - FB-PA-1.1 Review Draft', author='FastBoost')
doc.build(story, onFirstPage=page_chrome, onLaterPages=page_chrome)
if args.sandbox_template:
    signers = []
    for recipient, role in [('1', 'FastBoost'), ('2', 'Booster')]:
        tabs = {}
        for field in field_positions:
            if field['recipientId'] != recipient:
                continue
            tab = {k: v for k, v in field.items() if k != 'type'}
            if field['type'] == 'textTabs':
                tab.update(required='true', locked='true' if recipient == '2' else 'false',
                    font='Arial', fontSize='Size10', maxLength='500' if int(field['height']) > 30 else '100')
            elif field['type'] in ('signHereTabs', 'initialHereTabs'):
                tab.update(optional='false', scaleValue='1')
                tab.pop('width'); tab.pop('height')
            tabs.setdefault(field['type'], []).append(tab)
        signers.append({'recipientId': recipient, 'roleName': role, 'routingOrder': recipient, 'tabs': tabs})
    template = {'name': 'FastBoost Provider Agreement FB-PA-1.1 - Sandbox Draft',
        'description': 'Sandbox testing only. Commercial settings pending. FastBoost first, Booster second. Not for real execution.',
        'emailSubject': 'FastBoost Provider Agreement - SANDBOX TEST',
        'documents': [{'documentId': '1', 'name': output.name, 'fileExtension': 'pdf', 'documentBase64': base64.b64encode(output.read_bytes()).decode()}],
        'recipients': {'signers': signers}}
    (output.parent / 'FastBoost_Provider_Agreement_EN_sandbox.template.json').write_text(json.dumps(template, indent=2), encoding='utf8')
    (output.parent / 'FastBoost_Provider_Agreement_EN_sandbox.fields.json').write_text(json.dumps(field_positions, indent=2), encoding='utf8')
else:
    shutil.copyfile(output, ROOT / 'server/private/legal/provider-agreement-review.pdf')
print(output)
