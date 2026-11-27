// Limit conversion to number editors: Japanese names and text are untouched.
export function halfWidthNumberText(text){
 return String(text).replace(/[０-９．－−]/g,c=>c==='−'?'-':String.fromCharCode(c.charCodeAt(0)-0xfee0));
}

export function installNumericTextNormalization(Blockly,{document,notice,message=()=> '半角に直しました',setTimer=setTimeout,clearTimer=clearTimeout}){
 const proto=Blockly.FieldNumber.prototype,original=proto.getValueFromEditorText_;
 const composing=new WeakSet(),numericEditors=new WeakSet();let timer=null;
 const show=()=>{
  if(timer!==null)clearTimer(timer);
  notice.textContent=message();notice.hidden=false;
  timer=setTimer(()=>{timer=null;notice.hidden=true;notice.textContent='';},4000);
 };
 function converted(text){
  const input=this.htmlInput_;
  if(input)numericEditors.add(input);
  if(input&&composing.has(input))return original.call(this,text);
  const normalized=halfWidthNumberText(text);
  if(normalized!==text){
   if(input){
    const start=input.selectionStart,end=input.selectionEnd;
    input.value=normalized;
    if(start!==null&&end!==null)input.setSelectionRange(start,end);
   }
   show();
  }
  return original.call(this,normalized);
 }
 proto.getValueFromEditorText_=converted;
 const start=e=>composing.add(e.target);
 const end=e=>{
  composing.delete(e.target);
  if(numericEditors.has(e.target)&&halfWidthNumberText(e.target.value)!==e.target.value){
   e.target.dispatchEvent(new document.defaultView.Event('input',{bubbles:true}));
  }
 };
 document.addEventListener('compositionstart',start,true);
 document.addEventListener('compositionend',end,true);
 return ()=>{
  if(proto.getValueFromEditorText_===converted)proto.getValueFromEditorText_=original;
  document.removeEventListener('compositionstart',start,true);document.removeEventListener('compositionend',end,true);
  if(timer!==null)clearTimer(timer);
 };
}
