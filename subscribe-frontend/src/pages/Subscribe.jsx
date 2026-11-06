import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  Check,
  Clock3,
  Copy,
  Gift,
  KeyRound,
  Pencil,
  ShieldCheck,
  Sparkles,
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
const PENDING_KEY = "sk_pending_checkout";

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

function batchKindOf(name) {
  const text = String(name || "").toLowerCase();
  if (/\bgcc\b/.test(text)) return "gcc";
  if (/\bonline\b/.test(text)) return "online";
  if (/\boffline\b/.test(text)) return "offline";
  return "";
}

function batchesForKind(batches, kind) {
  return batches.filter((batch) => batchKindOf(batch.name) === kind);
}

const COUNTRY_CODES = [
  { code: "+91", country: "India" },
  { code: "+971", country: "United Arab Emirates" },
  { code: "+966", country: "Saudi Arabia" },
  { code: "+965", country: "Kuwait" },
  { code: "+974", country: "Qatar" },
  { code: "+973", country: "Bahrain" },
  { code: "+968", country: "Oman" },
  { code: "+92", country: "Pakistan" },
  { code: "+880", country: "Bangladesh" },
  { code: "+94", country: "Sri Lanka" },
  { code: "+977", country: "Nepal" },
  { code: "+1", country: "United States / Canada" },
  { code: "+44", country: "United Kingdom" },
  { code: "+61", country: "Australia" },
  { code: "+65", country: "Singapore" },
  { code: "+60", country: "Malaysia" },
  { code: "+62", country: "Indonesia" },
  { code: "+63", country: "Philippines" },
  { code: "+20", country: "Egypt" },
  { code: "+234", country: "Nigeria" },
  { code: "+254", country: "Kenya" },
  { code: "+27", country: "South Africa" },
  { code: "+90", country: "Turkey" },
  { code: "+49", country: "Germany" },
  { code: "+33", country: "France" },
  { code: "+39", country: "Italy" },
  { code: "+34", country: "Spain" },
  { code: "+31", country: "Netherlands" },
];

function formatPhone(countryCode, number) {
  const local = String(number || "")
    .replace(/[^\d]/g, "")
    .replace(/^0+/, "");
  return `${countryCode} ${local}`.trim();
}

function BatchSelect({
  id,
  kind,
  batchId,
  batches,
  onKindChange,
  onBatchChange,
}) {
  const options = kind ? batchesForKind(batches, kind) : [];

  return (
    <>
      <label htmlFor={`${id}Kind`}>Batch type</label>
      <select
        id={`${id}Kind`}
        value={kind}
        onChange={(e) => onKindChange(e.target.value)}
        required
      >
        <option value="">Select GCC, Online, or Offline</option>
        <option value="gcc">GCC</option>
        <option value="online">Online</option>
        <option value="offline">Offline</option>
      </select>
      {kind ? (
        <>
          <label htmlFor={id}>Batch</label>
          <select
            id={id}
            value={batchId}
            onChange={(e) => onBatchChange(e.target.value)}
            required
          >
            <option value="">Select your batch</option>
            {options.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.name}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </>
  );
}

export default function Subscribe() {
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [student, setStudent] = useState(null);
  const [plans, setPlans] = useState([]);
  const [trialUsed, setTrialUsed] = useState(false);
  const [displayPricedPlans, setDisplayPricedPlans] = useState(true);
  const [membership, setMembership] = useState(null);
  const [checkout, setCheckout] = useState(null);
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [showMissing, setShowMissing] = useState(false);
  const [requestForm, setRequestForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    address: "",
    dateOfBirth: "",
    telegramUser: "",
    tradingviewUsername: "",
    note: "",
    batchId: "",
    countryCode: "",
  });
  const [requestDone, setRequestDone] = useState("");
  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState("");
  const [batchKind, setBatchKind] = useState("");
  const [requestBatchKind, setRequestBatchKind] = useState("");
  const [tvDraft, setTvDraft] = useState("");
  const [tvConfirmed, setTvConfirmed] = useState(false);
  const [tvLocked, setTvLocked] = useState(true);
  const [batchLocked, setBatchLocked] = useState(true);
  const [pendingCheckout, setPendingCheckout] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
    } catch {
      return null;
    }
  });

  useEffect(() => {
    studentApi("/batches")
      .then((data) => setBatches(data.batches || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (!saved) return;
    (async () => {
      try {
        const data = await studentApi("/session", { token: saved });
        setToken(saved);
        await enterAuthenticated(saved, data.student, data);
      } catch {
        sessionStorage.removeItem(TOKEN_KEY);
      }
    })();
  }, []);

  async function enterAuthenticated(saved, nextStudent, extra = {}) {
    setStudent(nextStudent);
    setTvDraft(nextStudent?.tradingviewUsername || "");
    setTvConfirmed(false);
    prefillConfirm(nextStudent);
    if (nextStudent?.needsBatch) {
      const known = (nextStudent.batches || []).find(
        (row) => !/i\s*don'?t\s*know/i.test(row.name || "")
      );
      setBatchId(known?.id ? String(known.id) : "");
      setStep("batch");
      return;
    }
    const planData = await studentApi("/plans", { token: saved });
    setPlans(planData.plans || []);
    setTrialUsed(extra.trialUsed ?? planData.trialUsed);
    setDisplayPricedPlans(planData.displayPricedPlans !== false);
    if (extra.membership !== undefined) {
      setMembership(extra.membership);
    } else {
      const session = await studentApi("/session", { token: saved });
      setMembership(session.membership);
      setTrialUsed(session.trialUsed);
    }
    setStep("plans");
  }

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
      if (err.code === "EMAIL_NOT_FOUND") {
        setShowMissing(true);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function updateRequest(field, value) {
    setRequestForm((current) => ({ ...current, [field]: value }));
  }

  async function submitRequest(event) {
    event.preventDefault();
    if (!requestForm.countryCode) {
      setError("Select a country code before entering your phone number.");
      return;
    }
    const localPhone = String(requestForm.phone || "").replace(/[^\d]/g, "");
    if (!localPhone) {
      setError("Enter your phone number.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { countryCode, ...rest } = requestForm;
      const data = await studentApi("/access-request", {
        method: "POST",
        body: JSON.stringify({
          email,
          ...rest,
          phone: formatPhone(countryCode, requestForm.phone),
          batchId: Number(requestForm.batchId),
        }),
      });
      setRequestDone(data.message);
      setStep("request-done");
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
      await enterAuthenticated(data.token, data.student);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function prefillConfirm(nextStudent) {
    const known = (nextStudent?.batches || []).find(
      (row) => !/i\s*don'?t\s*know/i.test(row.name || "")
    );
    setTvDraft(nextStudent?.tradingviewUsername || "");
    if (known) {
      setBatchId(String(known.id));
      setBatchKind(batchKindOf(known.name));
    } else {
      setBatchId("");
      setBatchKind("");
    }
  }

  function goToConfirm(nextStudent = student) {
    prefillConfirm(nextStudent);
    setTvConfirmed(false);
    setTvLocked(Boolean(nextStudent?.tradingviewUsername));
    const known = (nextStudent?.batches || []).find(
      (row) => !/i\s*don'?t\s*know/i.test(row.name || "")
    );
    setBatchLocked(Boolean(known?.id));
    setStep("confirm");
  }

  async function saveBatch(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await studentApi("/profile", {
        token,
        method: "PATCH",
        body: JSON.stringify({ batchId: Number(batchId) }),
      });
      await enterAuthenticated(token, data.student);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDetails(event) {
    event.preventDefault();
    if (!batchId) {
      setError("Select your batch before continuing.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let pending = pendingCheckout;
      if (!pending) {
        try {
          pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
        } catch {
          pending = null;
        }
      }
      const data = await studentApi("/profile", {
        token,
        method: "PATCH",
        body: JSON.stringify({
          batchId: Number(batchId),
          tradingviewUsername: tvDraft,
          confirmBatch: true,
          ...(pending?.kind === "trial" && pending?.planId
            ? { planId: pending.planId }
            : {}),
          ...(pending?.kind === "usdt" && pending?.paymentId
            ? { paymentId: pending.paymentId }
            : {}),
        }),
      });
      setStudent(data.student);
      setTvDraft(data.student.tradingviewUsername || tvDraft);
      setTvConfirmed(true);
      if (data.membership) setMembership(data.membership);
      sessionStorage.removeItem(PENDING_KEY);
      setPendingCheckout(null);
      setStep("done");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function choosePlan(plan) {
    if (student?.needsBatch) {
      setError("Select your batch before continuing.");
      setStep("batch");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await studentApi("/start", {
        token,
        method: "POST",
        body: JSON.stringify({ planId: plan.id }),
      });
      if (data.kind === "trial") {
        const pending = { kind: "trial", planId: plan.id };
        setPendingCheckout(pending);
        sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
        goToConfirm(student);
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
      const pending = {
        kind: "usdt",
        paymentId: data.paymentId,
        planId: checkout?.plan?.id || data.planId,
      };
      setPendingCheckout(pending);
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      goToConfirm(student);
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

        {step === "batch" ? (
          <>
            <p className="sk-crumb">
              Hi {student?.firstName || "there"} · {student?.email}
            </p>
            <h1>Select your batch</h1>
            <p className="sk-sub__lead">
              Your profile is on “I don&apos;t know my batch name”. Choose your
              real batch before you can take a trial or pay.
            </p>
            <form className="sk-sub__form" onSubmit={saveBatch}>
              <BatchSelect
                id="studentBatch"
                kind={batchKind}
                batchId={batchId}
                batches={batches}
                onKindChange={(next) => {
                  setBatchKind(next);
                  setBatchId("");
                }}
                onBatchChange={setBatchId}
              />
              <button
                type="submit"
                className="btn-primary"
                disabled={busy || !batchId}
              >
                {busy ? "Saving…" : "Save batch and continue"}
              </button>
            </form>
          </>
        ) : null}

        {step === "plans" ? (
          <>
            <p className="sk-crumb">
              Hi {student?.firstName || "there"} · {student?.email}
            </p>
            <h1>
              {!plans.length
                ? "No offer right now"
                : !displayPricedPlans
                  ? "Start with a free trial"
                  : "Choose a plan"}
            </h1>
            <p className="sk-sub__lead">
              {!plans.length
                ? "You don't have any offer for taking SuperKandle."
                : !displayPricedPlans
                  ? "Take the free trial now. Paid SuperKandle plans will open shortly."
                  : trialUsed
                    ? "Your free trial is already used. Pick a paid USDT plan."
                    : "You can start with one free trial, or pay with USDT (BEP20)."}
            </p>
            {membership?.is_active && membership.expiry_state !== "expired" ? (
              <p className="sk-sub__note">
                Current access: {membership.plan_name || "Active"} until{" "}
                {String(membership.expires_at || "").slice(0, 10) || "—"}.
                {displayPricedPlans ? " Paying again renews from today." : ""}
              </p>
            ) : null}
            {plans.length ? (
              <div
                className={`sk-sub__plans ${
                  !displayPricedPlans ? "sk-sub__plans--offer" : ""
                }`}
              >
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
                    {plan.is_trial ? (
                      <b className="sk-sub__plan-cta">Start free trial</b>
                    ) : null}
                  </button>
                ))}
                {!displayPricedPlans ? (
                  <div className="sk-sub__plan sk-sub__plan--soon">
                    <span className="sk-sub__badge sk-sub__badge--soon">
                      <Clock3 size={12} /> Coming soon
                    </span>
                    <strong>Paid plans</strong>
                    <em>Soon</em>
                    <span>Other priced plans will be coming soon.</span>
                    <b className="sk-sub__plan-cta is-muted">
                      <Sparkles size={14} /> Stay tuned
                    </b>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="sk-sub__empty">
                <Sparkles size={22} strokeWidth={2} />
                <strong>No SuperKandle offer yet</strong>
                <span>
                  Check back later, or ask the academy when the next plan opens.
                </span>
              </div>
            )}
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

        {step === "confirm" ? (
          <>
            <p className="sk-crumb">
              Hi {student?.firstName || "there"} · {student?.email}
            </p>
            <h1>Confirm your details</h1>
            <p className="sk-sub__lead">
              The SuperKandle invite is shared to this TradingView ID. It must
              match the username you use to log in to TradingView.
            </p>
            <form className="sk-sub__form" onSubmit={confirmDetails}>
              <div className="sk-sub__tv-priority">
                <div className="sk-sub__tv-priority-head">
                  <KeyRound size={16} aria-hidden="true" />
                  <label htmlFor="confirmTv">TradingView ID</label>
                </div>
                <div className="sk-sub__tv-priority-row">
                  <input
                    id="confirmTv"
                    value={tvDraft}
                    onChange={(e) => setTvDraft(e.target.value)}
                    placeholder="Exact TradingView username"
                    autoComplete="off"
                    spellCheck="false"
                    readOnly={tvLocked}
                    required
                  />
                  <button
                    type="button"
                    className="sk-sub__tv-edit"
                    onClick={() => {
                      setTvLocked(false);
                      requestAnimationFrame(() => {
                        document.getElementById("confirmTv")?.focus();
                      });
                    }}
                    aria-label="Edit TradingView ID"
                    title="Edit TradingView ID"
                  >
                    <Pencil size={16} />
                  </button>
                </div>
                <p className="sk-sub__tv-priority-hint">
                  Double-check this ID. If it is wrong, the invite will go to
                  the wrong TradingView account and you will not see SuperKandle.
                </p>
              </div>
              {batchLocked && batchId ? (
                <div className="sk-sub__lock-field">
                  <label htmlFor="confirmBatchLocked">Batch</label>
                  <div className="sk-sub__tv-priority-row">
                    <div id="confirmBatchLocked" className="sk-sub__lock-value">
                      {[
                        { gcc: "GCC", online: "Online", offline: "Offline" }[
                          batchKind
                        ],
                        batches.find((row) => String(row.id) === String(batchId))
                          ?.name,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    <button
                      type="button"
                      className="sk-sub__tv-edit"
                      onClick={() => setBatchLocked(false)}
                      aria-label="Edit batch"
                      title="Edit batch"
                    >
                      <Pencil size={16} />
                    </button>
                  </div>
                </div>
              ) : (
                <BatchSelect
                  id="confirmBatch"
                  kind={batchKind}
                  batchId={batchId}
                  batches={batches}
                  onKindChange={(next) => {
                    setBatchKind(next);
                    setBatchId("");
                  }}
                  onBatchChange={setBatchId}
                />
              )}
              <button
                type="submit"
                className="btn-primary"
                disabled={busy || !batchId || !tvDraft.trim()}
              >
                {busy ? "Saving…" : "Confirm and continue"}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setError("");
                  setStep("plans");
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
              . The TradingView invitation will be shared within 1–2 hours.
            </p>
            <p className="sk-sub__note sk-sub__note--tv">
              Invite will go only to this TradingView ID:{" "}
              <strong>{student?.tradingviewUsername || tvDraft}</strong>. Confirm
              you can log in to TradingView with this exact username.
            </p>
          </div>
        ) : null}

        {step === "request" ? (
          <>
            <p className="sk-crumb">Access request</p>
            <h1>Tell us who you are</h1>
            <p className="sk-sub__lead">
              Every field is required, including your batch. The academy will
              review this and add you to the students list if approved.
            </p>
            <form className="sk-sub__form sk-sub__form--grid" onSubmit={submitRequest}>
              <label htmlFor="reqEmail">Email</label>
              <input id="reqEmail" type="email" value={email} readOnly required />
              <label htmlFor="reqFirst">First name</label>
              <input
                id="reqFirst"
                value={requestForm.firstName}
                onChange={(e) => updateRequest("firstName", e.target.value)}
                required
              />
              <label htmlFor="reqLast">Last name</label>
              <input
                id="reqLast"
                value={requestForm.lastName}
                onChange={(e) => updateRequest("lastName", e.target.value)}
                required
              />
              <label htmlFor="reqCountryCode">Phone</label>
              <div className="sk-sub__phone">
                <select
                  id="reqCountryCode"
                  value={requestForm.countryCode}
                  onChange={(e) => updateRequest("countryCode", e.target.value)}
                  required
                  aria-label="Country code"
                >
                  <option value="">Country code</option>
                  {COUNTRY_CODES.map((row) => (
                    <option key={`${row.country}-${row.code}`} value={row.code}>
                      {row.country} {row.code}
                    </option>
                  ))}
                </select>
                <input
                  id="reqPhone"
                  type="tel"
                  inputMode="numeric"
                  value={requestForm.phone}
                  onChange={(e) => updateRequest("phone", e.target.value)}
                  placeholder="Phone number"
                  disabled={!requestForm.countryCode}
                  required
                />
              </div>
              <label htmlFor="reqDob">Date of birth</label>
              <input
                id="reqDob"
                type="date"
                value={requestForm.dateOfBirth}
                onChange={(e) => updateRequest("dateOfBirth", e.target.value)}
                required
              />
              <label htmlFor="reqTelegram">Telegram ID</label>
              <input
                id="reqTelegram"
                value={requestForm.telegramUser}
                onChange={(e) => updateRequest("telegramUser", e.target.value)}
                required
              />
              <label htmlFor="reqTv">TradingView username</label>
              <input
                id="reqTv"
                value={requestForm.tradingviewUsername}
                onChange={(e) => updateRequest("tradingviewUsername", e.target.value)}
                required
              />
              <BatchSelect
                id="reqBatch"
                kind={requestBatchKind}
                batchId={requestForm.batchId}
                batches={batches}
                onKindChange={(next) => {
                  setRequestBatchKind(next);
                  updateRequest("batchId", "");
                }}
                onBatchChange={(value) => updateRequest("batchId", value)}
              />
              <label htmlFor="reqAddress">Address</label>
              <textarea
                id="reqAddress"
                rows={3}
                value={requestForm.address}
                onChange={(e) => updateRequest("address", e.target.value)}
                required
              />
              <label htmlFor="reqNote">Note</label>
              <textarea
                id="reqNote"
                rows={3}
                value={requestForm.note}
                onChange={(e) => updateRequest("note", e.target.value)}
                placeholder="Anything that helps identify you"
                required
              />
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Sending…" : "Submit request"}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setStep("email");
                  setError("");
                }}
              >
                Back to email
              </button>
            </form>
          </>
        ) : null}

        {step === "request-done" ? (
          <div className="sk-sub__done">
            <span className="sk-sub__done-icon" aria-hidden="true">
              <ShieldCheck size={28} />
            </span>
            <h1>Request sent</h1>
            <p className="sk-sub__lead">
              {requestDone ||
                "The academy will review your details. After approval, use this same email on this page."}
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setStep("email");
                setError("");
              }}
            >
              Back to login
            </button>
          </div>
        ) : null}

        {error ? <p className="portal-alert">{error}</p> : null}
      </main>

      {showMissing ? (
        <div className="sk-sub__modal" role="dialog" aria-modal="true">
          <div className="sk-sub__modal-card">
            <h2>Email not in the students list</h2>
            <p>
              Please confirm you entered the exact academy email. If this is
              the correct email, fill the request form so the academy can add
              you.
            </p>
            <div className="sk-sub__modal-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setShowMissing(false)}
              >
                Try another email
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setShowMissing(false);
                  setStep("request");
                  setError("");
                }}
              >
                Fill request form
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <p className="sk-sub__foot">
        <KeyRound size={12} /> Student-only checkout · USDT BEP20
      </p>
    </div>
  );
}
