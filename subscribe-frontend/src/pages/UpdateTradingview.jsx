import { useState } from "react";
import { KeyRound } from "lucide-react";
import { studentApi } from "../lib/api";
import logo from "../assets/g-black.png";

const TOKEN_KEY = "sk_tv_update_token";

export default function UpdateTradingview() {
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [currentTv, setCurrentTv] = useState("");
  const [tvDraft, setTvDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function requestCode(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await studentApi("/request-otp", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setStep("code");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await studentApi("/verify", {
        method: "POST",
        body: JSON.stringify({ email, code }),
      });
      sessionStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      const tv = data.student?.tradingviewUsername || "";
      setCurrentTv(tv);
      setTvDraft(tv);
      setStep("update");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveTv(event) {
    event.preventDefault();
    const next = tvDraft.trim();
    if (!next) {
      setError("Enter your exact TradingView ID.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await studentApi("/profile", {
        token,
        method: "PATCH",
        body: JSON.stringify({ tradingviewUsername: next }),
      });
      const saved = data.student?.tradingviewUsername || next;
      setCurrentTv(saved);
      setTvDraft(saved);
      setDone(
        "TradingView ID saved. The academy can share the SuperKandle invite again."
      );
      setStep("done");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sk-sub">
      <header className="sk-sub__brand">
        <img src={logo} alt="Goodbook" width={40} height={40} />
        <div>
          <p>SuperKandle</p>
          <strong>Update TradingView ID</strong>
        </div>
      </header>

      <main className="sk-sub__card">
        {error ? <p className="portal-alert">{error}</p> : null}

        {step === "email" ? (
          <>
            <p className="sk-crumb">Email verification</p>
            <h1>Update your TradingView ID</h1>
            <p className="sk-sub__lead">
              Verify the academy email on your student profile, then save the
              exact TradingView username so the invite can be shared again.
            </p>
            <form className="sk-sub__form" onSubmit={requestCode}>
              <label htmlFor="tvEmail">Student email</label>
              <input
                id="tvEmail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@email.com"
                required
                autoComplete="email"
              />
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Sending code…" : "Send verification code"}
              </button>
            </form>
          </>
        ) : null}

        {step === "code" ? (
          <>
            <p className="sk-crumb">Email verification</p>
            <h1>Enter the code</h1>
            <p className="sk-sub__lead">
              We sent a 6-digit code to {email}. You must verify this email
              before the TradingView ID can be changed.
            </p>
            <form className="sk-sub__form" onSubmit={verify}>
              <label htmlFor="tvCode">6-digit code</label>
              <input
                id="tvCode"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                required
              />
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Checking…" : "Verify email"}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setError("");
                  setStep("email");
                }}
              >
                Use a different email
              </button>
            </form>
          </>
        ) : null}

        {step === "update" ? (
          <>
            <p className="sk-crumb">Verified · {email}</p>
            <h1>Save the correct TradingView ID</h1>
            <p className="sk-sub__lead">
              This must match the username you use to log in to TradingView.
              The SuperKandle invite is shared only to this ID.
            </p>
            <form className="sk-sub__form" onSubmit={saveTv}>
              <div className="sk-sub__tv-priority">
                <div className="sk-sub__tv-priority-head">
                  <KeyRound size={16} aria-hidden="true" />
                  <label htmlFor="tvId">TradingView ID</label>
                </div>
                {currentTv ? (
                  <p className="sk-sub__tv-priority-hint">
                    Current ID on file: {currentTv}
                  </p>
                ) : null}
                <input
                  id="tvId"
                  value={tvDraft}
                  onChange={(e) => setTvDraft(e.target.value)}
                  placeholder="Exact TradingView username"
                  autoComplete="off"
                  spellCheck="false"
                  required
                />
              </div>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Saving…" : "Save TradingView ID"}
              </button>
            </form>
          </>
        ) : null}

        {step === "done" ? (
          <>
            <p className="sk-crumb">Updated</p>
            <h1>TradingView ID saved</h1>
            <p className="sk-sub__lead">{done}</p>
            <p className="sk-sub__note sk-sub__note--tv">
              Invite will go to TradingView ID <strong>{currentTv}</strong>.
            </p>
            <a className="btn-primary" href="/">
              Back to SuperKandle
            </a>
          </>
        ) : null}
      </main>
    </div>
  );
}
