import { useState, type FormEvent } from "react";
import { backend } from "../lib/api";

export function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "signin") {
        await backend.signIn(email, password);
      } else {
        const { needsConfirmation } = await backend.signUp(email, password);
        if (needsConfirmation) {
          setMessage({ tone: "info", text: "확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요." });
          setMode("signin");
        }
      }
    } catch (err) {
      setMessage({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <nav className="global-nav"><div className="global-nav__inner"><span className="global-nav__brand">영수증 가계부</span></div></nav>
      <header className="auth__hero">
        <h1 className="t-hero" style={{ margin: 0 }}>찍으면, 기록된다.</h1>
        <p className="t-body muted">영수증 사진 한 장으로 가게, 날짜, 품목, 금액이 가계부에 들어갑니다.</p>
      </header>
      <main className="auth__body">
        <form className="auth__card" onSubmit={submit}>
          <span className="t-tagline">{mode === "signin" ? "로그인" : "회원가입"}</span>
          <div className="field-group">
            <label className="field-label" htmlFor="email">이메일</label>
            <input id="email" type="email" className="field" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="pw">비밀번호</label>
            <input id="pw" type="password" className="field" minLength={6} autoComplete={mode === "signin" ? "current-password" : "new-password"} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {message && (
            <p className={message.tone === "error" ? "error-text" : "notice"} role="alert" style={{ margin: 0 }}>{message.text}</p>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "잠시만요…" : mode === "signin" ? "로그인" : "가입하기"}
          </button>
          <p className="t-caption muted" style={{ margin: 0, textAlign: "center" }}>
            {mode === "signin" ? "처음이신가요? " : "이미 계정이 있나요? "}
            <button type="button" className="link" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(null); }}>
              {mode === "signin" ? "회원가입" : "로그인"}
            </button>
          </p>
        </form>
      </main>
    </div>
  );
}
