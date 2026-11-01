import {installI18n} from './i18n.js';
import {catalog} from './locale-en.js';
let storage;try{storage=globalThis.localStorage;}catch{storage={getItem:()=>null,setItem:()=>{}};}
globalThis.EBLi18n=installI18n({Blockly,jaMessages:globalThis.EBLJapaneseMessages,enMessages:{...Blockly.Msg},catalog,document,storage,search:location.search});
await import('./app.js');
