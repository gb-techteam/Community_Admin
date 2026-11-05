import { useEffect, useState } from "react";
import { Mail, Save, Settings as SettingsIcon, Wallet } from "lucide-react";
import { api } from "../lib/api";
import { useFeedback } from "../lib/feedback";

const emptyForm = {
  usdtBep20Wallet: "",
  bscRpcUrl: "",
  publicAppUrl: "",
  smtpHost: "",
  smtpPort: "587",
  smtpUser: "",
  smtpFrom: "",
  smtpPass: "",
  expiryNoticeDays: 7,
};

export default function Settings() {
  const { notify } = useFeedback();
  const [form, setForm] = useState(emptyForm);
  const [smtpPassSet, setSmtpPassSet] = useState(false);
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await api("/api/settings");
        const settings = data.settings || {};
        setForm({
          usdtBep20Wallet: settings.usdtBep20Wallet || "",
          bscRpcUrl: settings.bscRpcUrl || "",
          publicAppUrl: settings.publicAppUrl || "",
          smtpHost: settings.smtpHost || "",
          smtpPort: settings.smtpPort || "587",
          smtpUser: settings.smtpUser || "",
          smtpFrom: settings.smtpFrom || "",
          smtpPass: "",
          expiryNoticeDays: settings.expiryNoticeDays || 7,
        });
        setSmtpPassSet(Boolean(settings.smtpPassSet));
        setSmtpConfigured(Boolean(settings.smtpConfigured));
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = { ...form };
      if (!payload.smtpPass) delete payload.smtpPass;
      const data = await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      const settings = data.settings || {};
      setSmtpPassSet(Boolean(settings.smtpPassSet));
      setSmtpConfigured(Boolean(settings.smtpConfigured));
      setForm((current) => ({ ...current, smtpPass: "" }));
      notify({
        title: "Settings saved",
        message: "BEP20 wallet and admin settings are now live.",
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="portal-page">
      <header className="portal-page__header">
        <div>
          <p className="page-kicker">
            <SettingsIcon size={14} strokeWidth={2} aria-hidden="true" />
            Admin
          </p>
          <h1>Settings</h1>
          <p>
            Configure SuperKandle USDT (BEP20) payments, student link, and
            email.
          </p>
        </div>
      </header>

      {error ? <p className="portal-alert">{error}</p> : null}

      <form className="entity-form settings-form" onSubmit={handleSubmit}>
        <section className="settings-block">
          <div className="settings-block__head">
            <Wallet size={18} strokeWidth={2} aria-hidden="true" />
            <div>
              <h2>USDT BEP20 payments</h2>
              <p>Students send USDT on BNB Smart Chain to this wallet.</p>
            </div>
          </div>
          <div className="form-grid">
            <div className="field field-span">
              <label htmlFor="usdtBep20Wallet">Receive wallet</label>
              <input
                id="usdtBep20Wallet"
                value={form.usdtBep20Wallet}
                onChange={(e) => update("usdtBep20Wallet", e.target.value)}
                placeholder="0x…"
                disabled={loading}
              />
            </div>
            <div className="field field-span">
              <label htmlFor="bscRpcUrl">BSC RPC URL</label>
              <input
                id="bscRpcUrl"
                value={form.bscRpcUrl}
                onChange={(e) => update("bscRpcUrl", e.target.value)}
                placeholder="https://bsc-dataseed.binance.org"
                disabled={loading}
              />
            </div>
          </div>
        </section>

        <section className="settings-block">
          <div className="settings-block__head">
            <SettingsIcon size={18} strokeWidth={2} aria-hidden="true" />
            <div>
              <h2>Student link</h2>
              <p>
                Student checkout site (separate Vite app). Used in emails and
                Copy student link.
              </p>
            </div>
          </div>
          <div className="form-grid">
            <div className="field field-span">
              <label htmlFor="publicAppUrl">Public app URL</label>
              <input
                id="publicAppUrl"
                value={form.publicAppUrl}
                onChange={(e) => update("publicAppUrl", e.target.value)}
                placeholder="https://subscribe.yourdomain.com"
                disabled={loading}
              />
            </div>
            <div className="field">
              <label htmlFor="expiryNoticeDays">Expiry reminder (days)</label>
              <input
                id="expiryNoticeDays"
                type="number"
                min="1"
                max="30"
                value={form.expiryNoticeDays}
                onChange={(e) => update("expiryNoticeDays", e.target.value)}
                disabled={loading}
              />
            </div>
          </div>
        </section>

        <section className="settings-block">
          <div className="settings-block__head">
            <Mail size={18} strokeWidth={2} aria-hidden="true" />
            <div>
              <h2>Email</h2>
              <p>
                OTP, membership confirmation, and expiry reminders.
                {smtpConfigured ? " SMTP is connected." : " SMTP is not set yet."}
              </p>
            </div>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="smtpHost">SMTP host</label>
              <input
                id="smtpHost"
                value={form.smtpHost}
                onChange={(e) => update("smtpHost", e.target.value)}
                placeholder="smtp.gmail.com"
                disabled={loading}
              />
            </div>
            <div className="field">
              <label htmlFor="smtpPort">Port</label>
              <input
                id="smtpPort"
                value={form.smtpPort}
                onChange={(e) => update("smtpPort", e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="field">
              <label htmlFor="smtpUser">SMTP user</label>
              <input
                id="smtpUser"
                value={form.smtpUser}
                onChange={(e) => update("smtpUser", e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="field">
              <label htmlFor="smtpFrom">From address</label>
              <input
                id="smtpFrom"
                value={form.smtpFrom}
                onChange={(e) => update("smtpFrom", e.target.value)}
                placeholder="noreply@yourdomain.com"
                disabled={loading}
              />
            </div>
            <div className="field field-span">
              <label htmlFor="smtpPass">
                SMTP password {smtpPassSet ? "(saved — leave blank to keep)" : ""}
              </label>
              <input
                id="smtpPass"
                type="password"
                value={form.smtpPass}
                onChange={(e) => update("smtpPass", e.target.value)}
                autoComplete="new-password"
                disabled={loading}
              />
            </div>
          </div>
        </section>

        <div className="entity-form__actions">
          <button type="submit" className="btn-primary" disabled={saving || loading}>
            <Save size={16} strokeWidth={2} aria-hidden="true" />
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>
    </div>
  );
}
