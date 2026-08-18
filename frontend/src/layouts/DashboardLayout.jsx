import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  BookOpen,
  Layers,
  Megaphone,
  Shield,
  LogOut,
  CandlestickChart,
  Rocket,
  PanelTop,
  PanelLeft,
  Menu,
  X,
} from "lucide-react";
import logo from "../logo/g-black.png";
import {
  getAdmin,
  hasAnyPower,
  hasPower,
  isSuperAdmin,
  refreshAdmin,
} from "../lib/auth";
import { useFeedback } from "../lib/feedback";

const managementLinks = [
  {
    to: "/dashboard",
    label: "Overview",
    end: true,
    icon: LayoutDashboard,
    show: () => true,
  },
  {
    to: "/dashboard/admins",
    label: "Admins",
    icon: Shield,
    show: () => hasPower("create_admins"),
  },
  {
    to: "/dashboard/channels",
    label: "Channels",
    icon: Megaphone,
    show: () =>
      hasAnyPower([
        "manage_channels",
        "message_channels",
        "view_channel_people",
      ]),
  },
  {
    to: "/dashboard/students",
    label: "Students",
    icon: Users,
    show: () => hasAnyPower(["manage_students"]),
  },
  {
    to: "/dashboard/courses",
    label: "Courses",
    icon: BookOpen,
    show: () => hasAnyPower(["manage_courses"]),
  },
  {
    to: "/dashboard/batches",
    label: "Batches",
    icon: Layers,
    show: () => hasAnyPower(["manage_batches"]),
  },
];

const productLinks = [
  {
    to: "/dashboard/superkandle",
    label: "Superkandle",
    icon: CandlestickChart,
    show: () => hasPower("manage_superkandle"),
  },
  {
    to: "/dashboard/momentum",
    label: "Momentum",
    icon: Rocket,
    show: () => hasPower("manage_momentum"),
  },
];

const NAV_MODE_KEY = "portal_nav_mode";

function initials(value) {
  const parts = String(value || "A")
    .trim()
    .split(/\s+/)
    .slice(0, 2);
  return parts.map((part) => part[0]).join("").toUpperCase() || "A";
}

function NavGroup({ label, links, onNavigate }) {
  if (!links.length) return null;

  return (
    <div className="portal-nav-group">
      <p className="portal-nav-label">{label}</p>
      <nav className="portal-nav">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                isActive ? "portal-nav__link is-active" : "portal-nav__link"
              }
            >
              <Icon size={18} strokeWidth={2} aria-hidden="true" />
              <span>{link.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

function TopNavLinks({ links }) {
  return links.map((link) => {
    const Icon = link.icon;
    return (
      <NavLink
        key={link.to}
        to={link.to}
        end={link.end}
        className={({ isActive }) =>
          isActive ? "portal-tnav__link is-active" : "portal-tnav__link"
        }
      >
        <Icon size={16} strokeWidth={2} aria-hidden="true" />
        <span>{link.label}</span>
      </NavLink>
    );
  });
}

export default function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { confirm, notify } = useFeedback();
  const admin = getAdmin();
  const management = managementLinks.filter((link) => link.show());
  const products = productLinks.filter((link) => link.show());
  const isChannelChat = /^\/dashboard\/channels\/[^/]+$/.test(location.pathname);

  const [navMode, setNavMode] = useState(
    () => localStorage.getItem(NAV_MODE_KEY) || "side"
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [, setPowersVersion] = useState(0);

  useEffect(() => {
    localStorage.setItem(NAV_MODE_KEY, navMode);
  }, [navMode]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const sync = () => {
      setIsMobile(media.matches);
      if (!media.matches) setMenuOpen(false);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Keep channel chat inside the visible mobile viewport
  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 900px)");

    function clearViewportVars() {
      document.documentElement.style.removeProperty("--app-top");
      document.documentElement.style.removeProperty("--vv-top");
      document.documentElement.style.removeProperty("--vv-bottom");
      document.documentElement.style.removeProperty("--app-height");
      document.documentElement.style.removeProperty("--dock-bottom");
      document.documentElement.style.removeProperty("--composer-h");
      document.documentElement.classList.remove("is-channel-chat");
    }

    function syncViewport() {
      if (!isChannelChat || !mobile.matches) {
        clearViewportVars();
        return;
      }

      document.documentElement.classList.add("is-channel-chat");

      // Smallest visible height — keeps the chat (and fixed composer) on-screen
      const vv = window.visualViewport;
      const height = Math.round(
        Math.min(
          vv?.height || Number.POSITIVE_INFINITY,
          window.innerHeight || Number.POSITIVE_INFINITY,
          document.documentElement.clientHeight || Number.POSITIVE_INFINITY
        )
      );

      document.documentElement.style.setProperty("--app-top", "0px");
      document.documentElement.style.setProperty(
        "--app-height",
        `${height || window.innerHeight}px`
      );
    }

    if (!isChannelChat) {
      clearViewportVars();
      return undefined;
    }

    syncViewport();
    const raf = window.requestAnimationFrame(syncViewport);
    const timers = [50, 200, 500].map((ms) => window.setTimeout(syncViewport, ms));

    mobile.addEventListener("change", syncViewport);
    window.visualViewport?.addEventListener("resize", syncViewport);
    window.visualViewport?.addEventListener("scroll", syncViewport);
    window.addEventListener("resize", syncViewport);
    window.addEventListener("orientationchange", syncViewport);

    return () => {
      clearViewportVars();
      window.cancelAnimationFrame(raf);
      timers.forEach((id) => window.clearTimeout(id));
      mobile.removeEventListener("change", syncViewport);
      window.visualViewport?.removeEventListener("resize", syncViewport);
      window.visualViewport?.removeEventListener("scroll", syncViewport);
      window.removeEventListener("resize", syncViewport);
      window.removeEventListener("orientationchange", syncViewport);
    };
  }, [isChannelChat]);

  useEffect(() => {
    if (!menuOpen) return undefined;

    function onKey(event) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.body.classList.add("portal-menu-lock");
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("portal-menu-lock");
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    let alive = true;
    refreshAdmin()
      .then((changed) => {
        if (changed && alive) setPowersVersion((value) => value + 1);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const adminName = admin?.name || admin?.id || "Admin";
  const roleLabel = isSuperAdmin(admin) ? "Super admin" : "Portal admin";
  const isTopMode = navMode === "top";
  const sidebarHidden = isMobile ? !menuOpen : isTopMode;

  async function handleLogout() {
    const ok = await confirm({
      title: "Sign out of Community Admin?",
      message:
        "Your current session will end. You’ll need to sign in again to manage the portal.",
      confirmLabel: "Sign out",
      cancelLabel: "Stay signed in",
      tone: "info",
    });
    if (!ok) return;

    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_user");
    notify({
      title: "Signed out successfully",
      message: "Your session ended securely. Sign in again when you’re ready.",
    });
    navigate("/", { replace: true });
  }

  return (
    <div
      className={`portal portal--${navMode}${isChannelChat ? " portal--chat" : ""}${
        menuOpen ? " portal--menu-open" : ""
      }`}
    >
      <button
        type="button"
        className="portal-backdrop"
        aria-label="Close menu"
        tabIndex={menuOpen ? 0 : -1}
        onClick={() => setMenuOpen(false)}
      />

      <aside
        className="portal-sidebar"
        id="portal-mobile-nav"
        aria-hidden={sidebarHidden || undefined}
        inert={sidebarHidden ? true : undefined}
      >
        <div className="portal-sidebar__inner">
          <div className="portal-sidebar__brand">
            <div className="portal-brand">
              <img src={logo} alt="Goodbook" width={36} height={36} />
              <div className="portal-brand__text">
                <strong>Community Admin</strong>
                <span>{roleLabel}</span>
              </div>
            </div>
            <button
              type="button"
              className="portal-menu-close"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
            >
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="portal-navswitch"
              onClick={() => setNavMode("top")}
              title="Switch to top navigation"
              aria-label="Switch to top navigation"
            >
              <PanelTop size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>

          <div className="portal-sidebar__nav">
            <NavGroup
              label="Management"
              links={management}
              onNavigate={() => setMenuOpen(false)}
            />
            <NavGroup
              label="Products"
              links={products}
              onNavigate={() => setMenuOpen(false)}
            />
          </div>

          <div className="portal-sidebar__foot">
            <div className="portal-user">
              <span className="portal-user__role">{roleLabel}</span>
              <strong className="portal-user__id">{adminName}</strong>
            </div>
            <button
              type="button"
              className="portal-logout"
              onClick={handleLogout}
            >
              <LogOut size={16} strokeWidth={2} aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </aside>

      <div className="portal-shell">
        <header className="portal-mbar">
          <button
            type="button"
            className="portal-hamburger"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="portal-mobile-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? (
              <X size={20} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Menu size={20} strokeWidth={2} aria-hidden="true" />
            )}
          </button>

          <div className="portal-mbar__brand">
            <img src={logo} alt="" width={30} height={30} />
            <strong>Community Admin</strong>
          </div>

          <div className="portal-mbar__right">
            <span className="portal-account__avatar" aria-hidden="true">
              {initials(adminName)}
            </span>
            <button
              type="button"
              className="portal-signout-icon"
              onClick={handleLogout}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </header>

        <header
          className="portal-tnav"
          aria-hidden={!isTopMode}
          inert={!isTopMode ? true : undefined}
        >
          <div className="portal-tnav__brand">
            <img src={logo} alt="Goodbook" width={34} height={34} />
            <div className="portal-brand__text">
              <strong>Community Admin</strong>
            </div>
          </div>

          <nav className="portal-tnav__links" aria-label="Main navigation">
            <TopNavLinks links={management} />
            {products.length ? (
              <span className="portal-tnav__divider" aria-hidden="true" />
            ) : null}
            <TopNavLinks links={products} />
          </nav>

          <div className="portal-tnav__right">
            <button
              type="button"
              className="portal-navswitch"
              onClick={() => setNavMode("side")}
              title="Switch to side navigation"
              aria-label="Switch to side navigation"
            >
              <PanelLeft size={16} strokeWidth={2} aria-hidden="true" />
            </button>

            <div className="portal-account">
              <div className="portal-account__text">
                <strong>{adminName}</strong>
                <span>{roleLabel}</span>
              </div>
              <span className="portal-account__avatar" aria-hidden="true">
                {initials(adminName)}
              </span>
            </div>

            <button
              type="button"
              className="portal-signout-icon"
              onClick={handleLogout}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </header>

        <main className="portal-main">
          <div
            className={`portal-main__body${isChannelChat ? " portal-main__body--chat" : ""}`}
          >
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
