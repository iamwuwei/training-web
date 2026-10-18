import { useState } from "react";
import { redirect, useNavigate } from "react-router";
import type { Route } from "./+types/login";
import { AppleIcon, MountainIcon } from "../components/icons";
import { AuthError, hasSession, startLogin } from "../lib/auth";
import { config, useMock } from "../lib/config";
import { dayDiff, todayJst } from "../lib/date";

const RACE_DAY = "2026-12-13";

export function clientLoader() {
  if (hasSession()) throw redirect("/");
  return null;
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "登入 · 富士山マラソン 2026" }];
}

export default function Login() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = dayDiff(todayJst(), RACE_DAY);
  const apple = config.cognitoIdp === "SignInWithApple";

  async function signIn() {
    setError(null);
    if (useMock) { void navigate("/", { replace: true }); return; }
    setBusy(true);
    try {
      await startLogin(); // navigates away
    } catch (e) {
      setBusy(false);
      setError(e instanceof AuthError ? e.message : "登入失敗");
    }
  }

  return (
    <div className="login">
      <div className="mid">
        <MountainIcon width={72} height={72} strokeWidth={1.6} />
        <div>
          <div className="eyebrow">2026 · 12 / 13</div>
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
          {apple ? <AppleIcon /> : null}
          {busy ? "前往登入…" : useMock ? "進入（示範資料）" : apple ? "使用 Apple 登入" : "登入"}
        </button>
        {error ? <p className="err" role="alert">{error}</p> : null}
        <p className="fine">只用來辨識你的帳號，不會收集電郵以外的資料。</p>
      </div>
    </div>
  );
}
