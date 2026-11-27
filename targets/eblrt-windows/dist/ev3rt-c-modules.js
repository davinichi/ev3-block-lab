// Split only C emitted by this generator. Never parse project-authored C.
// Keep offsets while hiding delimiters in comments and quoted literals.
function maskC(text) {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g,
    value=>{const blank=value.replace(/[^\n]/g,' ');return /^["']/.test(value)?'0'+blank.slice(1):blank;});
}
function publicStorage(text) {
  for(const word of ['static','inline']) {
    const found=maskC(text).match(new RegExp('\\b'+word+'\\s+'));
    if(found)text=text.slice(0,found.index)+text.slice(found.index+found[0].length);
  }
  return text;
}
function declaration(text) {
  const code=maskC(text);let output='',last=0,paren=0,bracket=0,brace=0,skip=false;
  for(let i=0;i<code.length;i++) {
    const c=code[i];
    if(c==='='&&!paren&&!bracket&&!brace&&!skip){output+=text.slice(last,i);skip=true;}
    if((c===','||c===';')&&!paren&&!bracket&&!brace&&skip){last=i;skip=false;}
    if(c==='(')paren++;if(c===')')paren--;
    if(c==='[')bracket++;if(c===']')bracket--;
    if(c==='{')brace++;if(c==='}')brace--;
  }
  if(skip)throw Error('Unterminated generated initializer');
  return output+text.slice(last);
}
export function splitRuntimeC(text,headerName='ebl_rt_runtime.h') {
  const code=maskC(text),header=['#pragma once\n'],implementation=[`#include "${headerName}"\n`];
  let begin=0,i=0;
  while(i<code.length) {
    while(i<code.length&&/\s/.test(code[i]))i++;
    if(i===code.length){header.push(text.slice(begin));break;}
    if(code[i]==='#') {
      let end=code.indexOf('\n',i);if(end<0)end=code.length;
      while(end<code.length&&code[end-1]==='\\'){end=code.indexOf('\n',end+1);if(end<0){end=code.length;break;}}
      const unit=text.slice(begin,Math.min(end+1,code.length));
      if(!/^\s*#pragma once\s*$/.test(unit))header.push(unit);
      i=Math.min(end+1,code.length);begin=i;continue;
    }
    const token=i;let paren=0,bracket=0,brace=0,body=-1,end=-1;
    for(;i<code.length;i++) {
      const c=code[i];
      if(c==='(')paren++;if(c===')')paren--;
      if(c==='[')bracket++;if(c===']')bracket--;
      if(c==='{') {
        if(!paren&&!bracket&&!brace&&body<0&&/\)\s*$/.test(code.slice(token,i)))body=i;
        brace++;
      }
      if(c==='}') {
        brace--;
        if(body>=0&&!brace){end=i+1;break;}
      }
      if(c===';'&&!paren&&!bracket&&!brace){end=i+1;break;}
    }
    if(end<0)throw Error('Unsupported generated C module boundary');
    const unit=text.slice(begin,end),significant=code.slice(token,end);
    if(body>=0) {
      header.push(publicStorage(text.slice(begin,body))+';\n');
      implementation.push(publicStorage(unit)+'\n');
    }else if(/^typedef\b/.test(significant)||/^enum\b[\s\S]*}\s*;$/.test(significant))header.push(unit+'\n');
    else if(/^static\b/.test(significant)) {
      const publicUnit=publicStorage(unit);
      if(/\)\s*;$/.test(significant)&&!significant.includes('='))header.push(publicUnit+'\n');
      else {
        // Preserve leading comments but place extern after them.
        const leading=unit.slice(0,token-begin);
        const variable=publicStorage(text.slice(token,end));
        header.push(leading+'extern '+declaration(variable)+'\n');
        implementation.push(publicUnit+'\n');
      }
    }else throw Error('Unexpected generated declaration: '+significant.slice(0,80));
    i=end;begin=end;
  }
  return {header:header.join(''),implementation:implementation.join('')};
}

export function splitMyBlocks(source,runtime,prototypes) {
  const begin='/* EBL_MYBLOCKS_BEGIN */',end='/* EBL_MYBLOCKS_END */';
  const a=source.indexOf(begin),b=source.indexOf(end);
  if(a<0||b<a||source.indexOf(begin,a+begin.length)>=0||source.indexOf(end,b+end.length)>=0)throw Error('Ambiguous generated My Block boundary');
  const publicFunctions=text=>text.replace(/\bstatic lab_values (?=[A-Za-z][A-Za-z0-9_]*\()/g,'lab_values ');
  const procedureCode=publicFunctions(source.slice(a+begin.length,b));
  const declarations=publicFunctions(prototypes);
  const parts=splitRuntimeC(runtime);
  return {
    source:source.slice(0,a)+'/* マイブロックの関数本体は ebl_myblocks.c にあります。 */\n'+source.slice(b+end.length),
    runtimeHeader:'/* 共有する型・変数の宣言と補助関数の宣言。実体は ebl_rt_runtime.c に1つだけ置きます。 */\n#include "app.h"\n'+parts.header,
    runtimeSource:'/* 自動生成された補助処理。app.c・ebl_myblocks.cとは別々にコンパイルします。 */\n#include "app.h"\n'+parts.implementation,
    myblocksHeader:'/* マイブロックを別ファイルから呼び出すための関数宣言です。 */\n#pragma once\n#include "ebl_rt_runtime.h"\n'+declarations+'\n',
    myblocksSource:'/* ブロックで定義したマイブロックの関数本体です。 */\n#include "ebl_myblocks.h"\n'+procedureCode,
  };
}
