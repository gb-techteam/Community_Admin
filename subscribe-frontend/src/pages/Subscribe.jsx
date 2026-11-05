import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  Check,
  Copy,
  Gift,
  KeyRound,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { studentApi } from "../lib/api";
import logo from "../assets/g-black.png";

const USDT_BEP20 = "0x55d398326f99059fF775485246999027B3197955";

function usdtToWei(amount) {
  const [whole, frac = ""] = Number(amount).toFixed(6).split(".");
  return `${whole}${frac.padEnd(18, "0")}`.replace(/^0+(?=\d)/, "");
}

function paymentUri(wallet, amount, contract = USDT_BEP20) {
  const token = contract || USDT_BEP20;
  const wei = usdtToWei(amount);
  return `ethereum:${token}@56/transfer?address=${wallet}&uint256=${wei}`;
}

function PaymentQr({ wallet, amount, contract }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    if (!wallet || !amount) {
      setSrc("");
      return undefined;
    }
    let active = true;
    QRCode.toDataURL(paymentUri(wallet, amount, contract), {
      width: 280,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#1b2430", light: "#ffffff" },
    })
      .then((url) => {
        if (active) setSrc(url);
      })
      .catch(() => {
        if (active) setSrc("");
      });
    return () => {
      active = false;
    };
  }, [wallet, amount, contract]);

  if (!src) return null;

  return (
    <div className="sk-sub__qr">
      <img src={src} alt="USDT BEP20 payment QR code" width={200} height={200} />
      <span>Scan with Trust Wallet, MetaMask, or similar</span>
    </div>
  );
}

const TOKEN_KEY = "sk_student_token";

function durationLabel(value, unit = "month") {
  const n = Number(value) || 1;
  const u = String(unit || "month").toLowerCase();
  if (u === "day") return n === 1 ? "1 day" : `${n} days`;
  if (u === "week") return n === 1 ? "1 week" : `${n} weeks`;
  return n === 1 ? "1 month" : `${n} months`;
}

function moneyUsdt(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "Free";
  return `${n.toFixed(digits)} USDT`;
}

export default function Subscribe() {
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [student, setStudent] = useState(null);
  const [plans, setPlans] = useState([]);
  const [trialUsed, setTrialUsed] = useState(false);
  const [membership, setMembership] = useState(null);
  const [checkout, setCheckout] = useState(null);
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (!saved) return;
    (async () => {
      try {
        const data = await studentApi("/session", { token: saved });
        setToken(saved);
        setStudent(data.student);
        setTrialUsed(data.trialUsed);
        setMembership(data.membership);
        const planData = await studentApi("/plans", { token: saved });
        setPlans(planData.plans || []);
        setTrialUsed(planData.trialUsed);
        setStep("plans");
      } catch {
        sessionStorage.removeItem(TOKEN_KEY);
      }
    })();
  }, []);

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
      setStudent(data.student);
      const planData = await studentApi("/plans", { token: data.token });
      setPlans(planData.plans || []);
      setTrialUsed(planData.trialUsed);
      const session = await studentApi("/session", { token: data.token });
      setMembership(session.membership);
      setStep("plans");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function choosePlan(plan) {
    setBusy(true);
    setError("");
    try {
      const data = await studentApi("/start", {
        token,
        method: "POST",
        body: JSON.stringify({ planId: plan.id }),
      });
      if (data.kind === "trial") {
        setMembership(data.membership);
        setTrialUsed(true);
        setPlans((current) => current.filter((row) => !row.is_trial));
        setStep("done");
        return;
      }
      setCheckout(data);
      setStep("pay");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmPay(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await studentApi("/confirm", {
        token,
        method: "POST",
        body: JSON.stringify({
          paymentId: checkout?.payment?.id,
          txHash,
        }),
      });
      setMembership(data.membership);
      setStep("done");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyText(value, key) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(""), 1600);
    } catch {
      setError("Could not copy. Select the text instead.");
    }
  }

  return (
    <div className="sk-sub">
      <header className="sk-sub__brand">
        <img src={logo} alt="Goodbook" width={40} height={40} />
        <div>
          <p>SuperKandle</p>
          <strong>Student subscription</strong>
        </div>
      </header>

      <main className="sk-sub__card">
        {step === "email" || step === "code" ? (
          <>
            <p className="sk-crumb">Verify student access</p>
            <h1>Continue with your academy email</h1>
            <p className="sk-sub__lead">
              Only enrolled students can take a SuperKandle plan. Paid plans are
              USDT on BNB Smart Chain (BEP20) only.
            </p>
          </>
        ) : null}

        {step === "email" ? (
          <form className="sk-sub__form" onSubmit={requestCode}>
            <label htmlFor="subEmail">Student email</label>
            <input
              id="subEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@email.com"
              required
              autoComplete="email"
            />
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "Checking…" : "Continue"}
            </button>
          </form>
        ) : null}

        {step === "code" ? (
          <form className="sk-sub__form" onSubmit={verify}>
            <label htmlFor="subCode">6-digit code sent to {email}</label>
            <input
              id="subCode"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "Verifying…" : "Verify"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={requestCode}
            >
              Resend code
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setStep("email");
                setCode("");
                setError("");
              }}
            >
              Use a different email
            </button>
          </form>
        ) : null}

        {step === "plans" ? (
          <>
            <p className="sk-crumb">
              Hi {student?.firstName || "there"} · {student?.email}
            </p>
            <h1>Choose a plan</h1>
            <p className="sk-sub__lead">
              {trialUsed
                ? "Your free trial is already used. Pick a paid USDT plan."
                : "You can start with one free trial, or pay with USDT (BEP20)."}
            </p>
            {membership?.is_active && membership.expiry_state !== "expired" ? (
              <p className="sk-sub__note">
                Current access: {membership.plan_name || "Active"} until{" "}
                {String(membership.expires_at || "").slice(0, 10) || "—"}.
                Paying again renews from today.
              </p>
            ) : null}
            <div className="sk-sub__plans">
              {plans.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  className={`sk-sub__plan ${
                    plan.is_trial ? "is-trial" : ""
                  }`}
                  disabled={busy}
                  onClick={() => choosePlan(plan)}
                >
                  {plan.is_trial ? (
                    <span className="sk-sub__badge">
                      <Gift size={12} /> Free trial
                    </span>
                  ) : null}
                  <strong>{plan.name}</strong>
                  <em>{moneyUsdt(plan.price)}</em>
                  <span>
                    {durationLabel(plan.duration_value, plan.duration_unit)}
                  </span>
                </button>
              ))}
            </div>
            {!plans.length ? (
              <p className="sk-sub__note">No plans are available right now.</p>
            ) : null}
          </>
        ) : null}

        {step === "pay" && checkout ? (
          <>
            <p className="sk-crumb">USDT · BEP20</p>
            <h1>Send {moneyUsdt(checkout.payment.amount)}</h1>
            <p className="sk-sub__lead">
              Pay USDT on BNB Smart Chain (BEP20), then paste the transaction
              hash to confirm.
            </p>
            <div className="sk-sub__pay">
              <PaymentQr
                wallet={checkout.payment.wallet}
                amount={checkout.payment.amount}
                contract={checkout.payment.contract}
              />
              <div>
                <span>Network</span>
                <strong>{checkout.payment.networkName}</strong>
              </div>
              <div>
                <span>Token</span>
                <strong>USDT (BEP20)</strong>
              </div>
              <div>
                <span>Amount</span>
                <strong>{moneyUsdt(checkout.payment.amount)}</strong>
              </div>
              <div className="sk-sub__pay-span">
                <span>Wallet</span>
                <strong className="sk-sub__mono">{checkout.payment.wallet}</strong>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => copyText(checkout.payment.wallet, "wallet")}
                >
                  {copied === "wallet" ? <Check size={14} /> : <Copy size={14} />}
                  {copied === "wallet" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            <p className="sk-sub__warn">
              <Wallet size={14} /> Wrong network will lose funds. Do not send
              ERC20 or TRC20.
            </p>
            <form className="sk-sub__form" onSubmit={confirmPay}>
              <label htmlFor="txHash">Transaction hash</label>
              <input
                id="txHash"
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                placeholder="0x…"
                required
              />
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Checking chain…" : "I have paid"}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setStep("plans");
                  setCheckout(null);
                  setTxHash("");
                  setError("");
                }}
              >
                Back to plans
              </button>
            </form>
          </>
        ) : null}

        {step === "done" ? (
          <div className="sk-sub__done">
            <span className="sk-sub__done-icon" aria-hidden="true">
              <ShieldCheck size={28} />
            </span>
            <h1>Access is ready</h1>
            <p className="sk-sub__lead">
              {membership?.plan_name || "SuperKandle"} is active
              {membership?.expires_at
                ? ` until ${String(membership.expires_at).slice(0, 10)}`
                : ""}
              .
            </p>
          </div>
        ) : null}

        {error ? <p className="portal-alert">{error}</p> : null}
      </main>

      <p className="sk-sub__foot">
        <KeyRound size={12} /> Student-only checkout · USDT BEP20
      </p>
    </div>
  );
}
