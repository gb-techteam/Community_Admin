import Subscribe from "./pages/Subscribe.jsx";
import UpdateTradingview from "./pages/UpdateTradingview.jsx";

export default function App() {
  const path = String(window.location.pathname || "").replace(/\/$/, "") || "/";
  if (path.endsWith("/update-tradingview")) {
    return <UpdateTradingview />;
  }
  return <Subscribe />;
}
