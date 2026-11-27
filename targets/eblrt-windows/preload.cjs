const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('EBLDesktop',{
 version:'0.3.6',
 onTransferComplete:callback=>{const listener=()=>callback();ipcRenderer.on('eblrt:transfer-complete',listener);return ()=>ipcRenderer.removeListener('eblrt:transfer-complete',listener);},
 request:async(route,{method='GET',body,binary=false}={})=>{
  const data=await ipcRenderer.invoke('eblrt:request',{route,method,body});
  if(binary){const bytes=new Uint8Array(data);return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}
  return data;
 },
 saveSD:jobId=>ipcRenderer.invoke('eblrt:save-sd',jobId),
 diagnose:()=>ipcRenderer.invoke('eblrt:diagnose'),
 testCompile:()=>ipcRenderer.invoke('eblrt:test-compile')
});
