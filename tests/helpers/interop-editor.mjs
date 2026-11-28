import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {DISPLAY_IMAGES,presetBitmap,rasterDisplayText} from '../../dist/display.js';
import {installInteropBlocks,convertProject,isForeignProject,installInteropUI} from '../../dist/project-interop.js';
const app=readFileSync(new URL('../../dist/app.js',import.meta.url),'utf8');
class XmlNode{
 constructor(name,type=1,text=''){this.nodeName=name;this.nodeType=type;this.data=text;this.childNodes=[];this.attrs=new Map();this.parentNode=null;}
 setAttribute(name,value){this.attrs.set(name,String(value));}getAttribute(name){return this.attrs.get(name)??null;}removeAttribute(name){this.attrs.delete(name);}
 hasAttributes(){return !!this.attrs.size;}hasChildNodes(){return !!this.childNodes.length;}
 appendChild(child){this.childNodes.push(child);child.parentNode=this;return child;}
 get children(){return this.childNodes.filter(n=>n.nodeType===1);}
 get firstChild(){return this.childNodes[0]??null;}get nextSibling(){const siblings=this.parentNode?.childNodes??[];return siblings[siblings.indexOf(this)+1]??null;}
 get textContent(){return this.nodeType===3?this.data:this.childNodes.map(x=>x.textContent).join('');}
 set textContent(value){if(this.nodeType===3)this.data=String(value);else{this.childNodes=[];this.appendChild(new XmlNode('#text',3,String(value)));}}
 cloneNode(deep){const node=new XmlNode(this.nodeName,this.nodeType,this.data);node.attrs=new Map(this.attrs);if(deep)for(const child of this.childNodes)node.appendChild(child.cloneNode(true));return node;}
}
function editor(){
 const elements=new Map();
 const context=vm.createContext({installInteropBlocks,convertProject,isForeignProject,installInteropUI:()=>({update(){},review:async()=>true}),DISPLAY_IMAGES,presetBitmap,rasterDisplayText,console,setTimeout,clearTimeout,structuredClone,XMLSerializer:class{serializeToString(n){return '<'+n.nodeName+' '+[...n.attrs].map(([k,v])=>k+'='+JSON.stringify(v)).join(' ')+'>'+n.childNodes.map(c=>this.serializeToString(c)).join('')+'</'+n.nodeName+'>'; }},document:{createElementNS:(_ns,name)=>new XmlNode(name),createTextNode:text=>new XmlNode('#text',3,text),querySelector:()=>({}),getElementById:id=>{if(!elements.has(id))elements.set(id,{value:id==='pairMode'?'independent':'',textContent:''});return elements.get(id);}}});
 for(const file of ['blockly_compressed.js','blocks_compressed.js','ja.js'])vm.runInContext(readFileSync(new URL('../../dist/vendor/'+file,import.meta.url),'utf8'),context);
 const prefix=app.slice(app.indexOf('\n')+1,app.indexOf('const theme='));vm.runInContext(prefix,context);
 vm.runInContext('installInteropBlocks(Blockly);const workspace=new Blockly.Workspace();',context);
 vm.runInContext(app.slice(app.indexOf('function expression('),app.indexOf('function check(){')),context);
 return context;
}


export {editor};
