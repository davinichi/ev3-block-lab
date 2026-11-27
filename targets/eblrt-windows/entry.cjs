// Register the local secure scheme synchronously, before importing ESM.
const fs=require('node:fs'),path=require('node:path');
const {app,dialog,protocol}=require('electron');
protocol.registerSchemesAsPrivileged([{scheme:'eblrt',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
app.disableHardwareAcceleration();
import('./main.mjs').catch(error=>{
 try{fs.appendFileSync(path.join(__dirname,'startup-error.txt'),String(error.stack??error)+'\n');}catch{}
 dialog.showErrorBox('EBL-RT Windowsを起動できません',String(error.message??error)+'\n書き込み可能な短い半角英数字のフォルダーへ、ZIPを全展開してください。');
 app.quit();
});
