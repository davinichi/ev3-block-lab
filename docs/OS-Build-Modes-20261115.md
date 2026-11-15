# OSイメージの構成別作成記録（2026年11月15日確認）

## helloEV3組み込み形式

2026年11月13日の保存済みEV3RT-SVC調査報告とbuild-baseline.log／build-patched.logを照合。
make img=helloev3による修正前・修正後の両ビルドが成功。
修正版uImageのSHA-256: aecf721bf89ea1f3e2efccfaaac82dedb008e00d814453c70be0d8b22a32950d。
ログにはEV3起動・実機競合再現・長時間動作は未実施と記録。

## 動的ローディング形式

同日の修正版B再ビルド結果を照合。sdk/firmwareでmake PWD=. img=loader。
uImageは968602バイト、SHA-256は5c29d6bd06f9111cb038ff50c12bc3a3dbba45eff60b0a3f18b7ba8f77c1a2be。
保全済み既存Bと全バイト一致。再ビルド作業自体では実機試験はしていない。
識別表示付きBでのP制御ライントレースとMove_testの正常動作は、別途利用者から報告された結果。

2系統のuImageを取り違えない。OS全体の再配布条件の調査は継続中で、この資料ZIPにはOSバイナリを含めない。
