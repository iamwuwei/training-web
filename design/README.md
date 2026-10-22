# design/

設計稿（Claude Design canvas）的原始檔，給改畫面時對照用。**畫面的真相仍是 `app/`**；這裡是「想要長成什麼樣」。

- 來源：https://claude.ai/artifact/4Lc98VDehARXEZpFUfBZ7h（`training-web 設計稿`）
- 這份快照：artifact version `1792598525-0fc0`
- 每個 `*.dc.html` 是一個 390 px 寬的手機畫面（artboard），數字是 2026-10-14 視角的範例資料；`canvas.json` 是畫布索引（位置、尺寸、旁註）。
- `*.dc.html` 引用的 `support.js` 是 Design canvas 的 runtime，沒有放進來，所以直接用瀏覽器開不會正常渲染；看樣式與結構就好，或回到上面的連結看。

## 畫面對照

| 設計稿 | 路由 | 實作 |
|---|---|---|
| `Login.dc.html` | `/login` | `app/routes/login.tsx` |
| `Main.dc.html` | `/` 今天（狀態 B） | `app/routes/_app._index.tsx` |
| `Proposal-TodayA〜E.dc.html` | `/` 今天的五種狀態 | `app/routes/_app._index.tsx` |
| `Proposal-LogSession.dc.html` | `/sessions/:id` 記錄訓練 | `app/routes/_app.sessions.$id.tsx` |
| `Weeks.dc.html` | `/plan` 課表 | `app/routes/_app.plan.tsx` |
| `History.dc.html` | `/history` 紀錄 | `app/routes/_app.history.tsx` |
| `Settings.dc.html` | `/settings` 設定（從「今天」的齒輪進） | `app/routes/_app.settings.tsx` |
| `Coach.dc.html` | `/coach` 教練 Woo 的時間軸與輸入框 | `app/routes/_app.coach.tsx`、`app/components/proposals.tsx` |
| `Checkin-0/1/2.dc.html` | 跑完的流程：今天頁入口 → Woo 問哪一個活動（chip）→ 接著問感受（RPE 列） | `app/routes/_app._index.tsx`、`app/routes/_app.coach.tsx` |
| `Lively-*.dc.html` | 活潑版（主色只在好事上、大數字、Woo 的狀態與一句話、慶祝色帶），全部畫面 | `app/app.css`（`--accent`、`.hero2`、`.wooline`、`.celebrate`、動態）、今天／教練／報告三個 route；報告頁的趨勢圖另做 |
| `Report.dc.html`、`Proposal-ReportMP.dc.html` | `/activities/:id` 單次報告（單一配速／組合課） | `app/routes/_app.activities.$id.tsx`、`app/components/memo.tsx` |

## 設計規則（canvas 旁註）

- 視覺：Threads 式極簡。純白底、墨色 `#14161B`、次要文字 `#5C6370`、淡灰 `#6B7180`（白底 4.9:1），1 px 分隔線 `#ECEDF0`，沒有卡片。
- 活潑感：一個主色珊瑚 `#F0553A`（`--accent`）只用在好事上：達成、倒數數字、達標的週、慶祝色帶、Woo 頭像的勾；琥珀與紅不變。大數字一個畫面一個主角（倒數 56px、本週 40px、貼文 26px、報告頂部 40px）。動態 200〜400ms：進度條長到位、判定色點彈一下、新訊息滑進來，都遵守 `prefers-reduced-motion`。
- 元件：區塊標題 13px 粗體；小動作一律外框膠囊按鈕（高 32px）；主要動作是全寬黑色按鈕，一個畫面最多一個；底部 tab 有文字。
- 顏色只給需要一眼區分的符號；對應的實作在 `app/lib/labels.ts` 與 `app/app.css`（README 的「顏色規則」有完整清單）。
- 字體：Noto Sans TC 內文，數字 Barlow Condensed。
- 導覽：底部 tab（今天 / 課表 / 紀錄 / 教練）；設定在「今天」右上的齒輪；報告頁不在 tab 裡，從「今天」、「紀錄」或教練訊息點進去。課表頁點長條切換週。
- 教練 tab：Woo 有新訊息（週回顧、判定、回話）時圖示右上角一個 8px 墨點，打開教練頁就消；`Main.dc.html` 畫的是有新訊息的狀態。
- 教練頁：Woo 的頭像是墨色圓盤「W」；他的訊息沒有氣泡（像 Threads 的貼文），跑者的訊息是右側淡灰氣泡（整個 app 唯一的氣泡）；輸入框固定在 tab 上方，引用的活動以細線 chip 顯示。

## 更新這份快照

設計稿改了之後，把整份重新抓下來蓋過這個資料夾（`project/` 底下的 `canvas.json` 與所有 `*.dc.html`），並更新上面的 version。
