import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { Route } from "./+types/root";
import { FeedSkeleton } from "./components/ui";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Noto+Sans+TC:wght@400;500;700&display=swap",
  },
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
];

export const meta: Route.MetaFunction = () => [
  { title: "富士山マラソン 2026 訓練" },
  { name: "description", content: "富士山マラソン 2026 訓練課表與每次練習紀錄" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0f1013" media="(prefers-color-scheme: dark)" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  return <Outlet />;
}

/** Shown on first paint while clientLoaders run. */
export function HydrateFallback() {
  return (
    <div className="shell">
      <header className="topbar"><h1>富士山マラソン 2026</h1></header>
      <main><FeedSkeleton /></main>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "出了點問題";
  let detail = "";
  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? "找不到這一頁" : `錯誤 ${error.status}`;
    detail = typeof error.data === "string" ? error.data : "";
  } else if (error instanceof Error) {
    detail = error.message;
  }
  return (
    <div className="shell">
      <header className="topbar"><h1>{title}</h1></header>
      <main>
        <p className="empty">{detail || "重新整理再試一次。"}</p>
        <p className="note"><a href="/" style={{ color: "var(--ink-2)", textDecoration: "underline" }}>回首頁</a></p>
      </main>
    </div>
  );
}
