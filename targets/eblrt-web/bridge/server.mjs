import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createBridgeServer} from './core.mjs';
import {startupBanner} from './startup-info.mjs';

const configPath=path.resolve(process.argv[2]??'bridge.config.json');
for(const line of startupBanner(path.dirname(configPath)))console.log(line);
try{
  const config=JSON.parse(await readFile(configPath,'utf8'));
  const server=createBridgeServer(config);
  server.on('error',e=>{console.error('補助アプリを起動できません: '+e.message);process.exitCode=1;});
  server.listen(config.port??8766,'127.0.0.1',()=>{
    console.log('EV3-RT補助アプリを起動しました。この画面を開いたまま、実験用サイトの「補助アプリに接続」を押してください。');
    console.log('接続先: http://127.0.0.1:'+(config.port??8766));
  });
}catch(e){console.error('設定ファイルを読み込めません。bridge.config.example.jsonを参考にbridge.config.jsonを設定してください。');process.exitCode=1;}
