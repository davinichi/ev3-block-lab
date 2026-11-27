// Presentation only: never opens a device or changes motor/transfer commands.
export function renderConnectionBadge(node,{connected=false,connecting=false},translate=x=>x){
 const pending=connecting&&!connected;
 node.classList.toggle('connected',connected);node.classList.toggle('connecting',pending);
 const text=translate(connected?'EV3 接続中':pending?'EV3 接続確認中':'EV3 未接続');
 const label=node.querySelector('[data-connection-label]');if(label&&label.textContent!==text)label.textContent=text;
 const description=text+' / '+translate('接続・転送を開く');
 for(const key of ['aria-label','title'])if(node.getAttribute(key)!==description)node.setAttribute(key,description);
}
