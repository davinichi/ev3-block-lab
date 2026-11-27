import path from 'node:path';
import {readdir,mkdir,writeFile,readFile,stat} from 'node:fs/promises';
const unix=p=>p.replaceAll('\\','/');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
export async function runtimeConfig(root){
 if(/[^\x21-\x7e]/.test(root))throw Error('試作版は、半角英数字・空白なしの書き込み可能なフォルダーへ全展開してください。例：C:\\EBLRT\\EBL-RT-Windows');
 const runtime=path.join(root,'runtime'),rubyRoot=path.join(runtime,'ruby');
 const gemRoot=path.join(rubyRoot,'lib/ruby/gems/3.3.0/gems'),libraries=[];
 for(const name of await readdir(gemRoot)){const lib=path.join(gemRoot,name,'lib');try{if((await stat(lib)).isDirectory())libraries.push(unix(lib));}catch{}}
 const rubyWrapperDir=path.join(runtime,'build-tools');await mkdir(rubyWrapperDir,{recursive:true});
 await writeFile(path.join(rubyWrapperDir,'ruby'),`#!/bin/bash
export RUBYOPT=--disable-gems
export RUBYLIB=${quote(libraries.join(';'))}
args=()
for arg in "$@"; do
 case "$arg" in
 /cygdrive/*) args+=("$(/usr/bin/cygpath -m "$arg")");;
 -I/cygdrive/*) args+=("-I$(/usr/bin/cygpath -m "\${arg:2}")");;
 *) args+=("$arg");;
 esac
done
exec ${quote(unix(path.join(rubyRoot,'bin/ruby.exe')))} "\${args[@]}"
`);
 const cygwin=path.join(runtime,'cygwin');
 await mkdir(path.join(cygwin,'tmp'),{recursive:true});
 const config={sdkRoot:path.join(runtime,'sdk'),bashPath:path.join(cygwin,'bin/bash.exe'),compilerBin:path.join(runtime,'arm-gcc/bin'),rubyWrapperDir,
  buildEnv:{PATH:path.join(cygwin,'bin')+';'+path.join(process.env.SystemRoot??'C:/Windows','System32'),HOME:'/home/eblrt',TMPDIR:'/tmp',BASH_ENV:'',ENV:'',GCC_EXEC_PREFIX:'',COMPILER_PATH:'',LIBRARY_PATH:'',CPATH:'',C_INCLUDE_PATH:'',CPLUS_INCLUDE_PATH:''}};
 await mkdir(path.join(cygwin,'home/eblrt'),{recursive:true});
 for(const file of [config.bashPath,path.join(config.compilerBin,'arm-none-eabi-gcc.exe'),path.join(rubyRoot,'bin/ruby.exe'),path.join(config.sdkRoot,'configure.rb')])await stat(file);
 return config;
}
export async function toolVersions(root){return JSON.parse(await readFile(path.join(root,'runtime/BUNDLED-TOOLS.json'),'utf8'));}
