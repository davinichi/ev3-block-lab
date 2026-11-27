import {installI18n} from './i18n.js?v=classroom-20261125-final';
import {catalog} from './locale-en.js?v=classroom-20261125-final';
let storage;try{storage=globalThis.localStorage;}catch{storage={getItem:()=>null,setItem:()=>{}};}
globalThis.EBLi18n=installI18n({Blockly,jaMessages:globalThis.EBLJapaneseMessages,enMessages:{...Blockly.Msg},catalog,document,storage,search:location.search});
await import('./app.js?v=classroom-20261125-final');
