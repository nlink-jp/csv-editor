# RFP: csv-editor

> 作成日: 2026-05-14
> ステータス: Draft

## 1. 課題定義

既存の CSV 編集ツール、特に macOS で広く使われている **TableTool** には複数の
限界がある:

1. **メンテナンス停止** — 改修要求を上流に投げる経路がなく、不満点を解消できない。
2. **Intel Mac 専用バイナリ** — ARM64 専用となる次期 macOS では動作不能になる
   見込み。
3. **UTF-8 固定** — Shift_JIS / CP932 でしか読めない Excel との CSV やりとり時に
   外部での文字コード変換が必要になる。
4. **行・列単位のコピー操作が無い** — 表計算ツールでは当たり前の操作ができない。
5. **TSV ペーストが単一セル流し込みになる** — クリップボードのタブ区切りテキストを
   貼り付けると、複数セルに展開されず 1 セルに塊として入る。

`csv-editor` は、これらを **自分の手で改修可能な形で** 解消する、Windows /
macOS 両対応の CSV / TSV 専用 GUI エディタである。表計算ソフトの代替ではなく、
あくまで CSV/TSV ビューワ＆エディタとしての完成度を目指す。

### 対象ユーザ

第一義的には開発者本人（日本語データを扱う個人ユーザ）。表計算機能は不要だが、
CSV/TSV の取り回しに不満を抱えるユーザ全般に有用となるよう、最終的には OSS として
GitHub で公開する。

## 2. 機能仕様

### 入出力エンコーディング

| 操作 | 対応エンコーディング | 方針 |
|------|--------------------|------|
| 読み込み | UTF-8 (BOM 有/無), Shift_JIS, CP932 | 自動判定。誤判定時は画面上で再指定して再読込 |
| 書き出し | UTF-8 (BOM 有/無), Shift_JIS, CP932 | ユーザーが書き出し時に選択。設定の既定値あり |

その他のエンコーディング (UTF-16, EUC-JP 等) は当面対応しない。

### 改行コード

- **読み込み時**: 自動判定 (CRLF / LF / CR 混在は許容)
- **書き出し時**: 設定または書き出し時ダイアログで指定 (CRLF / LF)

### 想定規模と性能

- 最大想定: **数十万行**
- → **仮想スクロール必須**。全データはメモリに保持するが、描画は可視範囲のみ。

### CSV / TSV 方言

- **区切り文字**: CSV (`,`) と TSV (`\t`) をネイティブ両対応。同一ウィンドウ
  内ではファイル種別に応じて自動切替。
- **クォート**: RFC 4180 準拠 (`"..."` でフィールド囲み、`""` でエスケープ)。
- **ヘッダ行**: ユーザーがファイル単位で有/無を指定。

### 編集操作

| 操作カテゴリ | 内容 |
|-------------|------|
| セル | IME 安全な編集 (compositionend を待つ)、Enter 確定、Esc キャンセル |
| 行 | 挿入 / 削除 / 複製 / 並べ替え (ドラッグ)、複数行一括 |
| 列 | 挿入 / 削除 / 複製 / 並べ替え (ドラッグ)、複数列一括 |
| 履歴 | Undo / Redo (深さ ~50 ステップ) |
| 検索 | インクリメンタル検索 + 正規表現対応 |
| 置換 | 全置換 / 一件ずつ確認 |
| ソート | 列指定、文字列/数値、昇順/降順、複数キー |
| 列幅 | 手動調整 + 自動フィット |
| 型推定 | 数値列の右寄せ等、視認性向上のみ。型変換はしない |

### クリップボード仕様 (不満点解消の中心)

| 操作 | 挙動 |
|------|------|
| セル選択コピー | クリップボードに TSV 形式で書き込む (Excel 互換) |
| 行選択コピー | 行全体を TSV で (複数行可) |
| 列選択コピー | 列全体を TSV で (複数列可) |
| 単一セルへの TSV ペースト | タブ / 改行で分割し、複数セルに展開 |
| 複数セル選択への TSV ペースト (形状一致) | そのまま貼り付け |
| 複数セル選択への TSV ペースト (形状不一致) | **警告ダイアログを表示してユーザー確認** |

### ファイル操作

- 新規 / 開く / 保存 / 名前を付けて保存 (エンコーディング・改行選択ダイアログ付き)
- **1 ウィンドウ 1 ファイル**。複数ファイルは複数ウィンドウで開く
- ドラッグ & ドロップで開く
- 最近使ったファイル履歴 (10 件)

### カラーテーマ

- OS のダーク/ライトモード設定に**自動追従** (macOS の Appearance、Windows の
  Light/Dark) を必須とする
- 実装は CSS カスタムプロパティ + `@media (prefers-color-scheme: dark)` を
  ベースとし、Phase 1 から組み込む (後付けにすると CSS 全体の書き直しに
  なるため)
- 将来的には設定でユーザー上書き (Auto / Light / Dark) を提供するが、Phase 1
  時点では OS 追従のみで可

### 設定保存

OS 標準位置に JSON ファイル 1 個を保存:

- macOS: `~/Library/Application Support/csv-editor/config.json`
- Windows: `%APPDATA%\csv-editor\config.json`

保存項目 (現状は最近使ったファイルのみ実装。他は将来の拡張余地):
- 最近使ったファイル (10 件)
- (将来) 書き出しエンコーディング・改行コードの既定値
- (将来) ウィンドウサイズ・位置、フォント、テーマ設定

列幅は当面セッション内 (メモリ) のみで保持する。永続化は実用上の必要性が
強くないため Out of Scope とする (Discussion Log §9 参照)。

### 外部依存

外部 API は呼び出さない。ローカルファイルの読み書きと設定ディレクトリへの
書き込みのみ。

## 3. 設計判断

### フレームワーク選定: Wails (Go) + React/TypeScript + TanStack Table

候補比較:

| 候補 | バイナリサイズ | テーブル性能 | IME | 既存 nlink 資産 |
|------|---------------|------------|-----|----------------|
| **Wails (採用)** | 数 MB | ◎ (TanStack Table 仮想化) | △〜○ (WebView IME を丁寧に実装) | ◎ (Go) |
| Tauri | 数 MB | ◎ | △〜○ | 無 |
| Flutter Desktop | 20 MB 前後 | ○ | ○ | 無 |
| Qt + PySide6 | 50 MB+ | ◎ (QTableView ネイティブ) | ◎ | △ (Python) |
| Electron | 100 MB+ | ○ | ○ | 無 |

**決め手:**

1. **Go 採用で util-series との一貫性** — 既存 `csv-to-json`, `json-to-table`,
   `shell-agent-v2` 等の Go 資産・実装ノウハウを活用できる。
2. **単一実行ファイル配布** — Python (PySide6) は展開コストが大きく却下。
3. **数十万行を仮想化で扱える** — TanStack Table の仮想化で実現可能。
4. **モダンな UI 構築** — React で柔軟に。Apple Silicon ネイティブビルドも標準対応。

**IME 確定挙動** が不満点解消の鍵であり、WebView の `compositionstart` /
`compositionend` を丁寧に処理する必要がある点を留意する。

### 配布形態

OS ごとに **単一実行ファイル** (macOS: `.app`, Windows: `.exe`) を Wails の標準
ビルドで生成する。

### 既存 nlink-jp 資産との関係

util-series の CSV 系 CLI ツール (`csv-to-json`, `json-to-table` 等) と
**補完関係** にある:
- CLI: パイプ処理・スクリプト組み込み
- `csv-editor` (GUI): 対話的な閲覧・編集

### Out of Scope (明示的に対象外)

- 数式 / 関数 (Excel の `=SUM()` 等)
- 複数シート / ワークブック構造
- グラフ描画
- xlsx / ods 等の Excel ネイティブフォーマットの読み書き
- マクロ / スクリプト機能
- 共同編集 / クラウド同期
- **フィルタ** (列条件での行絞り込み — Phase 3 検証中に Out of Scope 化)
- **フリーズペイン** (列の固定 — Phase 3 検証中に Out of Scope 化)

これらは **CSV/TSV 専用ツール** という位置づけを崩すため、本プロジェクトでは
対応しない。

## 4. 開発計画

### Phase 1: Core (read-only)

- Wails プロジェクト雛形
- ファイル読込 (自動エンコーディング判定)
- 仮想スクロール表示
- 文字コード再指定 → 再読込
- セル選択

→ ここまでで「読めるだけ」だが、独立して PR レビュー可能。

### Phase 2: Editing

- セル編集 (IME 対応)
- 行 / 列の挿入・削除・複製・並べ替え
- クリップボード (コピー = TSV、ペースト = TSV 分割、形状不一致は警告ダイアログ)
- Undo / Redo
- ヘッダ行設定
- 保存 (エンコーディング・改行選択)

### Phase 3: Productivity

- 検索 (インクリメンタル + 正規表現)
- 置換 (全置換 / 一件ずつ)
- ソート (複数キー)
- 列幅自動フィット
- 最近使ったファイル
- ドラッグ & ドロップ

### Phase 4: Release

- macOS / Windows ビルド設定
- アイコン
- README / README.ja 整備
- GitHub Releases での配布
- 未署名配布の README 案内 (Gatekeeper / SmartScreen 回避手順)

各 Phase は独立に PR レビュー可能。

### テスト方針

- **Go 層**: CSV/TSV パーサ、エンコーディング判定、Undo/Redo スタック、
  クリップボード変換 — テーブル駆動の単体テスト必須 (CONVENTIONS.md ルール)。
- **React 層**: コンポーネントテスト (Vitest + React Testing Library)。
  特に IME 入力、仮想スクロール、TSV ペースト分割。
- **E2E**: Phase 4 まで手動チェックリストで運用。Playwright 等の自動化は
  必要に応じて Phase 4 で検討。

## 5. 必要な API スコープ / 権限

外部 API 呼び出しは **無し**。

ランタイムの権限:
- ファイルシステム読み書き (OS 標準のファイル選択ダイアログ経由)
- 設定ディレクトリへの書き込み (OS のアプリサポートディレクトリ)

配布証明書:
- macOS: Apple Developer Program (年 $99) には当面加入しない → **未署名配布**
- Windows: コード署名証明書 (年数万円) も当面取得しない → **未署名配布**
- README に macOS Gatekeeper / Windows SmartScreen 警告の回避手順を記載する。

## 6. シリーズ配置

**Series**: `util-series`

**Reason**: util-series は当初 "Pipe-friendly data transformation and
processing CLIs" として定義されていたが、現時点で既に `mail-analyzer-gui`,
`markdown-viewer`, `quick-translate` 等の GUI アプリを含んでおり、データ系
ツールの統括シリーズとして拡張されている。`csv-editor` は CSV/TSV データ加工
ツール群と補完関係にあり、util-series に配置するのが自然。

## 7. 外部プラットフォーム制約

### macOS

- WebView は WebKit (OS 同梱) を使用
- Apple Silicon (ARM64) を主たるターゲットとする。Intel Mac は当面ビルド可能
  だが優先しない (TableTool の問題と同じ轍は踏まない方針)
- Gatekeeper の警告は未署名配布のため発生する。README で右クリック → 開く
  の回避手順を案内

### Windows

- Edge WebView2 ランタイムを使用
- **Windows 11 のみサポート** (WebView2 が OS 同梱されるため)
- Windows 10 は WebView2 ランタイムの別途バンドルが必要となり、保守負荷を
  抑えるため対象外とする
- SmartScreen 警告は未署名配布のため発生する。README で「詳細情報 → 実行」
  の回避手順を案内

### 配布チャネル

- 当面 GitHub Releases のみ
- Mac App Store / Microsoft Store への登録は将来の検討事項

---

## Discussion Log

本セッション (2026-05-14) における主要な判断点:

### 1. シリーズ配置の議論

当初、util-series の CONVENTIONS 定義が "Pipe-friendly CLI" となっていたため、
GUI アプリを含むには新シリーズ (`desktop-series` / `gui-series`) を起こすか、
`lab-series` で開始するかを提案した。しかしユーザーが util-series の実態を
確認したところ、既に `mail-analyzer-gui`, `markdown-viewer`, `quick-translate`
等の GUI アプリが含まれており、定義が事実上拡張済みであることが判明。
**util-series で進める** ことに決定。

### 2. フレームワーク選定

Tauri / Wails / Flutter / Qt+PySide6 / Electron を比較。決め手:

- (a) **Go 採用** で util-series との一貫性を保てる
- (b) **単一実行ファイル配布** が要件。Python (PySide6) は展開コストが
  大きく却下
- (c) **TanStack Table の仮想化** で数十万行に対応可能
- (d) IME 確定挙動は WebView 系の共通課題だが、`compositionend` を丁寧に
  扱えば対応可能と判断

→ **Wails (Go) + React/TypeScript + TanStack Table** で確定。

### 3. ペースト形状不一致時の挙動

クリップボードの TSV を複数セル選択に貼り付けるとき、形状が一致しない場合の
扱いを 3 案から選択:

- (A) Excel 流: 選択範囲を無視してクリップ形状で貼り付け
- (B) 一部スプレッドシート流: 選択範囲にクリップ → 余剰捨て / 不足は繰り返し
- (C) 警告ダイアログを出す

**ユーザー意図の確認を優先する観点から (C) を採用**。データ破壊リスクを抑える
判断。

### 4. Windows 10 対応の見送り

Edge WebView2 ランタイムが Windows 11 に同梱され、Win10 では別途バンドルが
必要となる。個人プロジェクトとしての保守負荷を抑えるため、Windows 11 限定と
する。

### 5. 配布署名の方針

Apple Developer Program ($99/年) と Windows コード署名証明書 (年数万円) の
コスト負担を避け、**当面未署名で公開**。README に macOS Gatekeeper /
Windows SmartScreen の回避手順を記載する。ユーザーが増えた段階で再検討。

### 6. テスト方針

CONVENTIONS.md の「テストは実装と同時に必須」を踏まえ、Go 層はテーブル駆動の
単体テスト必須、React 層は Vitest+RTL でコンポーネントテスト。E2E は Phase 4
まで手動チェックリストで運用し、自動化は必要に応じて検討する。

### 7. カラーテーマ必須化 (Phase 2 スキャフォールド検証中に追加)

スキャフォールド完了後の動作確認で、テーマ対応が漏れていることが判明。後付け
にすると CSS の大規模書き直しになるため、**Phase 1 から CSS カスタム
プロパティ + `prefers-color-scheme` で OS 追従** とする方針を確定。ユーザー
上書き設定 (Auto/Light/Dark) は Phase 3 以降で追加可。

### 9. フィルタ / フリーズペインを Out of Scope 化 (Phase 3 中盤に決定)

RFP §2 で機能列挙していたフィルタ (列条件での行絞り込み) と
フリーズペイン (列固定) について、Phase 3 の他機能 (検索/置換、ソート、
列幅、D&D、Recent Files) が一通り揃った時点で **当面実装しない** ことを
ユーザーが決定。

**理由 / 背景:**
- 検索 + ソートで多くの "見つけたい/並べたい" ユースケースはカバー
  できている
- 行/列の隠し表示やフリーズはエディタの読み取り性能向上策で、
  CSV エディタとしての編集機能の本質ではない
- 仮想スクロールでヘッダ行は既に sticky になっており、フリーズが
  特に役立つのは「先頭列も固定」のケース。利用頻度が確かでない

将来必要になれば再導入を検討するが、現時点では §3 の Out of Scope に
**フィルタ・フリーズペイン** を追加。

同じく **列幅の永続化** (RFP §2 で設定保存項目として記載されていた) も
Out of Scope とする。セッション内では手動調整 + auto-fit が効くので、
ファイルごとの永続化の必要性が確認できるまでは保留。

### 8.5 出力エンコーディングに UTF-8-BOM を追加 (Phase 2 chunk B 検証中に決定)

当初 RFP §2 では出力対応を **UTF-8 (BOM なし) / Shift_JIS / CP932** に限定して
いたが、BOM 付き UTF-8 ファイルを開いて編集 → Save As しようとした際に
"UTF-8-BOM is not a writable encoding" エラーが発生。

選択肢:
- (A) 内部で UTF-8-BOM → UTF-8 へ silent map (BOM が剥がれる)
- (B) BOM 付き UTF-8 を書き出しでもサポート (read = write 対称)

ユーザーの判断で **(B)** を採用。

**理由:**
- 開いたファイルをそのまま書き戻せる (round-trip 保存)
- 日本語 Windows の Excel は UTF-8 + BOM を好む (BOM なしだと CP932 と
  誤判定するケースがある)
- read と write の対応エンコーディングが対称になり、メンタルモデルが簡潔

`encoding.Encode(text, UTF8BOM)` は EF BB BF をプレフィックスしてから
UTF-8 バイトを書く。`SupportedReadEncodings` と `SupportedWriteEncodings`
は同一セットを返す。

### 8. ネイティブタイトルバー採用 (Phase 2 スキャフォールド検証中に決定)

初期スキャフォールドでは macOS 透過タイトルバー (`FullSizeContent: true` +
`TitlebarAppearsTransparent: true`) を採用していたが、(a) ウィンドウドラッグ
領域を自前で `--wails-draggable: drag` で確保する必要があり、(b) OS 描画の
タイトルと React 側のタイトルが二重描画される問題があった。CSV エディタは
ユーティリティアプリであり奇抜さは不要なので、**OS 標準タイトルバーを使う**
方針に切替。タイトルバーには開いているファイル名を表示する
(例: `data.csv — CSV Editor`)、Phase 2 以降で `runtime.WindowSetTitle`
経由で動的に更新する。
