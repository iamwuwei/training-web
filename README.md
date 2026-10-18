# training-web

富士山マラソン 2026 訓練課表的手機版前端，線上網址 **https://make-it.life4like.com**。React Router v7 framework mode（Remix 的後繼）、SPA 模式、TypeScript，資料來自 [training-api](https://github.com/iamwuwei/training-api)，登入走 Cognito，部署在 Cloudflare Workers。

## 畫面

| 路徑 | 畫面 |
|---|---|
| `/login` | 一顆登入按鈕，導向 Cognito hosted UI（可設成直接走 Apple） |
| `/` | 今天：本週進度、今天課表與 Strava 活動、記錄這次訓練、下次三次練習；右上齒輪進設定 |
| `/plan` | 課表：11 週跑量長條、每週每天的課表，非本週休息日折疊 |
| `/history` | 紀錄：所有跑過的練習（含未排課），可依類型與「有提醒」篩選 |
| `/activities/:id` | 單次報告：教練判定先講、目標 vs 實際、**我的心得（RPE ＋ 文字，可編輯）**、每公里、同類型比較；「問教練」把這次活動引用到教練頁 |
| `/coach` | 教練 Woo：時間軸（每週回顧＋建議的採用／略過、每次練習的判定、對話），底部輸入框可以問他；只回跑步與課表相關 |
| `/settings` | 設定：帳號、Strava 連結、登出 |

底部四個 tab：今天 / 課表 / 紀錄 / 教練（Woo 有新訊息時圖示上有一個小點，打開教練頁就消）。報告頁從「今天」、「紀錄」或教練的訊息點進去；設定從「今天」右上的齒輪進去。

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
| `VITE_API_URL` | training-api 的 `ApiUrl`（API Gateway，自訂網域 `https://make-it-api.life4like.com`），不含結尾斜線。留空＝示範資料模式 |
| `VITE_COGNITO_DOMAIN` | `cdk deploy` 的 `CognitoDomain` 輸出，例如 `https://training-api-prod-123456.auth.ap-northeast-1.amazoncognito.com` |
| `VITE_COGNITO_CLIENT_ID` | `UserPoolClientId` 輸出 |
| `VITE_COGNITO_IDP` | 選填。設 `SignInWithApple` 會跳過 hosted UI 直接開 Apple 登入；後端要有部署 `APPLE_*` 四個變數 |

本機 `npm run dev` 也能真的登入：後端 `CORS_ORIGIN` 含 `http://localhost:5173` 時，Cognito 的 callback 也會註冊它。

### 登入流程

`app/lib/auth.ts`，不用 Amplify：
1. `/login` 按鈕 → 產 PKCE verifier/challenge 與 state 存 sessionStorage → 導向 `<CognitoDomain>/oauth2/authorize`。
2. Cognito 回到 `/?code=…&state=…`，`routes/_app.tsx` 的 `clientLoader` 用 code 換 token（`/oauth2/token`），把 ID token 與 refresh token 存 localStorage，再導回 `/`。
3. 每個 API 請求帶 `Authorization: Bearer <ID token>`；快過期時自動用 refresh token 換新的。
4. API 回 401 → 清掉 token 回登入頁；回 403 → 顯示「尚未加入名單」並提供登出。

示範資料是 training-api 的 `seed/plans.json`（`app/mock/plans.json`），課表改了就重新複製一份。

## 資料流

- `routes/_app.tsx` 的 `clientLoader` 打一次 `GET /plan`，四個 tab 共用（`app/lib/use-plan.tsx`）。
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
| Environment variables | `VITE_API_URL`、`VITE_COGNITO_DOMAIN`、`VITE_COGNITO_CLIENT_ID`（Build 階段要看得到） |

`wrangler.jsonc` 把 `build/client` 當靜態資產上傳，`not_found_handling: single-page-application` 讓所有路徑回到 `index.html`，並把 `make-it.life4like.com` 綁成 custom domain。這個網域要填進 training-api 的 `CORS_ORIGIN`（`https://make-it.life4like.com`），它同時決定 API 的 CORS 和 Cognito 的 callback / logout URL。

CLI 手動部署：`npm run build && npx wrangler deploy`。
