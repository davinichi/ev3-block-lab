from pathlib import Path
import io,json
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.pagesizes import A4
from pypdf import PdfReader,PdfWriter
w=Path('D:/Codex/Files/2026-11-27/common-numeric-width')
ja='数値入力欄では、全角の数字・マイナス・小数点を半角へ自動変換します。例：－１２．５ → -12.5。変換時は編集エリア上部に「半角に直しました」と約4秒表示します。日本語入力の変換中は書き換えず、確定後に直します。変数名・マイブロック名・文字列は変換しません。数値の範囲や整数指定など、従来の入力制限と保存形式は維持します。'
en='Numeric fields automatically convert full-width digits, minus signs and decimal points to half-width characters. For example, －１２．５ becomes -12.5. A notice appears above the editor for about four seconds. IME composition is left untouched until committed. Names and text strings are not converted. Existing numeric limits and project formats are retained.'
pdfmetrics.registerFont(TTFont('JP','C:/Windows/Fonts/meiryo.ttc',subfontIndex=0))
style=ParagraphStyle('text',fontName='JP',fontSize=11,leading=20,wordWrap='CJK',spaceAfter=18)
b=io.BytesIO();SimpleDocTemplate(b,pagesize=A4,rightMargin=45,leftMargin=45,topMargin=45).build([Paragraph('数値入力の全角・半角 / 2026-11-27',style),Paragraph('EBL Web・EBL-RT Web・EBL-RT Windows 共通',style),Paragraph(ja,style),Paragraph('Full-width numeric input',style),Paragraph(en,style),Paragraph('実機転送・走行は今回の検証対象外です。 / Additional physical hardware tests were not performed.',style)])
(w/'numeric-input-guide.pdf').write_bytes(b.getvalue())
section='<section id="numeric-input-fullwidth1"><h2>数値入力の全角・半角（2026-11-27）</h2><p>'+ja+'</p><h3>Full-width numeric input</h3><p>'+en+'</p><p><a href="'+ 'numeric-input-guide.pdf' +'">追補PDF / Supplement PDF</a></p></section>'
(w/'section.html').write_bytes(section.encode())
for root in ['D:/Codex/Files/2026-11-26/connection-buttons/ebl/.sites-checkout','D:/Codex/Files/2026-11-26/ebl-language/ebl-rt/.sites-checkout']:
 r=Path(root);d=r/'dist';(d/'numeric-input-guide.pdf').write_bytes(b.getvalue());(d/'numeric-input-guide.html').write_bytes(('<!doctype html><html lang="ja"><meta charset="utf-8"><title>数値入力の全角・半角</title><style>body{font:18px/1.8 Meiryo,sans-serif;max-width:850px;margin:30px auto;padding:20px;color:#243b47}</style><a href="index.html">編集画面に戻る</a>'+section+'</html>').encode())
 files=[d/'classroom-ui-guide.html',d/'common-editor-update.html',d/'manual/EV3-Block-Lab-Manual-v0.25.6-en.html',d/'manual/EBL-Manual-v0.25.6.html',*d.glob('manual/*ブロック命令*v0.25.6.html')]
 if (d/'manual/EBLRT-Guide-v0.34.3.html').exists():files +=[d/'manual/EBLRT-Guide-v0.34.3.html',d/'manual/EBLRT-Windows-0.3.6-Guide.html']
 for p in files:
  if not p.exists():continue
  sec=section.replace('href="numeric-input-guide.pdf"','href="../numeric-input-guide.pdf"') if p.parent.name=='manual' else section
  s=p.read_bytes().decode();assert 'numeric-input-fullwidth1' not in s;p.write_bytes(s.replace('</html>',sec+'</html>',1).encode())
  pdf=p.with_suffix('.pdf')
  if pdf.exists():
   out=io.BytesIO();writer=PdfWriter();writer.append(PdfReader(io.BytesIO(pdf.read_bytes())));writer.append(PdfReader(io.BytesIO(b.getvalue())));writer.write(out);pdf.write_bytes(out.getvalue())
 p=d/'index.html';s=p.read_bytes().decode();s=s.replace('<div class="menu-heading">','<div class="menu-heading">')
 anchor='<a href="classroom-ui-guide.html"';i=s.index(anchor);s=s[:i]+'<a href="numeric-input-guide.html" target="_blank" rel="noopener">数値入力の全角・半角</a>'+s[i:]
 i=s.index('id="helpDialog"');pos=s.index('>',i)+1;s=s[:pos]+section+s[pos:];p.write_bytes(s.encode())
 p=d/'locale-en.js';p.write_bytes(p.read_bytes()+"\nObject.assign(catalog.text,{'数値入力の全角・半角':'Full-width numeric input'});\n".encode())
 p=d/'i18n.js';s=p.read_bytes().decode();s=s.replace('15 pages','16 pages').replace('全15ページ','全16ページ').replace('22 pages','23 pages').replace('42ページ','43ページ');p.write_bytes(s.encode())
 p=r/'tests/desktop-manual-links.test.mjs'
 if p.exists():p.write_bytes(p.read_bytes().replace(b'15 pages',b'16 pages'))
 (r/'docs/numeric-input-20261127.md').write_bytes(('# 数値入力の全角・半角\n\n'+ja+'\n\n'+en+'\n\nUI revision: fullwidth1. 実機未確認。\n').encode())
 print('Updated manuals',r)
