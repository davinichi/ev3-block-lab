import {installI18n} from './i18n.js?v=primary-school-20261128-r2';
import {catalog} from './locale-en.js?v=primary-school-20261128-r2';
let storage;try{storage=globalThis.localStorage;}catch{storage={getItem:()=>null,setItem:()=>{}};}
globalThis.EBLi18n=installI18n({Blockly,jaMessages:globalThis.EBLJapaneseMessages,enMessages:{...Blockly.Msg},catalog,document,storage,search:location.search});
await import('./app.js?v=0.26.0-interop1');
