// Notices belong beside the operation that produced them. No modal or automatic focus stealing.
export function installNotices({workspace,programPanel,programText,hint,programAction,saveNotice,targets,onResize=()=>{},showConnection=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}){
 let marked=null,saveTimer=null;
 function paint(node,text,error=false){node.textContent=text;node.hidden=!text;node.classList.toggle('notice-error',!!error);}
 function program(message='',id=null){
  marked?.getSvgRoot?.()?.classList.remove('sbl-error-block');marked=null;
  const block=id?workspace.getBlockById(id):null;
  if(block){marked=block;block.getSvgRoot?.()?.classList.add('sbl-error-block');}
  paint(programText,message,true);programPanel.hidden=!message;if(hint)hint.hidden=!!message;
  onResize();
 }
 function notify(text,error=false,where='program'){
  if(where==='save'){
   if(saveTimer!==null)clearTimer(saveTimer);saveTimer=null;paint(saveNotice,text,error);
   if(text&&!error)saveTimer=setTimer(()=>{saveTimer=null;paint(saveNotice,'');},5000);
  }else if(where==='program'){paint(programAction,text,error);onResize();}
  else{const node=targets[where];if(!node)throw Error('Unknown notification target: '+where);node.classList.add('operation-notice');paint(node,text,error);if(text&&error)showConnection();}
 }
 return {program,notify};
}
