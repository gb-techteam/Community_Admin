import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Info,
  X,
  XCircle,
} from "lucide-react";

const FeedbackContext = createContext(null);

let toastSeq = 0;

const TONE_ICON = {
  success: null,
  error: XCircle,
  info: Info,
  danger: AlertTriangle,
};

export function FeedbackProvider({ children }) {
  const [confirmState, setConfirmState] = useState(null);
  const [toasts, setToasts] = useState([]);
  const resolverRef = useRef(null);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    ({ title, message = "", tone = "success", duration = 4200 } = {}) => {
      const id = ++toastSeq;
      setToasts((prev) => [...prev, { id, title, message, tone }]);
      if (duration > 0) {
        window.setTimeout(() => dismissToast(id), duration);
      }
      return id;
    },
    [dismissToast]
  );

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setConfirmState({
        title: options.title || "Confirm action",
        message:
          options.message ||
          "Please confirm you want to continue with this action.",
        confirmLabel: options.confirmLabel || "Confirm",
        cancelLabel: options.cancelLabel || "Cancel",
        tone: options.tone || "danger",
      });
    });
  }, []);

  const closeConfirm = useCallback((result) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setConfirmState(null);
    resolve?.(result);
  }, []);

  const value = useMemo(
    () => ({
      confirm,
      notify,
      success: (opts) => notify({ tone: "success", ...opts }),
    }),
    [confirm, notify]
  );

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <ConfirmDialog state={confirmState} onClose={closeConfirm} />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) {
    throw new Error("useFeedback must be used within FeedbackProvider");
  }
  return ctx;
}

function ConfirmDialog({ state, onClose }) {
  useEffect(() => {
    if (!state) return undefined;

    function onKey(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose(false);
    }

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [state, onClose]);

  if (!state) return null;

  const Icon = TONE_ICON[state.tone] || AlertTriangle;
  const isDanger = state.tone === "danger";
  const isInfo = state.tone === "info";

  return createPortal(
    <div
      className="portal-confirm-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose(false);
      }}
    >
      <div
        className={`portal-confirm ${isDanger ? "is-danger" : ""} ${
          isInfo ? "is-info" : ""
        }`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="portal-confirm-title"
        aria-describedby="portal-confirm-desc"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="portal-confirm__icon" aria-hidden="true">
          <Icon size={22} strokeWidth={2} />
        </div>
        <div className="portal-confirm__copy">
          <h2 id="portal-confirm-title">{state.title}</h2>
          <p id="portal-confirm-desc">{state.message}</p>
        </div>
        <div className="portal-confirm__actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onClose(false)}
          >
            {state.cancelLabel}
          </button>
          <button
            type="button"
            className={isDanger ? "btn-danger" : "btn-primary"}
            autoFocus
            onClick={() => onClose(true)}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;

  const STATUS = {
    success: "OK",
    error: "ERR",
    info: "SYS",
    danger: "WARN",
  };

  return createPortal(
    <div
      className="portal-toast-stack"
      aria-live="polite"
      aria-relevant="additions"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`portal-toast portal-toast--${toast.tone}`}
          role="status"
        >
          <span className="portal-toast__code" aria-hidden="true">
            {STATUS[toast.tone] || STATUS.success}
          </span>
          <div className="portal-toast__copy">
            <strong>{toast.title}</strong>
            {toast.message ? <span>{toast.message}</span> : null}
          </div>
          <button
            type="button"
            className="portal-toast__close"
            aria-label="Dismiss"
            onClick={() => onDismiss(toast.id)}
          >
            <X size={13} strokeWidth={2.4} />
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}
