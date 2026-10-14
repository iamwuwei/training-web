import { useEffect, useState } from "react";
import { redirect, useNavigate } from "react-router";
import type { Route } from "./+types/login";
import { AppleIcon, MountainIcon } from "../components/icons";
import { ApiError, loginWithApple } from "../lib/api";
import { getToken, setSession } from "../lib/auth";
import { config, useMock } from "../lib/config";
import { dayDiff, todayJst } from "../lib/date";

const RACE_DAY = "2026-12-14";
const APPLE_SDK = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/zh_TW/appleid.auth.js";

declare global {
  interface Window {
    AppleID?: {
      auth: {
        init(cfg: { clientId: string; scope: string; redirectURI: string; usePopup: boolean }): void;
        signIn(): Promise<{ authorization: { id_token: string; code: string } }>;
      };
    };
  }
}

export function clientLoader() {
  if (getToken()) throw redirect("/");
  return null;
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "登入 · 富士山マラソン 2026" }];
}

function loadAppleSdk(): Promise<void> {
  if (window.AppleID) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = APPLE_SDK;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Apple SDK 載入失敗"));
    document.head.appendChild(s);
  });
}

export default function Login() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = dayDiff(todayJst(), RACE_DAY);

  useEffect(() => {
    if (!useMock && config.appleClientId) void loadAppleSdk().catch(() => {});
  }, []);

  async function signIn() {
    setError(null);
    if (useMock) { void navigate("/", { replace: true }); return; }
    if (!config.appleClientId) { setError("尚未設定 VITE_APPLE_CLIENT_ID"); return; }
    setBusy(true);
    try {
      await loadAppleSdk();
      const apple = window.AppleID!;
      apple.auth.init({ clientId: config.appleClientId, scope: "email", redirectURI: window.location.origin, usePopup: true });
      const { authorization } = await apple.auth.signIn();
      const res = await loginWithApple(authorization.id_token);
      setSession(res.token, res.user);
      void navigate("/", { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setError("這個 Apple ID 還沒被加進名單。");
      else if (e instanceof Error && /popup_closed|user_cancelled/i.test(e.message)) setError(null);
      else setError(e instanceof Error ? e.message : "登入失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="mid">
        <MountainIcon width={72} height={72} strokeWidth={1.6} />
        <div>
          <div className="eyebrow">2026 · 12 / 14</div>
          <h1>富士山マラソン</h1>
          <p className="sub">訓練課表與每次練習紀錄</p>
        </div>
        <div className="count">
          <span className="num">{days}</span>
          <span>{days >= 0 ? "天後開跑" : "天前完賽"}</span>
        </div>
      </div>
      <div className="bottom">
        <button type="button" className="apple-btn" onClick={() => void signIn()} disabled={busy}>
          <AppleIcon />
          {busy ? "登入中…" : useMock ? "進入（示範資料）" : "使用 Apple 登入"}
        </button>
        {error ? <p className="err" role="alert">{error}</p> : null}
        <p className="fine">只用來辨識你的帳號，不會收集電郵以外的資料。</p>
      </div>
    </div>
  );
}
