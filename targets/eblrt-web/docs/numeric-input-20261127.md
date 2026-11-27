# 数値入力の全角・半角

数値入力欄では、全角の数字・マイナス・小数点を半角へ自動変換します。例：－１２．５ → -12.5。変換時は編集エリア上部に「半角に直しました」と約4秒表示します。日本語入力の変換中は書き換えず、確定後に直します。変数名・マイブロック名・文字列は変換しません。数値の範囲や整数指定など、従来の入力制限と保存形式は維持します。

Numeric fields automatically convert full-width digits, minus signs and decimal points to half-width characters. For example, －１２．５ becomes -12.5. A notice appears above the editor for about four seconds. IME composition is left untouched until committed. Names and text strings are not converted. Existing numeric limits and project formats are retained.

UI revision: fullwidth1. 実機未確認。
