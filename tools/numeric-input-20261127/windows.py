from pathlib import Path
import zipfile,hashlib,json,re
w=Path('D:/Codex/Files/2026-11-27/common-numeric-width');r=Path('D:/Codex/Files/2026-11-26/ebl-language/ebl-rt/.sites-checkout');d=r/'dist/downloads';m=json.loads((d/'windows-0.3.6.json').read_bytes());base=w/'windows-before.zip'
with base.open('wb') as stream:
 for part in m['parts']:
  data=(r/'dist'/part['path']).read_bytes();assert hashlib.sha256(data).hexdigest()==part['sha256'];stream.write(data)
assert hashlib.sha256(base.read_bytes()).hexdigest()==m['sha256']
prefix='EBL-RT-Windows-0.3.6/';rel='resources/app/dist/';changes={}
with zipfile.ZipFile(base) as z:
 s=z.read(prefix+rel+'app.js').decode();s="import {installNumericTextNormalization} from './numeric-text.js?v=fullwidth1'; "+s
 pos=s.index('\nfunction feedback(',s.index('const notices=installNotices'));s=s[:pos]+"\ninstallNumericTextNormalization(Blockly,{document,notice:$('numberInputNotice'),message:()=>uiText('半角に直しました')});"+s[pos:];changes[rel+'app.js']=s.encode();(w/'windows-app.js').write_bytes(s.encode())
 s=z.read(prefix+rel+'index.html').decode().replace('<div id="programNotice"','<span id="numberInputNotice" class="number-input-notice" role="status" aria-live="polite" hidden></span><div id="programNotice"').replace('hint-label1','fullwidth1').replace('english-20261126','fullwidth1')
 anchor='<a href="classroom-ui-guide.html"';i=s.index(anchor);s=s[:i]+'<a href="numeric-input-guide.html" target="_blank" rel="noopener">数値入力の全角・半角</a>'+s[i:]
 section=(w/'section.html').read_text(encoding='utf-8');i=s.index('id="helpDialog"');pos=s.index('>',i)+1;s=s[:pos]+section+s[pos:];changes[rel+'index.html']=s.encode()
 changes[rel+'numeric-text.js']=(r/'dist/numeric-text.js').read_bytes()
 s=z.read(prefix+rel+'i18n-bootstrap.js').decode().replace('english-20261126','fullwidth1');changes[rel+'i18n-bootstrap.js']=s.encode()
 changes[rel+'classroom-ui.css']=z.read(prefix+rel+'classroom-ui.css')+b'\n.number-input-notice{font-size:16px;line-height:1.5;font-weight:700;color:#126c67;background:#e7f5f0;padding:4px 10px;border-radius:5px}.number-input-notice[hidden]{display:none}\n'
 changes[rel+'locale-en.js']=z.read(prefix+rel+'locale-en.js')+"\nObject.assign(catalog.text,{'半角に直しました':'Converted to half-width characters','数値入力の全角・半角':'Full-width numeric input'});\n".encode()
 for file in ['i18n.js','classroom-ui-guide.html','numeric-input-guide.html','numeric-input-guide.pdf','manual/EBLRT-Guide-v0.34.3.html','manual/EBLRT-Guide-v0.34.3.pdf','manual/EBLRT-Windows-0.3.6-Guide.html','manual/EBLRT-Windows-0.3.6-Guide.pdf','manual/EBL-Manual-v0.25.6.html','manual/EBL-Manual-v0.25.6.pdf','manual/EV3-Block-Lab-Manual-v0.25.6-en.html','manual/EV3-Block-Lab-Manual-v0.25.6-en.pdf']:
  if (r/'dist'/file).exists():changes[rel+file]=(r/'dist'/file).read_bytes()
 changes['UI-REVISION.txt']=z.read(prefix+'UI-REVISION.txt')+b'\n2026-11-27-fullwidth1: Full-width numeric input normalization and notices; green theme retained.\n'
 changes['UPDATE-README.txt']=z.read(prefix+'UPDATE-README.txt')+b'\nfullwidth1: Close EBL-RT before extracting. Numeric input converts full-width digits, minus and decimal points after IME composition. Projects and runtime/setup files are preserved.\n'
for filename,pre,old in [('EBL-RT-Windows-0.3.6.zip',prefix,base),('EBL-RT-Windows-0.3.6-Update.zip','',d/'EBL-RT-Windows-0.3.6-Update.zip')]:
 out=w/filename
 with zipfile.ZipFile(old) as src,zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as dest:
  found=set()
  for info in src.infolist():
   name=info.filename[len(pre):] if pre else info.filename;dest.writestr(info,changes.get(name,src.read(info)));found.add(name)
  for name,data in changes.items():
   if name not in found:dest.writestr(pre+name,data)
 with zipfile.ZipFile(old) as src,zipfile.ZipFile(out) as dest:
  assert dest.testzip() is None
  for name,data in changes.items():assert dest.read(pre+name)==data
  for info in src.infolist():
   name=info.filename[len(pre):] if pre else info.filename
   if name not in changes:assert src.read(info)==dest.read(info.filename),name
 print(filename,'verified')
full=w/'EBL-RT-Windows-0.3.6.zip';m.update(bytes=full.stat().st_size,sha256=hashlib.sha256(full.read_bytes()).hexdigest(),uiRevision='2026-11-27-green1-hint-label1-fullwidth1',documentationRevision='2026-11-27-fullwidth1',parts=[])
(w/'parts').mkdir(exist_ok=True)
with full.open('rb') as stream:
 i=0
 while data:=stream.read(20*1024*1024):
  i+=1;name=f'part-{i:03}.bin';(w/'parts'/name).write_bytes(data);m['parts'].append({'path':'downloads/windows-0.3.6/'+name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
(w/'windows-0.3.6.json').write_bytes((json.dumps(m,indent=2)+'\n').encode())
for name in ['EBL-RT-Windows-0.3.6.zip','EBL-RT-Windows-0.3.6-Update.zip']:(w/(name+'.sha256.txt')).write_bytes((hashlib.sha256((w/name).read_bytes()).hexdigest()+'  '+name+'\n').encode())
(w/'windows-verification.json').write_bytes(json.dumps({'changed':list(changes),'unchangedFilesVerified':True,'zipCRCVerified':True,'revision':m['uiRevision']},indent=2).encode())
