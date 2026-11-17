import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  ClipboardList,
  Download,
  Eye,
  Pause,
  Play,
  Search,
  Upload,
  Users,
  X,
} from "lucide-react";
import { api, apiDownload } from "../lib/api";
import { useFeedback } from "../lib/feedback";
import { EntityCell } from "./TableCells";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10) || "—";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatWhen(value) {
  const dateLabel = formatDate(value);
  if (!value) return { date: dateLabel, rel: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: dateLabel, rel: "" };
  const mins = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  let rel = "";
  if (mins < 1) rel = "Just now";
  else if (mins < 60) rel = `${mins}m ago`;
  else if (mins < 1440) rel = `${Math.floor(mins / 60)}h ago`;
  else if (mins < 7 * 1440) rel = `${Math.floor(mins / 1440)}d ago`;
  return { date: dateLabel, rel };
}

function fullName(first, last) {
  return [first, last].filter(Boolean).join(" ").trim() || "—";
}

const CSV_PHONE_KEY = "sr_csv_phones";
const COUNTRY_CODES = [
  "971",
  "966",
  "974",
  "965",
  "968",
  "973",
  "91",
  "44",
  "61",
  "65",
  "1",
];

function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function phoneVariants(digits) {
  const values = new Set();
  const raw = phoneDigits(digits);
  if (raw.length < 8) return values;
  values.add(raw);
  if (raw.startsWith("00") && raw.length > 10) values.add(raw.slice(2));
  if (raw.startsWith("0") && raw.length > 8) values.add(raw.slice(1));
  COUNTRY_CODES.forEach((code) => {
    if (raw.startsWith(code) && raw.length - code.length >= 8) {
      values.add(raw.slice(code.length));
    }
  });
  if (raw.length >= 10) values.add(raw.slice(-10));
  if (raw.length >= 8) values.add(raw.slice(-8));
  return values;
}

function digitDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1;
    row[0] = i;
    let minInRow = row[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cur = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = cur;
      if (row[j] < minInRow) minInRow = row[j];
    }
    if (minInRow > max) return max + 1;
  }
  return row[b.length];
}

function comparePhones(requestDigits, csvDigits) {
  const a = phoneDigits(requestDigits);
  const b = phoneDigits(csvDigits);
  if (a.length < 8 || b.length < 8) return null;
  if (a === b) {
    return { level: "exact", rank: 4, csv: b, note: "Exact same digits" };
  }
  const av = phoneVariants(a);
  const bv = phoneVariants(b);
  for (const value of av) {
    if (value.length >= 10 && bv.has(value)) {
      return {
        level: "exact",
        rank: 3,
        csv: b,
        note: "Same number; country code may be missing on one side",
      };
    }
  }
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 8 && longer.endsWith(shorter)) {
    return {
      level: shorter.length >= 10 ? "exact" : "possible",
      rank: shorter.length >= 10 ? 3 : 2,
      csv: b,
      note:
        shorter.length >= 10
          ? "Same local number; country code may differ"
          : "Possible match — local digits overlap, country code may be missing",
    };
  }
  if (a.slice(-8) === b.slice(-8)) {
    return {
      level: "possible",
      rank: 2,
      csv: b,
      note: "Possible match — last 8 digits are the same",
    };
  }
  let bestDist = 99;
  av.forEach((left) => {
    if (left.length < 8) return;
    bv.forEach((right) => {
      if (right.length < 8) return;
      const dist = digitDistance(left, right, 2);
      if (dist < bestDist) bestDist = dist;
    });
  });
  if (bestDist <= 2) {
    return {
      level: "possible",
      rank: bestDist <= 1 ? 2 : 1,
      csv: b,
      note:
        bestDist === 1
          ? "Possible match — one extra, missing, or different digit (country code / typing)"
          : "Possible match — numbers are very close, country code or a digit may differ",
    };
  }
  if (a.slice(-6) === b.slice(-6)) {
    return {
      level: "possible",
      rank: 1,
      csv: b,
      note: "Possible match — last 6 digits are the same",
    };
  }
  return null;
}

function buildContactIndex(contacts) {
  const byPhone = new Map();
  function add(key, contact) {
    if (!key || key.length < 6) return;
    if (!byPhone.has(key)) byPhone.set(key, []);
    byPhone.get(key).push(contact);
  }
  (contacts || []).forEach((contact) => {
    (contact.phones || []).forEach((digits) => {
      const raw = phoneDigits(digits);
      if (raw.length < 8) return;
      phoneVariants(raw).forEach((value) => {
        add(value.slice(-8), contact);
        add(value.slice(-6), contact);
      });
    });
  });
  return byPhone;
}

function matchCsvPhone(requestPhone, contacts, index) {
  if (!index?.size) return null;
  const raw = phoneDigits(requestPhone);
  if (raw.length < 8) return null;
  const pool = new Set();
  phoneVariants(raw).forEach((value) => {
    (index.get(value.slice(-8)) || []).forEach((item) => pool.add(item));
    (index.get(value.slice(-6)) || []).forEach((item) => pool.add(item));
  });
  let best = null;
  pool.forEach((contact) => {
    (contact.phones || []).forEach((csv) => {
      const hit = comparePhones(raw, csv);
      if (!hit) return;
      const next = {
        ...hit,
        csvName: contact.name || "",
        csvPhones: contact.phones,
        contact,
      };
      if (!best || next.rank > best.rank) best = next;
    });
  });
  return best;
}

function matchCsvName(requestName, contacts) {
  const list = contacts || [];
  if (!list.length) return null;
  let best = null;
  const pool =
    list.length <= 4000
      ? list
      : list.filter((contact) => {
          const last = nameTokens(contact.name).pop();
          return nameTokens(requestName).includes(last);
        });
  pool.forEach((contact) => {
    if (!contact.name) return;
    const hit = compareNames(requestName, contact.name);
    if (!hit) return;
    const next = {
      ...hit,
      csvName: contact.name,
      csvPhones: contact.phones || [],
      contact,
    };
    if (!best || next.rank > best.rank) best = next;
  });
  return best;
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(value) {
  return normalizeName(value).split(" ").filter((part) => part.length > 1);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = cur;
    }
  }
  return row[b.length];
}

function compareNames(requestName, csvName) {
  const a = normalizeName(requestName);
  const b = normalizeName(csvName);
  if (!a || !b) return null;
  if (a === b) {
    return { level: "exact", rank: 4, csv: csvName, note: "Exact same name" };
  }
  const at = nameTokens(a);
  const bt = nameTokens(b);
  if (!at.length || !bt.length) return null;
  const bSet = new Set(bt);
  const overlap = at.filter((part) => bSet.has(part));
  if (at.length === bt.length && overlap.length === at.length) {
    return {
      level: "exact",
      rank: 3,
      csv: csvName,
      note: "Same name, different word order",
    };
  }
  const aFirst = at[0];
  const aLast = at[at.length - 1];
  const bFirst = bt[0];
  const bLast = bt[bt.length - 1];
  if (
    aFirst === bFirst &&
    aLast === bLast &&
    aFirst.length >= 2 &&
    aLast.length >= 3
  ) {
    return {
      level: "exact",
      rank: 3,
      csv: csvName,
      note: "Same first and last name",
    };
  }
  if (aLast === bLast && aLast.length >= 4) {
    if (
      aFirst.startsWith(bFirst.slice(0, 3)) ||
      bFirst.startsWith(aFirst.slice(0, 3))
    ) {
      return {
        level: "possible",
        rank: 2,
        csv: csvName,
        note: "Same last name, similar first name",
      };
    }
    if (aFirst[0] === bFirst[0]) {
      return {
        level: "possible",
        rank: 1,
        csv: csvName,
        note: "Same last name, first initial matches",
      };
    }
  }
  if (a.length >= 8 && b.length >= 8 && (a.includes(b) || b.includes(a))) {
    return {
      level: "possible",
      rank: 2,
      csv: csvName,
      note: "One name contains the other",
    };
  }
  const dist = levenshtein(a, b);
  if (Math.max(a.length, b.length) >= 8 && dist <= 2) {
    return {
      level: "possible",
      rank: 2,
      csv: csvName,
      note: "Name is very close (possible spelling difference)",
    };
  }
  return null;
}

function csvDelimiter(text) {
  const line = String(text || "").split(/\r?\n/).find((row) => row.trim()) || "";
  const counts = [
    [",", (line.match(/,/g) || []).length],
    [";", (line.match(/;/g) || []).length],
    ["\t", (line.match(/\t/g) || []).length],
  ].sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const src = String(text || "").replace(/^\uFEFF/, "");
  const delimiter = csvDelimiter(src);
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => String(value).trim()));
}

function colIndex(headers, pattern) {
  return headers.findIndex((header) => pattern.test(header));
}

function isPhoneHeader(header) {
  return /phone|mobile|whatsapp|whats\s*app|\btel\b|cell|\bno\b|number/.test(
    header
  );
}

function isEmailHeader(header) {
  return /e-?mail/.test(header);
}

function isNameHeader(header) {
  if (isPhoneHeader(header) || isEmailHeader(header)) return false;
  return /name|naam|contact|student|person|file\s*as|nickname|given|surname|family|fullname/.test(
    header
  );
}

function looksLikePersonName(value) {
  const text = String(value || "").trim();
  if (text.length < 2 || text.length > 120) return false;
  if (text.includes("@")) return false;
  if (phoneDigits(text).length >= 8) return false;
  if (/https?:\/\//i.test(text)) return false;
  if (
    /^(mobile|home|work|other|phone|main|mycontacts|\* ?mycontacts|\*|starred)$/i.test(
      text
    )
  ) {
    return false;
  }
  return (text.match(/[\p{L}]/gu) || []).length >= 2;
}

function nameFromCsvRow(row, headers, firstCol, middleCol, lastCol, nameCols) {
  const assembled = [firstCol, middleCol, lastCol]
    .filter((index) => index >= 0)
    .map((index) => String(row[index] || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (assembled) return assembled;
  for (let i = 0; i < nameCols.length; i += 1) {
    const value = String(row[nameCols[i]] || "").trim();
    if (looksLikePersonName(value)) return value;
  }
  for (let i = 0; i < row.length; i += 1) {
    const header = headers[i] || "";
    if (isPhoneHeader(header) || isEmailHeader(header)) continue;
    const value = String(row[i] || "").trim();
    if (looksLikePersonName(value)) return value;
  }
  return "";
}

function contactsFromCsv(text) {
  const rows = parseCsv(text);
  const contacts = [];
  if (!rows.length) return { contacts };
  const headers = rows[0].map((value) =>
    String(value || "").toLowerCase().trim()
  );
  const hasHeader = headers.some(
    (header) => isPhoneHeader(header) || isNameHeader(header) || isEmailHeader(header)
  );
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const nameCols = hasHeader
    ? headers
        .map((header, index) => (isNameHeader(header) ? index : -1))
        .filter((index) => index >= 0)
    : [];
  const firstCol = hasHeader
    ? colIndex(headers, /first.*name|given.*name|firstname/)
    : -1;
  const middleCol = hasHeader ? colIndex(headers, /middle.*name/) : -1;
  const lastCol = hasHeader
    ? colIndex(headers, /last.*name|surname|family.*name|lastname/)
    : -1;
  dataRows.forEach((row) => {
    const name = nameFromCsvRow(
      row,
      hasHeader ? headers : [],
      firstCol,
      middleCol,
      lastCol,
      nameCols
    );
    const phones = [];
    row.forEach((cell) => {
      const digits = phoneDigits(cell);
      if (digits.length >= 8 && digits.length <= 15 && !phones.includes(digits)) {
        phones.push(digits);
      }
    });
    if (!name && !phones.length) return;
    contacts.push({ name, phones });
  });
  return { contacts };
}

function contactsToSets(contacts) {
  const phones = new Set();
  const names = [];
  (contacts || []).forEach((contact) => {
    if (contact.name) names.push(contact.name);
    (contact.phones || []).forEach((phone) => phones.add(phone));
  });
  return { phones, names };
}

function loadStoredCsv() {
  try {
    const raw = sessionStorage.getItem(CSV_PHONE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (Array.isArray(data?.contacts)) {
      return { contacts: data.contacts };
    }
    const contacts = [];
    if (data?.phoneNames && typeof data.phoneNames === "object") {
      Object.entries(data.phoneNames).forEach(([phone, name]) => {
        contacts.push({ name: name || "", phones: phone ? [phone] : [] });
      });
    }
    return { contacts };
  } catch {
    return { contacts: [] };
  }
}

const REJECT_OPTIONS = [
  {
    id: "cannot_identify",
    label:
      "Academy cannot identify you as a student. Recheck the phone number, email, and batch.",
  },
  {
    id: "not_student",
    label: "You are not a student of the academy.",
  },
  {
    id: "duplicate",
    label: "We identified a duplicate request with the same details.",
  },
  {
    id: "custom",
    label: "Custom reason",
  },
];

function MatchFact({ label, value, hit }) {
  return (
    <div className={hit ? "is-hit" : undefined}>
      <dt>{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}

function MatchList({ title, items, kind }) {
  if (!items.length) return null;
  return (
    <div className="sr-compare__group">
      <p className="sr-compare__label">{title}</p>
      {items.map((row) => {
        const hits = new Set(row.matched || []);
        const batch = row.batch_names || row.batch_name;
        return (
          <div key={`${kind}-${row.id}`} className="sr-compare__card">
            <strong>{fullName(row.first_name, row.last_name)}</strong>
            <dl className="sr-compare__facts">
              <MatchFact label="Email" value={row.email} hit={hits.has("email")} />
              <MatchFact label="Phone" value={row.phone} hit={hits.has("phone")} />
              <MatchFact label="Batch" value={batch} />
              <MatchFact
                label="Telegram"
                value={row.telegram_user}
                hit={hits.has("telegram")}
              />
              <MatchFact
                label="TradingView"
                value={row.tradingview_username}
                hit={hits.has("tradingview")}
              />
              <MatchFact
                label="Date of birth"
                value={row.date_of_birth ? formatDate(row.date_of_birth) : ""}
                hit={hits.has("date of birth")}
              />
              {kind === "request" ? (
                <MatchFact
                  label="Status"
                  value={row.status === "on_hold" ? "On hold" : row.status}
                />
              ) : null}
              {row.address ? (
                <MatchFact label="Address" value={row.address} />
              ) : null}
            </dl>
            <div className="sr-compare__hits">
              {row.matched.map((field) => (
                <span key={field}>{field}</span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const STATUS_TABS = [
  { id: "pending", label: "Pending" },
  { id: "on_hold", label: "On hold" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "all", label: "All" },
];

function statusLabel(value) {
  if (value === "on_hold") return "On hold";
  return String(value || "").replace(/_/g, " ");
}

function canReview(value) {
  return value === "pending" || value === "on_hold";
}

export default function SuperkandleRequestsTab({ onStats }) {
  const { confirm, notify } = useFeedback();
  const [status, setStatus] = useState("pending");
  const [search, setSearch] = useState("");
  const [requests, setRequests] = useState([]);
  const [stats, setStats] = useState({
    pending: 0,
    on_hold: 0,
    approved: 0,
    rejected: 0,
  });
  const [selected, setSelected] = useState(null);
  const [approving, setApproving] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState("cannot_identify");
  const [customReason, setCustomReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [matches, setMatches] = useState({ students: [], requests: [] });
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [csvContacts, setCsvContacts] = useState(
    () => loadStoredCsv().contacts
  );
  const [csvOnly, setCsvOnly] = useState(false);
  const csvInputRef = useRef(null);

  async function load(nextStatus = status, query = search) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ status: nextStatus });
      if (query.trim()) params.set("search", query.trim());
      const data = await api(`/api/student-requests?${params.toString()}`);
      setRequests(data.requests || []);
      setStats(data.stats || stats);
      onStats?.(data.stats || { pending: 0 });
      setSelected((current) => {
        if (!current) return current;
        return (
          (data.requests || []).find((row) => row.id === current.id) || current
        );
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const delay = search.trim() ? 280 : 0;
    const timer = setTimeout(() => load(status, search), delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, search]);

  const compareId = selected?.id || approving?.id;
  useEffect(() => {
    if (!compareId) {
      setMatches({ students: [], requests: [] });
      return undefined;
    }
    let cancelled = false;
    setMatchesLoading(true);
    api(`/api/student-requests/${compareId}/matches`)
      .then((data) => {
        if (!cancelled) {
          setMatches({
            students: data.students || [],
            requests: data.requests || [],
          });
        }
      })
      .catch(() => {
        if (!cancelled) setMatches({ students: [], requests: [] });
      })
      .finally(() => {
        if (!cancelled) setMatchesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [compareId]);

  const csvIndex = useMemo(
    () => buildContactIndex(csvContacts),
    [csvContacts]
  );
  const csvLoaded = csvContacts.length > 0;

  function csvMatch(row) {
    const phone = matchCsvPhone(row?.phone, csvContacts, csvIndex);
    const name = matchCsvName(
      fullName(row?.first_name, row?.last_name),
      csvContacts
    );
    if (!phone && !name) return null;
    const primary = phone && (!name || phone.rank >= name.rank) ? phone : name;
    return {
      ...primary,
      kind: phone && (!name || phone.rank >= name.rank) ? "phone" : "name",
      nameHit: name,
      phoneHit: phone,
      csvName: (phone || name).csvName || name?.csv || "",
      csvPhones: (phone || name).csvPhones || [],
    };
  }

  async function handleCsvFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = contactsFromCsv(text);
      if (!parsed.contacts.length) {
        setError("No phone numbers or names found in that CSV.");
        return;
      }
      sessionStorage.setItem(
        CSV_PHONE_KEY,
        JSON.stringify({ contacts: parsed.contacts })
      );
      setCsvContacts(parsed.contacts);
      const sets = contactsToSets(parsed.contacts);
      const index = buildContactIndex(parsed.contacts);
      const hit = requests.filter(
        (row) =>
          matchCsvPhone(row.phone, parsed.contacts, index) ||
          matchCsvName(fullName(row.first_name, row.last_name), parsed.contacts)
      ).length;
      const named = parsed.contacts.filter(
        (contact) => contact.name && contact.phones.length
      ).length;
      notify({
        title: "CSV loaded",
        message: `${sets.phones.size} phones, ${sets.names.length} names, ${named} contacts with both. ${hit} request${hit === 1 ? "" : "s"} in this list match.`,
      });
    } catch (err) {
      setError(err.message || "Could not read that CSV.");
    }
  }

  function clearCsv() {
    sessionStorage.removeItem(CSV_PHONE_KEY);
    setCsvContacts([]);
    setCsvOnly(false);
  }

  async function exportPending() {
    const count = Number(stats.pending) || 0;
    const ok = await confirm({
      title: "Export pending requests?",
      message: `Download an Excel file of ${count} pending student request${count === 1 ? "" : "s"}.`,
      confirmLabel: "Export",
      tone: "info",
    });
    if (!ok) return;
    setError("");
    setExporting(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      await apiDownload(
        "/api/student-requests/export",
        `pending-student-requests-${stamp}.xls`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  function approve(row) {
    setApproving(row);
  }

  async function confirmApprove() {
    const row = approving;
    if (!row) return;
    setError("");
    try {
      await api(`/api/student-requests/${row.id}/approve`, {
        method: "PATCH",
        body: JSON.stringify({}),
      });
      notify({
        title: "Request approved",
        message:
          "They were emailed. They can access Wealth Club products and take SuperKandle plans.",
      });
      setApproving(null);
      setSelected(null);
      await load(status, search);
    } catch (err) {
      setError(err.message);
    }
  }

  function reject(row) {
    setRejectReason("cannot_identify");
    setCustomReason("");
    setRejecting(row);
  }

  async function confirmReject() {
    const row = rejecting;
    if (!row || !rejectReason) return;
    if (rejectReason === "custom" && !customReason.trim()) {
      setError("Enter a custom rejection reason.");
      return;
    }
    setError("");
    try {
      await api(`/api/student-requests/${row.id}/reject`, {
        method: "PATCH",
        body: JSON.stringify({
          reason: rejectReason,
          customReason: customReason.trim(),
        }),
      });
      notify({
        title: "Request rejected",
        message: "They were emailed the rejection reason.",
      });
      setRejecting(null);
      setSelected(null);
      await load(status, search);
    } catch (err) {
      setError(err.message);
    }
  }

  async function putOnHold(row) {
    const ok = await confirm({
      title: "Put this request on hold?",
      message:
        "It leaves Pending until you resume, approve, or reject it. The student is not emailed.",
      confirmLabel: "On hold",
      tone: "info",
    });
    if (!ok) return;
    setError("");
    try {
      await api(`/api/student-requests/${row.id}/hold`, {
        method: "PATCH",
        body: JSON.stringify({}),
      });
      notify({
        title: "Request on hold",
        message: "It is parked until you come back to it.",
      });
      setSelected(null);
      await load(status, search);
    } catch (err) {
      setError(err.message);
    }
  }

  async function resume(row) {
    const approved = row.status === "approved";
    const ok = await confirm({
      title: "Move back to pending?",
      message: approved
        ? "This undoes the approval on the request only. The student list is not changed, and the approval email may already have been sent."
        : "This request will show in Pending again.",
      confirmLabel: "Move to pending",
      tone: approved ? "danger" : "info",
    });
    if (!ok) return;
    setError("");
    try {
      await api(`/api/student-requests/${row.id}/resume`, {
        method: "PATCH",
        body: JSON.stringify({}),
      });
      notify({
        title: "Back in pending",
        message: "You can approve or reject it from Pending.",
      });
      setSelected(null);
      await load(status, search);
    } catch (err) {
      setError(err.message);
    }
  }

  const total =
    (stats.pending || 0) +
    (stats.on_hold || 0) +
    (stats.approved || 0) +
    (stats.rejected || 0);
  const tabCount = {
    pending: stats.pending || 0,
    on_hold: stats.on_hold || 0,
    approved: stats.approved || 0,
    rejected: stats.rejected || 0,
    all: total,
  };
  const csvHitCount = useMemo(
    () =>
      requests.filter(
        (row) =>
          matchCsvPhone(row.phone, csvContacts, csvIndex) ||
          matchCsvName(fullName(row.first_name, row.last_name), csvContacts)
      ).length,
    [requests, csvContacts, csvIndex]
  );
  const visibleRequests = csvOnly
    ? requests.filter(
        (row) =>
          matchCsvPhone(row.phone, csvContacts, csvIndex) ||
          matchCsvName(fullName(row.first_name, row.last_name), csvContacts)
      )
    : requests;
  const selectedCsv = selected ? csvMatch(selected) : null;
  const csvPhoneHit = selectedCsv?.phoneHit || null;
  const csvNameHit = selectedCsv?.nameHit || null;
  const csvPhoneCard = csvPhoneHit || csvNameHit;
  const csvNameCard = csvNameHit || csvPhoneHit;
  const csvPhoneValue = (csvPhoneCard?.csvPhones || [])
    .filter(Boolean)
    .join(", ") || csvPhoneCard?.csv || "";
  const csvNameValue = csvNameCard?.csvName || csvNameCard?.csv || "";

  return (
    <section className="sr-board">
      <div className="sr-board__main">
        <div className="sr-toolbar">
          <div className="sr-search">
            <Search size={16} strokeWidth={2} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search name, email, phone, TradingView, or batch"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={handleCsvFile}
          />
          <button
            type="button"
            className="sr-export"
            onClick={() => csvInputRef.current?.click()}
          >
            <Upload size={15} strokeWidth={2} />
            {csvLoaded
              ? `CSV loaded (${csvContacts.length} contacts)`
              : "Upload phone CSV"}
          </button>
          {csvLoaded ? (
            <button type="button" className="sr-export sr-export--ghost" onClick={clearCsv}>
              Clear CSV
            </button>
          ) : null}
          <button
            type="button"
            className="sr-export"
            onClick={exportPending}
            disabled={exporting || !tabCount.pending}
          >
            <Download size={15} strokeWidth={2} />
            {exporting ? "Exporting…" : "Export pending"}
          </button>
          <div className="sr-tabs" role="tablist" aria-label="Request status">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={status === tab.id}
                className={`sr-tab ${status === tab.id ? "is-active" : ""} ${
                  tab.id === "pending" && tabCount.pending ? "has-alert" : ""
                }`}
                onClick={() => setStatus(tab.id)}
              >
                {tab.label}
                <span>{tabCount[tab.id]}</span>
              </button>
            ))}
            {csvLoaded ? (
              <button
                type="button"
                className={`sr-tab ${csvOnly ? "is-active" : ""} ${
                  csvHitCount ? "has-alert" : ""
                }`}
                onClick={() => setCsvOnly((value) => !value)}
              >
                CSV match
                <span>{csvHitCount}</span>
              </button>
            ) : null}
          </div>
        </div>

        {error && !rejecting && !approving ? (
          <p className="portal-alert">{error}</p>
        ) : null}

        <div className="table-wrap sr-table-wrap">
          <table className="data-table sr-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Contact</th>
                <th>TradingView</th>
                <th>Batch</th>
                <th>Submitted</th>
                <th>Status</th>
                <th className="is-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="table-empty">
                    Loading requests…
                  </td>
                </tr>
              ) : visibleRequests.length === 0 ? (
                <tr>
                  <td colSpan={7} className="table-empty">
                    <div className="table-empty__box">
                      <ClipboardList size={22} strokeWidth={1.8} />
                      <strong>
                        {csvOnly
                          ? "No CSV phone matches"
                          : search.trim()
                            ? "No matching requests"
                            : `No ${status === "all" ? "" : statusLabel(status)} requests`}
                      </strong>
                      <span>
                        {csvOnly
                          ? "None of the requests in this list use a phone from the uploaded CSV."
                          : search.trim()
                            ? "Try another name, email, or phone."
                            : "New subscribe requests will show up here."}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                visibleRequests.map((row) => {
                  const when = formatWhen(row.created_at);
                  const name = fullName(row.first_name, row.last_name);
                  const csvHit = csvMatch(row);
                  return (
                    <tr
                      key={row.id}
                      className={`sr-row ${
                        selected?.id === row.id ? "is-selected" : ""
                      }`}
                      onClick={() => setSelected(row)}
                    >
                      <td>
                        <EntityCell title={name} subtitle={row.email} />
                      </td>
                      <td>
                        <div className="sr-stack">
                          <strong>{row.phone || "—"}</strong>
                          {row.telegram_user ? (
                            <span>{row.telegram_user}</span>
                          ) : null}
                          {csvHit ? (
                            <span
                              className={`sr-csv-hit ${
                                csvHit.level === "possible" ? "is-possible" : ""
                              }`}
                            >
                              {csvHit.kind === "name"
                                ? csvHit.level === "possible"
                                  ? "Possible CSV name"
                                  : "CSV name match"
                                : csvHit.level === "possible"
                                  ? "Possible CSV phone"
                                  : "CSV phone match"}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <span className="sr-mono">
                          {row.tradingview_username || "—"}
                        </span>
                      </td>
                      <td>
                        {row.batch_name ? (
                          <span className="tag">{row.batch_name}</span>
                        ) : (
                          <span className="cell-muted">No batch</span>
                        )}
                      </td>
                      <td>
                        <div className="sr-stack">
                          <strong>{when.date}</strong>
                          {when.rel ? <span>{when.rel}</span> : null}
                        </div>
                      </td>
                      <td>
                        <span className={`sk-pill sk-pill--${row.status}`}>
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td className="is-actions">
                        <div className="row-actions sr-actions">
                          <button
                            type="button"
                            className="sr-icon-btn"
                            title="View details"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelected(row);
                            }}
                          >
                            <Eye size={16} strokeWidth={2} />
                          </button>
                          {row.status === "approved" ||
                          row.status === "rejected" ? (
                            <button
                              type="button"
                              className="sr-icon-btn sr-icon-btn--hold"
                              title="Move to pending"
                              onClick={(e) => {
                                e.stopPropagation();
                                resume(row);
                              }}
                            >
                              <Play size={16} strokeWidth={2} />
                            </button>
                          ) : null}
                          {canReview(row.status) ? (
                            <>
                              {row.status === "pending" ? (
                                <button
                                  type="button"
                                  className="sr-icon-btn sr-icon-btn--hold"
                                  title="On hold"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    putOnHold(row);
                                  }}
                                >
                                  <Pause size={16} strokeWidth={2} />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="sr-icon-btn sr-icon-btn--hold"
                                  title="Move to pending"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    resume(row);
                                  }}
                                >
                                  <Play size={16} strokeWidth={2} />
                                </button>
                              )}
                              <button
                                type="button"
                                className="sr-icon-btn sr-icon-btn--ok"
                                title="Approve"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  approve(row);
                                }}
                              >
                                <Check size={16} strokeWidth={2} />
                              </button>
                              <button
                                type="button"
                                className="sr-icon-btn sr-icon-btn--no"
                                title="Reject"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  reject(row);
                                }}
                              >
                                <X size={16} strokeWidth={2} />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(selected || approving || rejecting) &&
        createPortal(
          <>
      {selected && !approving && !rejecting ? (
        <div
          className="sk-modal-backdrop"
          onClick={() => setSelected(null)}
          role="presentation"
        >
          <div
            className="sk-modal sk-reject-modal sk-view-modal"
            role="dialog"
            aria-labelledby="skViewTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sk-modal__head">
              <div>
                <p className="page-kicker">Student request</p>
                <h2 id="skViewTitle">
                  {fullName(selected.first_name, selected.last_name)}
                </h2>
                <p>{selected.email}</p>
              </div>
              <button
                type="button"
                className="sk-modal__nav-btn"
                onClick={() => setSelected(null)}
                aria-label="Close"
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>
            <div className="sk-reject-modal__body">
              <div className="sr-drawer__meta">
                <span className={`sk-pill sk-pill--${selected.status}`}>
                  {statusLabel(selected.status)}
                </span>
                <span className="sr-drawer__when">
                  Submitted {formatDate(selected.created_at)}
                </span>
              </div>
              {csvLoaded ? (
                <>
                  <div
                    className={`sr-csv-result ${
                      csvPhoneHit
                        ? csvPhoneHit.level === "possible"
                          ? "is-possible"
                          : "is-hit"
                        : csvNameHit
                          ? "is-possible"
                          : "is-miss"
                    }`}
                  >
                    <strong>
                      {csvPhoneHit
                        ? csvPhoneHit.level === "possible"
                          ? "Possible CSV phone match"
                          : "CSV phone match"
                        : csvNameHit
                          ? "CSV phone"
                          : "Phone not in uploaded CSV"}
                    </strong>
                    <span className="sr-csv-result__value">
                      {csvPhoneValue || "—"}
                    </span>
                    <span>CSV name: {csvPhoneCard?.csvName || "—"}</span>
                    <span>
                      {csvPhoneHit
                        ? `${csvPhoneHit.note}. Request: ${phoneDigits(selected.phone) || "—"}.`
                        : csvNameHit
                          ? "From the matched CSV name row. Request phone did not match this number."
                          : "This request phone was not found in the CSV, even with country-code differences."}
                    </span>
                  </div>
                  <div
                    className={`sr-csv-result ${
                      csvNameHit
                        ? csvNameHit.level === "possible"
                          ? "is-possible"
                          : "is-hit"
                        : csvPhoneHit
                          ? "is-possible"
                          : "is-miss"
                    }`}
                  >
                    <strong>CSV name</strong>
                    <span className="sr-csv-result__value">
                      {csvNameValue || "—"}
                    </span>
                    <span>
                      CSV phone:{" "}
                      {(csvNameCard?.csvPhones || []).join(", ") ||
                        csvNameCard?.csv ||
                        "—"}
                    </span>
                    <span>
                      {csvNameHit
                        ? `${csvNameHit.note}. Request: ${fullName(selected.first_name, selected.last_name)}.`
                        : csvPhoneHit
                          ? `From the matched CSV phone row. Does not match the request name: ${fullName(selected.first_name, selected.last_name)}.`
                          : "No close name match in the CSV."}
                    </span>
                  </div>
                </>
              ) : (
                <p className="sr-compare__empty">
                  Upload a phone CSV to compare this request number and name.
                </p>
              )}
              <dl className="sr-approve-facts">
                <div>
                  <dt>Phone</dt>
                  <dd>{selected.phone || "—"}</dd>
                </div>
                <div>
                  <dt>Batch</dt>
                  <dd>{selected.batch_name || "—"}</dd>
                </div>
                <div>
                  <dt>TradingView</dt>
                  <dd>{selected.tradingview_username || "—"}</dd>
                </div>
                <div>
                  <dt>Telegram</dt>
                  <dd>{selected.telegram_user || "—"}</dd>
                </div>
                <div>
                  <dt>Date of birth</dt>
                  <dd>{formatDate(selected.date_of_birth)}</dd>
                </div>
                {selected.address ? (
                  <div className="sr-approve-facts__span">
                    <dt>Address</dt>
                    <dd>{selected.address}</dd>
                  </div>
                ) : null}
                {selected.note ? (
                  <div className="sr-approve-facts__span">
                    <dt>Note</dt>
                    <dd>{selected.note}</dd>
                  </div>
                ) : null}
                {selected.status === "rejected" ? (
                  <div className="sr-approve-facts__span">
                    <dt>Rejection reason</dt>
                    <dd>{selected.review_note || "—"}</dd>
                  </div>
                ) : null}
              </dl>
              <section className="sr-compare">
                <div className="sr-compare__head">
                  <Users size={15} strokeWidth={2} />
                  <h3>Compare with students</h3>
                </div>
                {matchesLoading ? (
                  <p className="sr-compare__empty">Checking the students list…</p>
                ) : matches.students.length === 0 &&
                  matches.requests.length === 0 ? (
                  <p className="sr-compare__empty">
                    No matching student or other request found.
                  </p>
                ) : (
                  <>
                    {matches.students.length ? (
                      <p className="sr-compare__warn">
                        <AlertTriangle size={14} strokeWidth={2} />
                        Possible duplicate — already in the students list.
                      </p>
                    ) : null}
                    <MatchList
                      title="Students list"
                      kind="student"
                      items={matches.students}
                    />
                    <MatchList
                      title="Other requests"
                      kind="request"
                      items={matches.requests}
                    />
                  </>
                )}
              </section>
            </div>
            <div className="sk-reject-modal__foot">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setSelected(null)}
              >
                Close
              </button>
              {selected.status === "approved" ||
              selected.status === "rejected" ? (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => resume(selected)}
                >
                  <Play size={16} strokeWidth={2} />
                  Move to pending
                </button>
              ) : null}
              {canReview(selected.status) ? (
                <>
                  {selected.status === "pending" ? (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => putOnHold(selected)}
                    >
                      <Pause size={16} strokeWidth={2} />
                      On hold
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => resume(selected)}
                    >
                      <Play size={16} strokeWidth={2} />
                      Move to pending
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => reject(selected)}
                  >
                    <X size={16} strokeWidth={2} />
                    Reject
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => approve(selected)}
                  >
                    <Check size={16} strokeWidth={2} />
                    Approve
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {approving ? (
        <div
          className="sk-modal-backdrop"
          onClick={() => setApproving(null)}
          role="presentation"
        >
          <div
            className="sk-modal sk-reject-modal"
            role="dialog"
            aria-labelledby="skApproveTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sk-modal__head">
              <div>
                <p className="page-kicker">Student request</p>
                <h2 id="skApproveTitle">Approve this request?</h2>
                <p>
                  Check these details, then add them to the students list.
                </p>
              </div>
              <button
                type="button"
                className="sk-modal__nav-btn"
                onClick={() => setApproving(null)}
                aria-label="Close"
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>
            <div className="sk-reject-modal__body">
              <dl className="sr-approve-facts">
                <div>
                  <dt>Name</dt>
                  <dd>{fullName(approving.first_name, approving.last_name)}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{approving.email || "—"}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{approving.phone || "—"}</dd>
                </div>
                <div>
                  <dt>Batch</dt>
                  <dd>{approving.batch_name || "—"}</dd>
                </div>
                <div>
                  <dt>TradingView</dt>
                  <dd>{approving.tradingview_username || "—"}</dd>
                </div>
                <div>
                  <dt>Telegram</dt>
                  <dd>{approving.telegram_user || "—"}</dd>
                </div>
                <div>
                  <dt>Date of birth</dt>
                  <dd>{formatDate(approving.date_of_birth)}</dd>
                </div>
                {approving.address ? (
                  <div className="sr-approve-facts__span">
                    <dt>Address</dt>
                    <dd>{approving.address}</dd>
                  </div>
                ) : null}
                {approving.note ? (
                  <div className="sr-approve-facts__span">
                    <dt>Note</dt>
                    <dd>{approving.note}</dd>
                  </div>
                ) : null}
              </dl>
              {matches.students.length || matches.requests.length ? (
                <div className="sr-compare sr-compare--modal">
                  <p className="sr-compare__warn">
                    <AlertTriangle size={14} strokeWidth={2} />
                    This looks like an existing student or a second request.
                  </p>
                  <MatchList
                    title="Students list"
                    kind="student"
                    items={matches.students}
                  />
                  <MatchList
                    title="Other requests"
                    kind="request"
                    items={matches.requests}
                  />
                </div>
              ) : null}
              {error ? <p className="portal-alert">{error}</p> : null}
            </div>
            <div className="sk-reject-modal__foot">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setApproving(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={confirmApprove}
              >
                <Check size={16} strokeWidth={2} />
                Approve and email
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {rejecting ? (
        <div
          className="sk-modal-backdrop"
          onClick={() => setRejecting(null)}
          role="presentation"
        >
          <div
            className="sk-modal sk-reject-modal"
            role="dialog"
            aria-labelledby="skRejectTitle"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sk-modal__head">
              <div>
                <p className="page-kicker">Student request</p>
                <h2 id="skRejectTitle">Reject this request?</h2>
                <p>
                  {fullName(rejecting.first_name, rejecting.last_name)} (
                  {rejecting.email}) will be emailed the reason you select.
                </p>
              </div>
              <button
                type="button"
                className="sk-modal__nav-btn"
                onClick={() => setRejecting(null)}
                aria-label="Close"
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>
            <div className="sk-reject-modal__body">
              <p className="sk-reject-modal__label">Reason</p>
              <div className="sk-reject-options">
                {REJECT_OPTIONS.map((option) => (
                  <label key={option.id} className="sk-reject-option">
                    <input
                      type="radio"
                      name="rejectReason"
                      value={option.id}
                      checked={rejectReason === option.id}
                      onChange={() => setRejectReason(option.id)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
              {rejectReason === "custom" ? (
                <textarea
                  className="sk-reject-custom"
                  rows={4}
                  maxLength={500}
                  placeholder="Write the reason that will be emailed to them"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                />
              ) : null}
              {error ? <p className="portal-alert">{error}</p> : null}
            </div>
            <div className="sk-reject-modal__foot">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setRejecting(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={confirmReject}
              >
                Reject and email
              </button>
            </div>
          </div>
        </div>
      ) : null}
          </>,
          document.body
        )}
    </section>
  );
}
