import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
// 手元で動作確認するための静的サーバー。公開サイト側の配信には使用しない。
const root=path.resolve('dist');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg'};
const server=http.createServer(async(req,res)=>{
  try{const url=new URL(req.url,'http://localhost');const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    // URLの親フォルダ指定などでdistの外のファイルを配信しないようにする。
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    const data=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Permissions-Policy':'serial=(self), hid=(self)','Cache-Control':'no-cache'}).end(data);
  }catch{res.writeHead(404).end('Not found');}
});
// 開発用なので接続先をこのPC内（ループバック）に限定する。
server.listen(8765,'127.0.0.1',()=>console.log('Local: http://localhost:8765'));
