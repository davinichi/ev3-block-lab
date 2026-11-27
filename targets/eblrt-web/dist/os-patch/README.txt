この資料は、OSパッチを自分で適用・ビルドできる方向けの実機評価用です。
Cコード生成・アプリのコンパイルだけの確認には、OSの交換は不要です。
本パッチは非公式の修正候補で、公式採用・全機能の互換性確認は完了していません。
ファイル名を英数字へ変更したv0.1.1です。修正命令はv0.1.0と同じです。

EV3RT／HRP3 SVC復帰処理パッチ v0.1.1（非公式・実験版）
配布資料作成日：2026年11月4日

このパッケージは、ソース修正パッチ、適用・取り消しツール、OSビルド用の補助スクリプト、
導入・復元手順、確認済みの検証結果を収録したものです。
OSの実行ファイル（uImage）、コンパイラ、OS全ソース、診断実行ファイルは含みません。
SDカード上のuImageにパッチを直接当てることはできません。
修正済みOSを既に導入している方は、重ねて変更する必要はありません。

■1　対象と修正内容
対象：EV3RT／TOPPERS HRP3の arch/arm_gcc/common/core_support.S、ret_svc_1。
今回確認したARMアーキテクチャ6未満の経路に、説明2行と命令1行を追加します。
  msr cpsr_c, #(CPSR_SVC_MODE AOR CPSR_FIQ_IRQ_BIT)
適用後の参照ソースでは1612～1614行が追加部分、命令は1614行です。
SVC（OSサービス）からアプリへ戻る直前、SPSR_svcの復元と例外復帰の間へIRQが重なると、
保存状態が上書きされ、アプリへ誤ったモード／スタックで戻る経路が確認されました。
修正はその短い区間のIRQ/FIQをマスクします。最後の例外復帰で元の状態を復元します。
割り込みを恒久的に禁止したり、アプリ全体を割り込み禁止で実行したりする変更ではありません。

対象ファイルのSHA-256（CRLFをLFに統一して計算）
適用前：32b9e53d767f88f6a2e409db4d97c5ac8f1a6732e69599f58a55933d9260d8d4
適用後：6fd6b9147af05e2d6ca1333ca9c4437c1960f390a4312895f0b44f2f08d9a3ec
このファイルに一致する版が対象です。「EV3RT 1.1」「HRP3」という名前だけで適合を判断しません。
全ソースの上流コミットは確定していません。今回の手元ソースに対する差分です。
取得した上流ソースと一致しなければ、強制適用せず版の違いを調べてください。
source/内のファイルは変更内容確認用です。異なる版へ丸ごと上書きする用途ではありません。

■2　パソコンと必要な環境
適用作業：Git、またはPython 3.9以降のどちらか。
OSビルド：完全なEV3RT HRP3ソース、SDK、サブモジュール、Cygwin等のビルド環境。
必要なコマンド：make、perl、ruby、ARM用gcc/objcopy/objdump、mkimage、diff、find、sed、awk、grepなど。
mkimageはU-Boot形式の起動イメージを作るツールです。diffはdiffutilsに含まれます。
OSのビルドには、アプリ用SDKだけでなく、sdk/firmware/loaderとmodules以下のソースも必要です。
今回の元環境はARM GCC 5.4.1 20160919、Ruby 3.3.13、Cygwin 3.3.3、make 4.3、Perl 5.32.1です。
別のコンパイラ版・WSL等への適合はこのパッケージでは確認していません。
EBL-RTの「コンパイル」ボタンはアプリ用です。OSパッチ適用・OSビルドを自動では行いません。
Windows版に同梱されたツールだけでは、diff・mkimage等のOS用ツールが不足する場合があります。

公式の取得元：
  https://github.com/ev3rt-git/ev3rt-hrp3
  https://github.com/ev3rt-git/ev3rt-hrp3-sdk
取得例（版・コミットを記録し、適合を別途確認してください）：
  git clone --recursive https://github.com/ev3rt-git/ev3rt-hrp3.git hrp3-original
  cd hrp3-original
  git submodule status --recursive
サブモジュール未取得の空フォルダーではビルドできません。
現在公開されているソースと今回の対象ファイルが一致することは、この取得例では保証しません。

■3　作業用コピーを準備
1. このZIPを全展開します。例：C:\EV3RT-Patch
2. 元の完全なOSソースを保存し、別フォルダーへコピーします。例：C:\EV3RT\hrp3-copy
3. パッチ・OSソースとも、短い半角英数字・空白なしの場所を使用します。
4. 元ソースや使用中のSD上で直接作業しません。
5. sdk/OBJ、生成済みlibkernel.a、既存uImageが残っていない新しいビルド用コピーを用います。
   build_os.shは既存の生成物を検出したら停止します。自動削除は行いません。

■4　OSパッチを適用（Python方式・Windowsでの例）
コマンドプロンプトまたはPowerShellで次を順に実行します。
pythonが見つからない場合は、インストール済みのPythonランチャーに合わせてpythonをpy -3等に置き換えます。

  python C:\EV3RT-Patch\scripts\apply_svc_patch.py check C:\EV3RT\hrp3-copy
  python C:\EV3RT-Patch\scripts\apply_svc_patch.py apply C:\EV3RT\hrp3-copy
  python C:\EV3RT-Patch\scripts\apply_svc_patch.py check C:\EV3RT\hrp3-copy

ORIGINAL / patch applicable → APPLIED → PATCHED / already appliedとなることを確認します。
UNKNOWN SOURCEなら変更されません。別版のソースへ強制的に適用しないでください。
適用前ファイルは同じ場所のcore_support.S.pre-ebl-svc-v1.bakへ元のバイト列のまま保存します。
既存のバックアップは上書きしません。CRLF/LFの改行形式を維持します。

Git方式を使う場合（OSソースのルートで実行）：
  git apply --check C:/EV3RT-Patch/patches/ret-svc-irq.patch
  git apply C:/EV3RT-Patch/patches/ret-svc-irq.patch
  git diff -- arch/arm_gcc/common/core_support.S
Gitの文脈一致だけでは同一版を保証しません。対象ファイルのハッシュも確認してください。
Python方式とGit方式は、どちらか一方で適用します。Git方式では.bakは作成されません。

■5　ビルド環境調整パッチ（必要な場合だけ）
patches/build-environment-compatibility.patchはOSの競合修正とは別です。
今回の手元環境でRubyの旧shell依存とMakefileの空白入り相対パス計算を調整した差分です。
対象：configure.rb、sdk/common/Makefile.prj.common。
既に同等の調整がある場合は重複適用しません。適用前に両ファイルを別名で保存してください。
OSソースのルートで：
  git apply --check C:/EV3RT-Patch/patches/build-environment-compatibility.patch
  git apply C:/EV3RT-Patch/patches/build-environment-compatibility.patch
sdkが別Gitサブモジュールでも、親ルートからの適用対象パスを確認します。
チェックで失敗した場合は差分を確認し、強制適用しません。
RubyがCygwin用ではなくWindows用の場合、CygwinパスとWindowsパスの変換も必要になることがあります。
EBL-RT付属のruntime-config.mjsが作るrubyラッパーはそのための設定を含みます。

■6　OSをビルド
以下はCygwinターミナルで実行します。PowerShellにそのまま入力するコマンドではありません。
Ruby・ARM GCC・mkimage等が、そのターミナルのPATHから利用できるよう準備します。
コマンドの有無を確認：
  bash /cygdrive/c/EV3RT-Patch/scripts/check_build_env.sh
MISSINGがあれば、不足ツールやPATHを修正します。成功してもOSビルドの完了ではありません。

OSビルド補助：
  bash /cygdrive/c/EV3RT-Patch/scripts/build_os.sh /cygdrive/c/EV3RT/hrp3-copy
内部でsdk/firmwareへ移動し、次の既存Makefileのターゲットを実行します。
  make PWD=. img=loader
標準の処理は生成・コンパイル・リンク・objcopy・mkimageを行います。
成功時の成果物：C:\EV3RT\hrp3-copy\sdk\firmware\uImage
スクリプトはSDへのコピー・ネットワーク送信・ソースの自動修正を行いません。
エラーが出た場合は、以前のuImageを新しい成功成果物として扱わないでください。
今回の配布作業ではスクリプト構文・不足検出とパッチ操作を確認しています。
任意の取得ソース・利用者環境からOS全体を再ビルドできることの保証ではありません。

■7　生成OSを確認
Windowsで：
  python C:\EV3RT-Patch\scripts\verify_uimage.py C:\EV3RT\hrp3-copy\sdk\firmware\uImage
ヘッダー、サイズ、ヘッダーCRC、データCRC、ARM/ロード・開始アドレスを確認します。
この検査はファイル破損の確認であり、競合修正や実機互換性の証明ではありません。
ビルド日時等が入るので、再ビルドしたuImageのハッシュは過去の実機試験品と異なる場合があります。
Cygwinで、生成されたhrp.exe（環境によってhrp）を逆アセンブルします。
  cd /cygdrive/c/EV3RT/hrp3-copy/sdk/firmware
  arm-none-eabi-objdump -d hrp.exe > kernel-disassembly.txt
ret_svc_1で、従来のpop / msr SPSR / ldm例外復帰の前にマスク命令があることを確認します。
今回のリンク済み試験品の先頭4命令：e321f0d3 e49de004 e16ff00e e8fd8000。
リンク先アドレス自体はビルドによって変わるため、固定アドレスだけで判定しません。

■8　予備SDへ導入
1. 元のSDを丸ごとバックアップし、そのSD自体も残します。予備カードを用意します。
2. 現在使えているEV3RTのSDと同じ構成を予備SDへコピーします。
   新規カードのフォーマットが必要な場合はEV3RT公式のSD作成手順に従います。
   本パッケージはフォーマットやブートローダー作成を自動では行いません。
3. 予備SDのルートにあるuImageだけを、今回ビルドしたuImageで置き換えます。
   ev3rt/appsにはアプリを置きます。OSはev3rt/appsに入れません。
4. コピー後のSDのuImageをverify_uimage.pyで読み直し、ビルド直後のSHA-256と一致させます。
5. Windowsで安全に取り外します。
6. EV3を完全にシャットダウンし、ランプが消えたことを確認します。
7. モーターケーブルを外した状態で予備SDへ交換し、電源を入れます。
戻るボタンでアプリを終えただけではOSは入れ替わりません。電源断から起動し直す必要があります。
この方法はSD起動用OSの交換です。EV3内蔵のLEGO標準ファームウェアの書き換えではありません。
USBでSDをPCへ見せている間にアプリを実行しません。安全に取り外し、ケーブルを抜いて試します。

■9　段階的な実機確認
最初はモーターなしで、起動・表示・待機・終了・再実行を確認します。
その後、車輪を浮かせ、低速でBモーターの90度回転→1秒待機を10回繰り返します。
停止後に再度実行して、同じ結果になるかを確認します。
次に他ポート、Mモーター、逆転、旋回、センサー、複数タスクを個別に試します。
記録表：docs/hardware-test-record.csv。OSハッシュ、機体、プログラム、設定、結果を残してください。
既存のSvcGuard等を使う場合、記録内のc05ffcf4のようなOS識別値は過去の特定ビルド専用です。
新しい再ビルド品へその固定値をそのまま流用すると、正常でも拒否される場合があります。
診断実行ファイルを無条件で使い回す手順にはしていません。
異常が出たら連続で試さず、電源を切り、OSハッシュ・画面・操作・ログを保存します。

■10　元へ戻す
実機：電源を完全に切り、保存しておいた元のSDへ戻して起動します。
ソース（Python方式で適用した場合）：
  python C:\EV3RT-Patch\scripts\apply_svc_patch.py revert C:\EV3RT\hrp3-copy
バックアップのハッシュを確認して元のバイト列に戻します。バックアップは残します。
ソース（Git方式で適用した場合、OSソースのルートで）：
  git apply --reverse --check C:/EV3RT-Patch/patches/ret-svc-irq.patch
  git apply --reverse C:/EV3RT-Patch/patches/ret-svc-irq.patch
ビルド環境調整も戻す場合は、そちらのパッチを別途--reverseします。
ソースを戻しただけでは、SDにコピー済みのOSや現在実行中のOSは元に戻りません。

■11　検証結果と残る課題
既存の命令レベル試験22ケース中、従来経路の特定IRQタイミングで誤った復帰を再現しました。
修正候補・リンク済み修正OSの18ケースでは、保存されたモード・スタック・マスクへ復帰しました。
割り込みの物理的なタイミングや全周辺機器を再現した試験ではありません。
実機では、保護用記録あり／なしのそれぞれで、OS呼び出し16000回とセマフォ4000往復が通過。
ネイティブ制御とEBL由来制御のそれぞれで、B・20%・90度＋1秒待機を10回完了しました。
利用者から、以前異常終了した通常生成アプリも正常になったとの報告がありました。
検証は特定の環境です。全アプリ互換性、長時間動作、全センサー、USB/Bluetooth、負荷条件、
割り込み遅延への影響は追加検証が必要です。WRO等の過去の停止事例の原因を確定したものではありません。
根拠の機械可読記録はevidence/、今回の配布ファイル操作の確認はevidence/package-tests.jsonです。

■12　配布条件・出典
非公式の実験パッチとして、ZIP全体とハッシュを一緒に案内できます。
原著作者表示・利用条件・免責事項はlicenses/と参照ソース内に保持しています。
これらを削除せず、実験版であることと対象・検証範囲を併記してください。
TOPPERSの利用条件： https://www.toppers.jp/license.html
本ZIPの配布と、OS全体をビルドしてuImageを配布することは別です。
uImageを再配布する際は、組み込まれるBTstack、GPLのドライバー等を含めて各部品の条件、
必要な表示・対応ソースの提供方法を別途整理してください。
本ZIPは完成OSバイナリーや第三者ツールを含まないため、それらを配布許諾済みとするものではありません。
今回追加した補助スクリプト・説明文の条件はlicenses/PACKAGE-ADDITIONS.txtに記載しています。
ファイル一覧・サイズ・SHA-256はMANIFEST.json、ZIP自体のSHA-256は隣の.sha256.txtを参照してください。
