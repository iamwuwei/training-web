# design/

設計稿（Claude Design canvas）的原始檔，給改畫面時對照用。**畫面的真相仍是 `app/`**；這裡是「想要長成什麼樣」。

- 來源：https://claude.ai/artifact/4Lc98VDehARXEZpFUfBZ7h（`training-web 設計稿`）
- 這份快照：artifact version `1791995197-5aa7`
- 每個 `*.dc.html` 是一個 390 px 寬的手機畫面（artboard），數字是 2026-10-14 視角的範例資料；`canvas.json` 是畫布索引（位置、尺寸、旁註）。
- `*.dc.html` 引用的 `support.js` 是 Design canvas 的 runtime，沒有放進來，所以直接用瀏覽器開不會正常渲染；看樣式與結構就好，或回到上面的連結看。

## 畫面對照

| 設計稿 | 路由 | 實作 |
|---|---|---|
| `Login.dc.html` | `/login` | `app/routes/login.tsx` |
| `Main.dc.html` | `/` 今天 | `app/routes/_app._index.tsx` |
| `Weeks.dc.html` | `/plan` 課表 | `app/routes/_app.plan.tsx` |
| `History.dc.html` | `/history` 紀錄 | `app/routes/_app.history.tsx` |
| `Settings.dc.html` | `/settings` 設定 | `app/routes/_app.settings.tsx` |
| `Report.dc.html` | `/activities/:id` 單次報告 | `app/routes/_app.activities.$id.tsx`、`app/components/memo.tsx` |

## 設計規則（canvas 旁註）

- 視覺：Threads 式極簡。純白底、墨色 `#14161B`、次要文字 `#5C6370`、淡灰 `#8A909C`，1 px 分隔線 `#ECEDF0`，沒有卡片。
- 顏色只給需要一眼區分的符號；對應的實作在 `app/lib/labels.ts` 與 `app/app.css`（README 的「顏色規則」有完整清單）。
- 字體：Noto Sans TC 內文，數字 Barlow Condensed。
- 導覽：底部 tab（今天 / 課表 / 紀錄 / 設定）；報告頁不在 tab 裡，從「今天」或「紀錄」點進去。

## 更新這份快照

設計稿改了之後，把整份重新抓下來蓋過這個資料夾（`project/` 底下的 `canvas.json` 與所有 `*.dc.html`），並更新上面的 version。
