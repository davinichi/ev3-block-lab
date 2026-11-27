import test from 'node:test';import assert from 'node:assert/strict';
import {installI18n} from '../dist/i18n.js';
test('desktop manual paths survive repeated localization and target/language switches',()=>{
 const old={desktop:globalThis.EBLDesktop,observer:globalThis.MutationObserver,filter:globalThis.NodeFilter};
 try{
  globalThis.EBLDesktop={version:'0.3.6'};globalThis.MutationObserver=class{observe(){}};globalThis.NodeFilter={SHOW_TEXT:4};
  const pdf={},html={},select={value:'ja'},document={body:{dataset:{target:'ev3rt'},querySelectorAll:()=>[]},documentElement:{},querySelectorAll:()=>[],createTreeWalker:()=>({nextNode:()=>null}),getElementById:id=>({manualDownload:pdf,manualHtml:html,uiLanguage:select}[id]??null)};
  class Block{jsonInit(){}setTooltip(){}}class Input{appendField(){}}
  const Blockly={Block,Input,Msg:{},setLocale(){}};
  const i18n=installI18n({Blockly,jaMessages:{},enMessages:{},catalog:{text:{},blocks:{},tips:{}},document,storage:{getItem:()=>null}});
  for(let i=0;i<3;i++){i18n.localize();assert.equal(pdf.href,'manual/EBLRT-Guide-v0.34.3.pdf');assert.equal(html.href,'manual/EBLRT-Guide-v0.34.3.html');}
  i18n.apply('en');assert.match(pdf.title,/v0\.34\.3 · 16 pages/);assert.equal(pdf.href,'manual/EBLRT-Guide-v0.34.3.pdf');
  document.body.dataset.target='standard';i18n.localize();assert.equal(pdf.href,'manual/EV3-Block-Lab-Manual-v0.25.6-en.pdf');
  i18n.apply('ja');assert.equal(pdf.href,'manual/EBL-Manual-v0.25.6.pdf');
 }finally{globalThis.EBLDesktop=old.desktop;globalThis.MutationObserver=old.observer;globalThis.NodeFilter=old.filter;}
});
