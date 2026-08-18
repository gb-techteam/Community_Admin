import { useState } from "react";
import { useNavigate } from "react-router-dom";
import logo from "../logo/g-black.png";
import { useFeedback } from "../lib/feedback";

export default function Login() {
  const navigate = useNavigate();
  const { notify } = useFeedback();
  const [adminId, setAdminId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminId, password, client: "portal" }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Login failed");
      }

      localStorage.setItem("admin_token", data.token);
      localStorage.setItem("admin_user", JSON.stringify(data.admin));
      notify({
        title: "Welcome back",
        message: `Signed in as ${data.admin?.name || data.admin?.id || adminId}.`,
      });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err.message || "Unable to sign in");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-atmosphere" aria-hidden="true" />

      <section className="login-brand">
        <div className="brand-mark">
          <img
            className="brand-mark__logo"
            src={logo}
            alt="Goodbook"
            width={52}
            height={52}
          />
          <span className="brand-mark__text">Community Admin</span>
        </div>

        <div className="brand-hero">
          <h1>Command the community.</h1>
          <p>
            A focused control room for portal admins — clear, calm, and built for
            decisive action.
          </p>
        </div>

        <div className="brand-footer">
          <div>
            <strong>01</strong>
            Secure access
          </div>
          <div>
            <strong>02</strong>
            Portal admins
          </div>
        </div>
      </section>

      <section className="login-panel">
        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-form__header">
            <h2>Sign in</h2>
            <p>Enter your portal admin credentials to continue.</p>
          </div>

          <div className="login-form__fields">
            <div className="field">
              <label htmlFor="adminId">Admin ID</label>
              <input
                id="adminId"
                name="adminId"
                type="text"
                autoComplete="username"
                placeholder="Enter admin ID"
                value={adminId}
                onChange={(e) => setAdminId(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error ? <p className="login-error">{error}</p> : null}

            <button className="login-submit" type="submit" disabled={loading}>
              {loading ? "Signing in…" : "Enter portal"}
            </button>
          </div>

          <p className="login-form__note">
            Access for portal admins only
          </p>
        </form>
      </section>
    </div>
  );
}
