# training-web

富士山マラソン 2026 訓練課表的前端。Vite + React + TypeScript，部署到 Cloudflare Pages。

## 開發

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # 型別檢查 + 打包到 dist/
npm run preview  # 本機預覽 dist/
npm run lint
```

## 部署（Cloudflare Pages）

在 Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git，選這個 repo，設定：

| 設定 | 值 |
|---|---|
| Production branch | `main` |
| Root directory | `training-web` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION=22`（也可讀 `.nvmrc`） |

`public/_redirects` 把所有路徑導回 `index.html`，之後加 client-side routing 不會 404。

也可以用 CLI 手動部署：

```sh
npm run build
npx wrangler pages deploy dist
```

## 結構

```
training-web/
├── public/          # 原樣複製到 dist/（favicon、_redirects）
├── src/
│   ├── lib/race.ts  # 比賽日、JST 日期工具
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── wrangler.jsonc
└── vite.config.ts
```
