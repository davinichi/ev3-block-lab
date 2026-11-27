export const BRIDGE_VERSION=13;
export const BRIDGE_BUILD='2026-11-13-pid-motor1';
export const REQUIRED_FEATURE='bounded-motor-speed';

export function startupBanner(root) {
  return ['EV3-RT 補助アプリ',`機能版: ${BRIDGE_VERSION} / ビルド: ${BRIDGE_BUILD}`,
    'マイブロックとCの関数名・引数名を共通化: 対応',
    '速さを−100〜100に制限 / PID更新中の不要な制動を修正: 対応',
    'Cコードの独立ファイル化: 対応 / 連続ステアリング修正: 対応',`起動元フォルダー: ${root}`];
}
export function existingBridgeMessage(status) {
  if(status?.service!=='ev3-block-lab-bridge'||status.ready!==true)
    return {compatible:false,lines:['この接続先では、対応する補助アプリを確認できません。']};
  const version=Number.isInteger(status.version)?String(status.version):'不明';
  const build=typeof status.build==='string'?status.build:'表示なし';
  const compatible=Number.isInteger(status.version)&&status.version>=BRIDGE_VERSION&&
    Array.isArray(status.features)&&status.features.includes(REQUIRED_FEATURE);
  return {compatible,lines:[`すでに起動中の補助アプリ: 機能版 ${version} / ビルド ${build}`,
    ...(compatible?['対応する補助アプリがすでに動いています。新しい補助アプリは起動していません。',
      'この画面は閉じて構いません。元の起動画面を開いたまま、サイトで「補助アプリに接続」を押してください。']:
      [`今回起動しようとした版: 機能版 ${BRIDGE_VERSION} / ビルド ${BRIDGE_BUILD}`,
       '古い補助アプリが接続先を使用しているため、新しい版は起動していません。',
       '古い補助アプリの起動画面を閉じてから、新しいフォルダーの start-ev3rt.cmd を起動し直してください。'])]};
}
