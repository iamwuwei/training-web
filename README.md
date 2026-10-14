# training-web

富士山マラソン 2026 訓練課表的手機版前端，線上網址 **https://make-it.life4like.com**。React Router v7 framework mode（Remix 的後繼）、SPA 模式、TypeScript，資料來自 [training-api](https://github.com/iamwuwei/training-api)，部署到 Cloudflare Pages。

## 畫面

| 路徑 | 畫面 |
|---|---|
| `/login` | Sign in with Apple（只有一顆按鈕） |
| `/` | 今天：累積跑量、今天課表、下次三次練習、最新報告、本週進度 |
| `/plan` | 課表：11 週跑量長條、每週每天的課表，非本週休息日折疊 |
| `/history` | 紀錄：所有跑過的練習（含未排課），可依類型與「有提醒」篩選 |
| `/activities/:id` | 單次報告：數字、判定與提醒、每公里、同類型比較、天氣與裝備 |

底部三個 tab：今天 / 課表 / 紀錄。報告頁從「今天」或「紀錄」點進去。

## 開發

```sh
npm install
cp .env.example .env   # 不填 VITE_API_URL 就跑內建示範資料
npm run dev            # http://localhost:5173
npm run typecheck      # react-router typegen + tsc
npm run lint
npm run build          # 靜態檔輸出到 build/client
npm run preview
```

### 環境變數

| 變數 | 說明 |
|---|---|
| `VITE_API_URL` | training-api 的 `ApiUrl`（Lambda Function URL，不含結尾斜線）。留空＝示範資料模式 |
| `VITE_AUTH_URL` | training-api 的 `AuthUrl` |
| `VITE_APPLE_CLIENT_ID` | Sign in with Apple 的 Services ID，和後端 `APPLE_CLIENT_ID` 相同 |
| `VITE_DEV_TOKEN` | 只在本機用：直接當 session token，跳過 Apple 登入（Apple JS SDK 不接受 localhost）。Cloudflare 上不要設 |

示範資料是 training-api 的 `seed/plans.json`（`app/mock/plans.json`），課表改了就重新複製一份。

## 資料流

- `routes/_app.tsx` 的 `clientLoader` 打一次 `GET /plan`，三個 tab 共用（`app/lib/use-plan.tsx`）。
- `/history` 與報告頁打 `GET /activities`，才看得到未配對課表的跑步。
- 所有衍生數字（累積、達成率、本週、跳過）在 `app/lib/plan.ts` 算；「跳過」＝日期已過、非休息日、沒有配對 activity，API 沒有這個狀態。
- 所有日期以日本時間為準（`app/lib/date.ts`）。
- API 型別 `app/types/api.ts` 直接複製自 training-api 的 `types/api.ts`，後端改了就再複製。

## 顏色規則

底是黑白灰，顏色只給需要一眼區分的符號（`app/lib/labels.ts`）：

- 類型頭像：Easy / Recovery 藍、Long 紫、MP / 坡跑 / 快步 橘、比賽 紅、休息 / 肌力 空心灰。
- 判定小色點：達成 綠、達成但有提醒 琥珀、未達成 紅、跳過 灰。
- 超出課表上限的心拍、快過下限的配速，數字本身變紅。
- 進度條：進行中灰，達標綠。

## 部署（Cloudflare Workers）

Workers & Pages → Create → Workers → Import a repository，選這個 repo：

| 設定 | 值 |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Environment variables | `VITE_API_URL`、`VITE_AUTH_URL`、`VITE_APPLE_CLIENT_ID`（Build 階段要看得到） |

`wrangler.jsonc` 把 `build/client` 當靜態資產上傳，`not_found_handling: single-page-application` 讓所有路徑回到 `index.html`，並把 `make-it.life4like.com` 綁成 custom domain。這個網域要填進 training-api 的 `CORS_ORIGIN`（`https://make-it.life4like.com`），以及 Apple Services ID 的 Web Authentication：Domain `make-it.life4like.com`、Return URL `https://make-it.life4like.com`。

CLI 手動部署：`npm run build && npx wrangler deploy`。
