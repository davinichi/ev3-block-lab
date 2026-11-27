from pathlib import Path
import json
w=Path('D:/Codex/Files/2026-11-27/common-numeric-width')
sbl=Path('D:/Codex/Files/2026-11-22/sbl-number-input/.sites-checkout')
module=(sbl/'numeric-text.js').read_text(encoding='utf-8').replace('notice,setTimer=',"notice,message=()=> '半角に直しました',setTimer=").replace("notice.textContent='半角に直しました'","notice.textContent=message()")
roots=[Path('D:/Codex/Files/2026-11-26/connection-buttons/ebl/.sites-checkout'),Path('D:/Codex/Files/2026-11-26/ebl-language/ebl-rt/.sites-checkout')]
for r in roots:
 d=r/'dist';(d/'numeric-text.js').write_bytes(module.encode())
 p=d/'app.js';s=p.read_bytes().decode();s="import {installNumericTextNormalization} from './numeric-text.js?v=fullwidth1';\n"+s
 pos=s.index('\nfunction feedback(',s.index('const notices=installNotices'))
 s=s[:pos]+"\ninstallNumericTextNormalization(Blockly,{document,notice:$('numberInputNotice'),message:()=>uiText('半角に直しました')});"+s[pos:];p.write_bytes(s.encode())
 p=d/'index.html';s=p.read_bytes().decode().replace('<div id="programNotice"','<span id="numberInputNotice" class="number-input-notice" role="status" aria-live="polite" hidden></span><div id="programNotice"').replace('hint-label1','fullwidth1').replace('english-20261126','fullwidth1');p.write_bytes(s.encode())
 p=d/'i18n-bootstrap.js';s=p.read_bytes().decode().replace('english-20261126','fullwidth1');p.write_bytes(s.encode())
 p=d/'locale-en.js';p.write_bytes(p.read_bytes()+"\nObject.assign(catalog.text,{'半角に直しました':'Converted to half-width characters'});\n".encode())
 p=d/'classroom-ui.css';p.write_bytes(p.read_bytes()+b'\n.number-input-notice{font-size:16px;line-height:1.5;font-weight:700;color:#126c67;background:#e7f5f0;padding:4px 10px;border-radius:5px}.number-input-notice[hidden]{display:none}\n')
 (r/'tests/numeric-text.test.mjs').write_bytes((w/'numeric-text.test.mjs').read_bytes())
 if (d/'documentation-version.json').exists():
  p=d/'documentation-version.json';data=json.loads(p.read_bytes());data['numericInput']={'revision':'2026-11-27-fullwidth1','message':'半角に直しました','ime':'after composition','namesAndText':'unchanged','hardwareTested':False};p.write_bytes((json.dumps(data,ensure_ascii=False,indent=2)+'\n').encode())
 print('Patched',r)
