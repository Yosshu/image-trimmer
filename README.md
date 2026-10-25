# image-trimmer

Windows 11 の「フォト」アプリにある画像編集の **トリミング** を、見た目と操作感ごと Web 上で再現したツールです。

**公開ページ：** https://yosshu.github.io/image-trimmer/

画像はブラウザの中だけで処理され、どこにも送信されません。

## できること

- **傾き補正**：目盛りのスライダーで −45°〜+45°（0.1° 単位）。回転しても枠に余白が入らないよう、自動で拡大します
- **90° 回転**：時計回り・反時計回り。枠も一緒に回ります（16:9 → 9:16）
- **反転**：左右・上下
- **縦横比**：自由 / オリジナル / 正方形 / 9:16 / 16:9 / 4:5 / 5:4 / 3:4 / 4:3 / 2:3 / 3:2 / 5:7 / 7:5 / 1:2 / 2:1
- **範囲の調整**：四隅・各辺のハンドルをドラッグ。枠の内側をドラッグすると画像がスライドします
- **ズーム**：ボタン・マウスホイール・Ctrl + / Ctrl −
- **リセット・元に戻す・やり直し**：Ctrl+Z / Ctrl+Y
- **保存オプション**
  - コピーとして保存：PNG / JPEG / TIFF / BMP。元の解像度で書き出します
  - クリップボードにコピー
- 画像の読み込み：ファイル選択、ドラッグ＆ドロップ、Ctrl+V で貼り付け
- ライト／ダークは OS の設定に合わせて切り替わります

### キーボード操作

| 対象 | キー | 動作 |
|---|---|---|
| 角度スライダー | ← → | 1° ずつ回転（Shift と一緒に押すと 0.1°） |
| トリミング枠 | ← ↑ → ↓ | 枠を動かす（Ctrl と一緒に押すと 10 倍） |
| トリミング枠 | Shift + ← ↑ → ↓ | 枠の大きさを変える |
| どこでも | Ctrl+Z / Ctrl+Y | 元に戻す / やり直し |
| どこでも | Ctrl + / Ctrl − | ズームイン / ズームアウト |

## 開発

```sh
npm install
npm run dev      # 開発サーバー
npm test         # ユニットテスト（Vitest）
npm run build    # 型チェックとビルド（dist/）
```

`main` と作業ブランチへのプッシュで、GitHub Actions が GitHub Pages に公開します（`.github/workflows/deploy.yml`）。

### 構成

| ファイル | 内容 |
|---|---|
| `src/geometry.ts` | 回転・枠の制限・比率・ズームなどの幾何計算（純粋な関数） |
| `src/state.ts` | 編集の状態と、元に戻す・やり直しの履歴 |
| `src/editor.ts` | 編集画面（描画と操作） |
| `src/ruler.ts` | 角度スライダーの目盛り |
| `src/export.ts` / `src/encoders.ts` | 書き出し（PNG・JPEG・TIFF・BMP）、保存、クリップボード |
| `docs/SPEC.md` | 仕様（本家の実測値など） |
| `docs/PLAN.md` | 実装計画 |

## クレジット

- アイコン：[Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons)（Microsoft、MIT ライセンス）
- Windows・Microsoft は Microsoft Corporation の商標です。このツールは Microsoft とは関係のない非公式のものです。
