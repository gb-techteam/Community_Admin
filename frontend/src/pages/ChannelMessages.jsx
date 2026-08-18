import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  CheckCheck,
  Eye,
  Heading,
  ImagePlus,
  Info,
  Lock,
  Mic,
  Pencil,
  Send,
  Square,
  Trash2,
  UserPlus,
  Video,
  X,
} from "lucide-react";
import { api, apiUpload } from "../lib/api";
import { connectChannelSocket } from "../lib/channelSocket";
import { useFeedback } from "../lib/feedback";
import { getAdmin, hasPower, isSuperAdmin } from "../lib/auth";
import AddPeopleModal from "../components/AddPeopleModal";
import MessageInfoModal from "../components/MessageInfoModal";

function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function timeLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function mediaLabel(type) {
  if (type === "image") return "Photo";
  if (type === "video") return "Video";
  if (type === "audio") return "Voice message";
  return "Attachment";
}

function messageIsFullyRead(message, memberCount) {
  const studentSeen = Number(message.student_seen_count) || 0;
  if (memberCount > 0) return studentSeen >= memberCount;
  return (Number(message.seen_count) || 0) > 0;
}

function MessageTicks({ message, memberCount }) {
  const seen = Number(message.seen_count) || 0;
  const readAll = messageIsFullyRead(message, memberCount);

  if (seen > 0) {
    return (
      <span
        className={`msg-ticks ${readAll ? "is-read" : "is-delivered"}`}
        title={readAll ? "Seen by everyone" : "Seen"}
        aria-label={readAll ? "Seen by everyone" : "Seen"}
      >
        <CheckCheck size={14} strokeWidth={2.4} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span className="msg-ticks is-sent" title="Sent" aria-label="Sent">
      <Check size={14} strokeWidth={2.4} aria-hidden="true" />
    </span>
  );
}

export default function ChannelMessages() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { confirm, notify } = useFeedback();
  const admin = getAdmin();
  const canManage = hasPower("manage_channels");
  const canMessage = hasPower("message_channels");
  const canSend = canMessage;

  const [channel, setChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [memberCount, setMemberCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [showTitle, setShowTitle] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [infoMessageId, setInfoMessageId] = useState(null);

  const [pendingFile, setPendingFile] = useState(null);
  const [pendingPreview, setPendingPreview] = useState("");
  const [pendingKind, setPendingKind] = useState(null);

  const [recording, setRecording] = useState(false);
  const [recordLocked, setRecordLocked] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const [slideHint, setSlideHint] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);

  const threadRef = useRef(null);
  const dockRef = useRef(null);
  const composerRef = useRef(null);
  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordChunksRef = useRef([]);
  const recordTimerRef = useRef(null);
  const recordStartedAt = useRef(0);
  const recordDispositionRef = useRef("keep");
  const recordLockedRef = useRef(false);
  const recordGestureRef = useRef(null);
  const longPressRef = useRef(null);
  const suppressClickRef = useRef(false);
  const holdPointerActiveRef = useRef(false);
  const holdCleanupRef = useRef(null);
  const lockedActionLockRef = useRef(false);

  const [isMobileChat, setIsMobileChat] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 900px)").matches
  );
  const [composerH, setComposerH] = useState(96);

  function ownsMessage(message) {
    if (message.sent_by_portal_admin_id && admin?.portalAdminId) {
      return message.sent_by_portal_admin_id === admin.portalAdminId;
    }
    if (message.sent_by_role === "super_admin") return isSuperAdmin(admin);
    return message.sender_admin_id === admin?.id;
  }

  function clearPendingMedia() {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(null);
    setPendingPreview("");
    setPendingKind(null);
  }

  function resetComposer() {
    setBody("");
    setTitle("");
    setShowTitle(false);
    setEditingId(null);
    clearPendingMedia();
  }

  async function loadAll({ keepScroll = false } = {}) {
    try {
      const [channelData, messageData] = await Promise.all([
        api(`/api/channels/${id}`),
        api(`/api/channels/${id}/messages?limit=100`),
      ]);
      setChannel(channelData.channel);
      setMessages(messageData.messages || []);
      setMemberCount(messageData.memberCount ?? channelData.channel?.member_count ?? 0);
      if (!keepScroll) {
        requestAnimationFrame(() => {
          const node = threadRef.current;
          if (node) node.scrollTop = node.scrollHeight;
        });
      }
    } catch (err) {
      setError(err.message);
      if (String(err.message).toLowerCase().includes("access")) {
        notify({
          title: "Channel unavailable",
          message: err.message,
        });
        navigate("/dashboard/channels", { replace: true });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    setError("");
    loadAll();
    return () => {
      document.body.classList.remove("msg-hold-active");
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
      stopRecordingCleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!id) return undefined;

    function nearBottom() {
      const node = threadRef.current;
      if (!node) return true;
      return node.scrollHeight - node.scrollTop - node.clientHeight < 120;
    }

    function scrollToBottom() {
      requestAnimationFrame(() => {
        const node = threadRef.current;
        if (node) node.scrollTop = node.scrollHeight;
      });
    }

    return connectChannelSocket(id, (event) => {
      if (event.type === "message.created" && event.message) {
        const shouldStick = nearBottom();
        const incoming = {
          ...event.message,
          id: Number(event.message.id),
        };
        setMessages((prev) => {
          if (prev.some((m) => Number(m.id) === incoming.id)) {
            return prev.map((m) =>
              Number(m.id) === incoming.id ? { ...m, ...incoming } : m
            );
          }
          return [...prev, incoming];
        });
        if (shouldStick) scrollToBottom();
        return;
      }

      if (event.type === "message.updated" && event.message) {
        const incoming = {
          ...event.message,
          id: Number(event.message.id),
        };
        setMessages((prev) =>
          prev.map((m) =>
            Number(m.id) === incoming.id ? { ...m, ...incoming } : m
          )
        );
        return;
      }

      if (event.type === "message.deleted" && event.messageId != null) {
        const deletedId = Number(event.messageId);
        setMessages((prev) => prev.filter((m) => Number(m.id) !== deletedId));
        return;
      }

      if (event.type === "message.seen" && event.messageId != null) {
        const seenId = Number(event.messageId);
        setMessages((prev) =>
          prev.map((m) => {
            if (Number(m.id) !== seenId) return m;
            const prevSeen = Number(m.seen_count) || 0;
            const nextSeen =
              event.seenCount != null ? Number(event.seenCount) : prevSeen;
            const bumped = Math.max(0, nextSeen - prevSeen);
            return {
              ...m,
              seen_count: nextSeen,
              admin_seen_count:
                event.read?.kind === "admin"
                  ? (Number(m.admin_seen_count) || 0) + (bumped || 1)
                  : m.admin_seen_count,
              student_seen_count:
                event.read?.kind === "student"
                  ? (Number(m.student_seen_count) || 0) + (bumped || 1)
                  : m.student_seen_count,
            };
          })
        );
      }
    });
  }, [id]);

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 900px)");
    const sync = () => setIsMobileChat(mobile.matches);
    sync();
    mobile.addEventListener("change", sync);
    return () => mobile.removeEventListener("change", sync);
  }, []);

  // Keep message list ABOVE the fixed composer (not behind it)
  useLayoutEffect(() => {
    if (!isMobileChat) {
      document.documentElement.style.removeProperty("--composer-h");
      return undefined;
    }

    function measure() {
      const node = dockRef.current;
      if (!node) return;
      // Full rendered height (includes safe-area padding) + small buffer
      const h = Math.ceil(node.getBoundingClientRect().height || 0);
      const pad = Math.max(h + 8, 76);
      setComposerH(pad);
      document.documentElement.style.setProperty("--composer-h", `${pad}px`);
    }

    measure();
    const raf = window.requestAnimationFrame(measure);
    const timers = [50, 150, 400, 800].map((ms) =>
      window.setTimeout(measure, ms)
    );

    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (dockRef.current && ro) ro.observe(dockRef.current);

    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);

    return () => {
      window.cancelAnimationFrame(raf);
      ro?.disconnect();
      timers.forEach((id) => window.clearTimeout(id));
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      document.documentElement.style.removeProperty("--composer-h");
    };
  }, [isMobileChat, recording, pendingFile, showTitle, editingId, canSend]);

  // After composer height is known, keep the last message visible above it
  useEffect(() => {
    if (!isMobileChat) return;
    const node = threadRef.current;
    if (!node) return;
    requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
  }, [isMobileChat, composerH]);

  function stopRecordingCleanup() {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    }
    mediaRecorderRef.current = null;
  }

  function clearLongPress() {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }

  function openMessageActions(message) {
    clearLongPress();
    suppressClickRef.current = true;
    setActionMessage(message);
    if (navigator.vibrate) {
      try {
        navigator.vibrate(18);
      } catch {
        /* ignore */
      }
    }
  }

  function closeMessageActions() {
    setActionMessage(null);
  }

  function handleBubblePointerDown(event, message) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Desktop with fine pointer still uses hover toolbar
    if (event.pointerType === "mouse") return;

    clearLongPress();
    const startX = event.clientX;
    const startY = event.clientY;
    longPressRef.current = setTimeout(() => {
      openMessageActions(message);
    }, 420);

    const onMove = (moveEvent) => {
      const dx = Math.abs(moveEvent.clientX - startX);
      const dy = Math.abs(moveEvent.clientY - startY);
      if (dx > 10 || dy > 10) clearLongPress();
    };
    const onUp = () => {
      clearLongPress();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function handleBubbleClick(event) {
    if (suppressClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressClickRef.current = false;
    }
  }

  function pickFile(file) {
    if (!file) return;
    if (editingId) {
      setError("Finish or cancel the edit before attaching media.");
      return;
    }

    const type = file.type || "";
    const name = file.name || "";
    let kind = null;
    if (type.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(name)) {
      kind = "image";
    } else if (type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(name)) {
      kind = "video";
    } else if (
      type.startsWith("audio/") ||
      /\.(webm|ogg|mp3|m4a|aac|wav|caf)$/i.test(name)
    ) {
      kind = "audio";
    }

    if (!kind) {
      setError("Unsupported file. Use an image, video, or audio file.");
      return;
    }

    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(file);
    setPendingKind(kind);
    setPendingPreview(URL.createObjectURL(file));
    setError("");
  }

  function pickRecorderMime() {
    if (typeof MediaRecorder === "undefined") return null;
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/aac",
      "audio/ogg",
    ];
    for (const type of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(type)) return type;
      } catch {
        /* ignore */
      }
    }
    return "";
  }

  function extensionForMime(mime) {
    const type = String(mime || "").toLowerCase();
    if (type.includes("mp4") || type.includes("aac") || type.includes("m4a")) {
      return "m4a";
    }
    if (type.includes("ogg")) return "ogg";
    if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
    if (type.includes("wav")) return "wav";
    return "webm";
  }

  async function startRecording() {
    if (editingId) {
      setError("Finish or cancel the edit before recording.");
      return false;
    }
    if (recording) return true;

    const secure =
      window.isSecureContext ||
      location.protocol === "https:" ||
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1";

    if (!secure) {
      setError(
        "Microphone needs HTTPS on phones. Open the Network URL that starts with https:// (accept the certificate warning once), or attach an audio file."
      );
      audioInputRef.current?.click();
      return false;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError(
        "This browser can’t record in-page. Choose a voice note file instead."
      );
      audioInputRef.current?.click();
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const mime = pickRecorderMime();
      const recorder =
        mime === null
          ? null
          : mime
            ? new MediaRecorder(stream, { mimeType: mime })
            : new MediaRecorder(stream);

      if (!recorder) {
        stream.getTracks().forEach((track) => track.stop());
        setError("Recording isn’t available here. Attach an audio file instead.");
        audioInputRef.current?.click();
        return false;
      }

      recordChunksRef.current = [];
      recordStartedAt.current = Date.now();
      recordDispositionRef.current = "keep";
      recordLockedRef.current = false;
      setRecordLocked(false);
      setSlideHint(null);
      setRecordMs(0);
      setRecording(true);
      setError("");

      recorder.ondataavailable = (event) => {
        if (event.data?.size) recordChunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        setRecordLocked(false);
        setSlideHint(null);
        setError("Recording failed. Try attaching an audio file instead.");
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (recordTimerRef.current) {
          clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }

        const disposition = recordDispositionRef.current;
        setRecording(false);
        setRecordLocked(false);
        setSlideHint(null);
        recordLockedRef.current = false;
        recordGestureRef.current = null;
        mediaRecorderRef.current = null;

        if (disposition === "cancel") {
          recordChunksRef.current = [];
          return;
        }

        const duration = Date.now() - recordStartedAt.current;
        const blobType = recorder.mimeType || mime || "audio/webm";
        const blob = new Blob(recordChunksRef.current, { type: blobType });
        recordChunksRef.current = [];

        if (!blob.size || duration < 400) {
          setError("Hold a bit longer to record a voice note.");
          return;
        }

        const ext = extensionForMime(blobType);
        const file = new File([blob], `voice-${Date.now()}.${ext}`, {
          type: blobType.split(";")[0] || `audio/${ext}`,
        });
        file._durationMs = duration;

        if (disposition === "send") {
          void sendVoiceNote(file);
        } else {
          pickFile(file);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      recordTimerRef.current = setInterval(() => {
        setRecordMs(Date.now() - recordStartedAt.current);
      }, 200);
      return true;
    } catch (err) {
      const name = err?.name || "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError("Allow microphone access to record a voice note.");
      } else if (name === "NotFoundError") {
        setError("No microphone was found on this device.");
      } else {
        setError(
          "Could not start recording. Try HTTPS or attach an audio file."
        );
        audioInputRef.current?.click();
      }
      setRecording(false);
      setRecordLocked(false);
      return false;
    }
  }

  function finishRecording(disposition = "keep") {
    if (holdCleanupRef.current) {
      holdCleanupRef.current();
      holdCleanupRef.current = null;
    }
    document.body.classList.remove("msg-hold-active");
    recordDispositionRef.current = disposition;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        setRecording(false);
        setRecordLocked(false);
        setSlideHint(null);
      }
    } else {
      setRecording(false);
      setRecordLocked(false);
      setSlideHint(null);
    }
  }

  function cancelRecording() {
    finishRecording("cancel");
  }

  function lockRecording() {
    if (!mediaRecorderRef.current || recordLockedRef.current) return;
    recordLockedRef.current = true;
    setRecordLocked(true);
    setSlideHint(null);
    recordGestureRef.current = null;
    holdPointerActiveRef.current = false;
    // End hold-gesture blockers so Send / Stop / Trash can receive taps
    if (holdCleanupRef.current) {
      holdCleanupRef.current();
      holdCleanupRef.current = null;
    }
    document.body.classList.remove("msg-hold-active");
    if (navigator.vibrate) {
      try {
        navigator.vibrate(14);
      } catch {
        /* ignore */
      }
    }
  }

  async function onMicPointerDown(event) {
    if (editingId || sending || recording) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    window.getSelection?.()?.removeAllRanges?.();

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    holdPointerActiveRef.current = true;
    document.body.classList.add("msg-hold-active");

    const blockBrowser = (blockEvent) => {
      blockEvent.preventDefault();
    };
    document.addEventListener("selectstart", blockBrowser, true);
    document.addEventListener("contextmenu", blockBrowser, true);
    document.addEventListener("dragstart", blockBrowser, true);

    let moveHandler = null;
    let upHandler = null;

    const detachHoldListeners = () => {
      if (moveHandler) {
        window.removeEventListener("pointermove", moveHandler);
        moveHandler = null;
      }
      if (upHandler) {
        window.removeEventListener("pointerup", upHandler);
        window.removeEventListener("pointercancel", upHandler);
        upHandler = null;
      }
      document.removeEventListener("selectstart", blockBrowser, true);
      document.removeEventListener("contextmenu", blockBrowser, true);
      document.removeEventListener("dragstart", blockBrowser, true);
    };

    holdCleanupRef.current = detachHoldListeners;

    const releaseEarly = (upEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      holdPointerActiveRef.current = false;
      window.removeEventListener("pointerup", releaseEarly);
      window.removeEventListener("pointercancel", releaseEarly);
    };
    window.addEventListener("pointerup", releaseEarly);
    window.addEventListener("pointercancel", releaseEarly);

    const started = await startRecording();
    window.removeEventListener("pointerup", releaseEarly);
    window.removeEventListener("pointercancel", releaseEarly);

    if (!started) {
      holdPointerActiveRef.current = false;
      detachHoldListeners();
      holdCleanupRef.current = null;
      document.body.classList.remove("msg-hold-active");
      return;
    }

    // Finger already lifted while mic permission / recorder started → send
    if (!holdPointerActiveRef.current) {
      detachHoldListeners();
      holdCleanupRef.current = null;
      finishRecording("send");
      return;
    }

    recordGestureRef.current = { pointerId, startX, startY };

    moveHandler = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!mediaRecorderRef.current || recordLockedRef.current) return;
      moveEvent.preventDefault();

      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      // WhatsApp: slide up past lock zone → lock immediately (hands-free)
      if (dy < -64) {
        lockRecording();
        return;
      }

      // Slide left or right → cancel zone preview
      if (Math.abs(dx) > 70) {
        setSlideHint("cancel");
      } else if (dy < -28) {
        setSlideHint("lock");
      } else {
        setSlideHint(null);
      }
    };

    upHandler = (upEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      holdPointerActiveRef.current = false;

      // Already locked during the swipe — keep recording
      if (recordLockedRef.current) {
        detachHoldListeners();
        holdCleanupRef.current = null;
        recordGestureRef.current = null;
        return;
      }

      const dx = upEvent.clientX - startX;
      const dy = upEvent.clientY - startY;
      recordGestureRef.current = null;
      detachHoldListeners();
      holdCleanupRef.current = null;
      document.body.classList.remove("msg-hold-active");

      if (Math.abs(dx) > 70) {
        cancelRecording();
        return;
      }
      if (dy < -64) {
        lockRecording();
        return;
      }

      // Release while holding = send (WhatsApp)
      finishRecording("send");
    };

    window.addEventListener("pointermove", moveHandler, { passive: false });
    window.addEventListener("pointerup", upHandler);
    window.addEventListener("pointercancel", upHandler);
  }

  function onLockedAction(disposition) {
    return (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (lockedActionLockRef.current) return;
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
        return;
      }
      lockedActionLockRef.current = true;
      finishRecording(disposition);
      window.setTimeout(() => {
        lockedActionLockRef.current = false;
      }, 500);
    };
  }

  function upsertMessage(message) {
    if (!message?.id) return;
    const incoming = { ...message, id: Number(message.id) };
    setMessages((prev) => {
      const idx = prev.findIndex((m) => Number(m.id) === incoming.id);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = { ...next[idx], ...incoming };
        return next;
      }
      return [...prev, incoming];
    });
    requestAnimationFrame(() => {
      const node = threadRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
  }

  async function sendVoiceNote(file) {
    setSending(true);
    setError("");
    try {
      const form = new FormData();
      form.append("media", file);
      if (file._durationMs) {
        form.append("mediaDurationMs", String(file._durationMs));
      }
      const result = await apiUpload(`/api/channels/${id}/messages`, form);
      resetComposer();
      if (result.message) {
        upsertMessage(result.message);
      } else {
        await loadAll();
      }
    } catch (err) {
      setError(err.message);
      pickFile(file);
    } finally {
      setSending(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (sending) return;
    if (!body.trim() && !pendingFile && !editingId) return;

    setSending(true);
    setError("");

    try {
      if (editingId) {
        const result = await api(`/api/channels/${id}/messages/${editingId}`, {
          method: "PUT",
          body: JSON.stringify({ title, body }),
        });
        if (result.message) upsertMessage(result.message);
        else await loadAll({ keepScroll: true });
        notify({
          title: "Message updated",
          message: "Everyone in the channel sees the edited version.",
        });
      } else {
        const form = new FormData();
        if (title.trim()) form.append("title", title.trim());
        if (body.trim()) form.append("body", body.trim());
        if (pendingFile) {
          form.append("media", pendingFile);
          if (pendingKind === "audio" && pendingFile._durationMs) {
            form.append("mediaDurationMs", String(pendingFile._durationMs));
          }
        }

        const result = await apiUpload(`/api/channels/${id}/messages`, form);
        if (result.message) {
          upsertMessage(result.message);
        } else {
          await loadAll();
        }
      }

      resetComposer();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(message) {
    closeMessageActions();
    const ok = await confirm({
      title: "Delete message",
      message:
        "This removes the message for everyone, including the app. This cannot be undone.",
      confirmLabel: "Delete message",
      tone: "danger",
    });
    if (!ok) return;

    try {
      await api(`/api/channels/${id}/messages/${message.id}`, {
        method: "DELETE",
      });
      if (editingId === message.id) resetComposer();
      await loadAll({ keepScroll: true });
      notify({
        title: "Message deleted",
        message: "It no longer appears in the channel.",
      });
    } catch (err) {
      setError(err.message);
    }
  }

  function startEdit(message) {
    closeMessageActions();
    if (message.media_type && !message.body) {
      setError("Media-only messages can be deleted, not edited.");
      return;
    }
    clearPendingMedia();
    setEditingId(message.id);
    setBody(message.body || "");
    setTitle(message.title || "");
    setShowTitle(Boolean(message.title));
    composerRef.current?.focus();
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit(event);
    }
  }

  const showMicAsPrimary =
    canSend && !editingId && !body.trim() && !pendingFile && !showTitle;
  let lastDay = null;

  const dockEl = (
        <div
          className={`msg-dock${isMobileChat ? " msg-dock--fixed" : ""}`}
          ref={dockRef}
        >

          {canSend ? (
            <>
              {recording ? (
                <div
                  className={`msg-record msg-record--bar ${
                    recordLocked ? "is-locked" : ""
                  } ${slideHint === "cancel" ? "is-cancel" : ""} ${
                    slideHint === "lock" ? "is-lock" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="msg-record__trash"
                    onPointerUp={onLockedAction("cancel")}
                    onClick={onLockedAction("cancel")}
                    aria-label="Delete voice note"
                  >
                    <Trash2 size={18} strokeWidth={2} />
                  </button>

                  <div className="msg-record__main">
                    <span className="msg-record__dot" aria-hidden="true" />
                    <strong>{formatDuration(recordMs)}</strong>
                    {!recordLocked ? (
                      <span className="msg-record__hint">
                        {slideHint === "cancel"
                          ? "Release to cancel"
                          : slideHint === "lock"
                            ? "Release to lock"
                            : "← slide to cancel · ↑ slide to lock"}
                      </span>
                    ) : (
                      <span className="msg-record__hint">
                        <Lock size={12} strokeWidth={2.4} aria-hidden="true" />
                        Locked — tap send
                      </span>
                    )}
                  </div>

                  {!recordLocked ? (
                    <div className="msg-record__gestures" aria-hidden="true">
                      <span
                        className={`msg-record__up ${
                          slideHint === "lock" ? "is-hot" : ""
                        }`}
                      >
                        <ArrowUp size={14} strokeWidth={2.4} />
                        <Lock size={11} strokeWidth={2.4} />
                      </span>
                      <span
                        className={`msg-composer__mic is-recording ${
                          slideHint === "cancel" ? "is-cancel" : ""
                        }`}
                      >
                        <Mic size={20} strokeWidth={2.2} />
                      </span>
                    </div>
                  ) : (
                    <div className="msg-record__locked-actions">
                      <button
                        type="button"
                        className="msg-record__stop"
                        onPointerUp={onLockedAction("keep")}
                        onClick={onLockedAction("keep")}
                        aria-label="Stop recording"
                      >
                        <Square size={14} strokeWidth={2.6} />
                      </button>
                      <button
                        type="button"
                        className="msg-record__send"
                        onPointerUp={onLockedAction("send")}
                        onClick={onLockedAction("send")}
                        aria-label="Send voice note"
                      >
                        <Send size={18} strokeWidth={2.2} />
                      </button>
                    </div>
                  )}
                </div>
              ) : null}

              <form
                className="msg-composer msg-composer--page"
                onSubmit={handleSubmit}
                style={recording ? { display: "none" } : undefined}
              >
              {editingId ? (
                <div className="msg-composer__editing">
                  <span>Editing message</span>
                  <button type="button" onClick={resetComposer}>
                    Cancel
                  </button>
                </div>
              ) : null}

              {pendingFile ? (
                <div className="msg-composer__attach">
                  {pendingKind === "image" ? (
                    <img src={pendingPreview} alt="Selected" />
                  ) : pendingKind === "video" ? (
                    <video src={pendingPreview} controls />
                  ) : (
                    <div className="msg-composer__voice-preview">
                      <Mic size={16} strokeWidth={2} aria-hidden="true" />
                      <span>
                        Voice note
                        {pendingFile._durationMs
                          ? ` · ${formatDuration(pendingFile._durationMs)}`
                          : ""}
                      </span>
                      <audio src={pendingPreview} controls />
                    </div>
                  )}
                  <button
                    type="button"
                    className="msg-composer__attach-clear"
                    onClick={clearPendingMedia}
                    aria-label="Remove attachment"
                  >
                    <X size={14} strokeWidth={2} />
                  </button>
                </div>
              ) : null}

              {showTitle ? (
                <input
                  className="msg-composer__title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Optional headline"
                  maxLength={200}
                />
              ) : null}

                <div className="msg-composer__row">
                  <div className="msg-composer__tools">
                    <button
                      type="button"
                      className="msg-composer__tool"
                      title="Attach image"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={Boolean(editingId)}
                    >
                      <ImagePlus size={17} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      className="msg-composer__tool"
                      title="Attach video"
                      onClick={() => videoInputRef.current?.click()}
                      disabled={Boolean(editingId)}
                    >
                      <Video size={17} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      className="msg-composer__tool msg-composer__tool--desktop-mic"
                      title="Record voice"
                      onClick={() => startRecording()}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        if (!editingId) audioInputRef.current?.click();
                      }}
                      disabled={Boolean(editingId)}
                    >
                      <Mic size={17} strokeWidth={2} />
                    </button>
                  </div>

                  <textarea
                    ref={composerRef}
                    className="msg-composer__input"
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => {
                      window.setTimeout(() => {
                        composerRef.current?.scrollIntoView({
                          block: "nearest",
                          behavior: "smooth",
                        });
                      }, 350);
                    }}
                    placeholder="Message"
                    rows={1}
                  />

                  <button
                    type="button"
                    className={`msg-composer__toggle ${showTitle ? "is-on" : ""}`}
                    onClick={() => setShowTitle((value) => !value)}
                    title={showTitle ? "Remove headline" : "Add a headline"}
                    aria-pressed={showTitle}
                  >
                    <Heading size={16} strokeWidth={2.2} />
                  </button>

                  {showMicAsPrimary ? (
                    <button
                      type="button"
                      className="msg-composer__mic"
                      title="Hold to record · slide up to lock · slide to cancel"
                      aria-label="Hold to record voice note"
                      onPointerDown={onMicPointerDown}
                      onContextMenu={(event) => event.preventDefault()}
                      onDragStart={(event) => event.preventDefault()}
                      disabled={Boolean(editingId) || sending}
                    >
                      <Mic size={20} strokeWidth={2.2} />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="msg-composer__send"
                      disabled={
                        sending ||
                        (!editingId && !body.trim() && !pendingFile) ||
                        (editingId && !body.trim())
                      }
                      aria-label={editingId ? "Save message" : "Send message"}
                    >
                      {editingId ? (
                        <Check size={17} strokeWidth={2.2} />
                      ) : (
                        <Send size={17} strokeWidth={2.2} />
                      )}
                    </button>
                  )}
                </div>

              <input
                ref={imageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                hidden
                onChange={(event) => {
                  pickFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <input
                ref={videoInputRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                hidden
                onChange={(event) => {
                  pickFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*,.m4a,.aac,.mp3,.wav,.ogg,.webm,.caf"
                capture="user"
                hidden
                onChange={(event) => {
                  pickFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              </form>
            </>
          ) : (
            <p className="msg-composer__locked">
              You need the “Message channels” power to post here.
            </p>
          )}
        </div>
  );

  return (
    <div
      className="portal-page msg-page"
      style={
        isMobileChat
          ? { paddingBottom: composerH, boxSizing: "border-box" }
          : undefined
      }
    >
      <header className="msg-page__head">
        <button
          type="button"
          className="msg-page__back"
          onClick={() => navigate("/dashboard/channels")}
          aria-label="Back to channels"
        >
          <ArrowLeft size={18} strokeWidth={2} />
        </button>

        <div className="msg-page__identity">
          <span className="msg-page__avatar" aria-hidden="true">
            {initials(channel?.name)}
          </span>
          <div className="msg-page__titles">
            <h1>{channel?.name || (loading ? "Loading…" : "Channel")}</h1>
            <p>
              {channel
                ? `${channel.member_count ?? 0} members · ${channel.message_count ?? 0} messages`
                : "Broadcast channel"}
            </p>
          </div>
        </div>

        <div className="msg-page__actions">
          {channel ? (
            <button
              type="button"
              className="btn-ghost msg-page__people"
              onClick={() => setPeopleOpen(true)}
            >
              <UserPlus size={15} strokeWidth={2} aria-hidden="true" />
              <span>People</span>
            </button>
          ) : null}
        </div>
      </header>

      {error ? <p className="portal-alert">{error}</p> : null}

      <div className="msg-page__panel">
        <div className="msg-thread msg-thread--page" ref={threadRef}>
          {loading ? (
            <p className="msg-thread__empty">Loading messages…</p>
          ) : messages.length === 0 ? (
            <div className="msg-thread__empty">
              <strong>No messages yet</strong>
              <span>
                {canSend
                  ? "Send text, a photo, video, or voice note to start the broadcast."
                  : "Nothing has been sent to this channel."}
              </span>
            </div>
          ) : (
            messages.map((message) => {
              const mine = ownsMessage(message);
              const day = dayLabel(message.created_at);
              const showDay = day !== lastDay;
              lastDay = day;
              const sender =
                message.sender_name || message.sent_by || "Unknown sender";
              const placeholderBody =
                !message.body ||
                message.body === "Voice message" ||
                message.body === "Attachment";
              const canAct = mine || canManage;

              return (
                <div key={message.id}>
                  {showDay ? (
                    <div className="msg-day">
                      <span>{day}</span>
                    </div>
                  ) : null}

                  <article
                    className={`msg-row ${mine ? "is-mine" : ""} ${
                      actionMessage?.id === message.id ? "is-active" : ""
                    }`}
                  >
                    {!mine ? (
                      <span className="msg-avatar" aria-hidden="true">
                        {initials(sender)}
                      </span>
                    ) : null}

                    <div
                      className={`msg-bubble ${message.media_type ? "has-media" : ""}`}
                      onPointerDown={(event) =>
                        handleBubblePointerDown(event, message)
                      }
                      onClick={handleBubbleClick}
                      onContextMenu={(event) => {
                        if (window.matchMedia("(hover: none)").matches) {
                          event.preventDefault();
                          openMessageActions(message);
                        }
                      }}
                    >
                      {!mine ? (
                        <span className="msg-bubble__sender">{sender}</span>
                      ) : null}
                      {message.title ? (
                        <strong className="msg-bubble__title">
                          {message.title}
                        </strong>
                      ) : null}

                      {message.media_type === "image" && message.media_url ? (
                        <a
                          href={message.media_url}
                          target="_blank"
                          rel="noreferrer"
                          className="msg-media"
                          onClick={(event) => {
                            if (suppressClickRef.current) {
                              event.preventDefault();
                            }
                          }}
                        >
                          <img
                            src={message.media_url}
                            alt={message.media_name || "Image"}
                          />
                        </a>
                      ) : null}

                      {message.media_type === "video" && message.media_url ? (
                        <video
                          className="msg-media msg-media--video"
                          src={message.media_url}
                          controls
                          preload="metadata"
                        />
                      ) : null}

                      {message.media_type === "audio" && message.media_url ? (
                        <div className="msg-audio">
                          <span className="msg-audio__icon" aria-hidden="true">
                            <Mic size={14} strokeWidth={2.2} />
                          </span>
                          <div className="msg-audio__body">
                            <span className="msg-audio__label">
                              Voice message
                              {message.media_duration_ms
                                ? ` · ${formatDuration(message.media_duration_ms)}`
                                : ""}
                            </span>
                            <audio
                              src={message.media_url}
                              controls
                              preload="metadata"
                            />
                          </div>
                        </div>
                      ) : null}

                      {!placeholderBody ? (
                        <p className="msg-bubble__body">{message.body}</p>
                      ) : null}

                      <footer className="msg-bubble__meta">
                        <button
                          type="button"
                          className="msg-bubble__seen"
                          onClick={() => setInfoMessageId(message.id)}
                          title="Message info"
                        >
                          <Eye size={12} strokeWidth={2.2} aria-hidden="true" />
                          <span>
                            {message.seen_count ?? 0}
                            {memberCount ? `/${memberCount}` : ""}
                          </span>
                        </button>
                        <span className="msg-bubble__time">
                          {timeLabel(message.created_at)}
                          {message.edited_at ? " · edited" : ""}
                          {mine ? (
                            <MessageTicks
                              message={message}
                              memberCount={memberCount}
                            />
                          ) : null}
                        </span>
                      </footer>

                      <div className="msg-bubble__actions msg-bubble__actions--desktop">
                        <button
                          type="button"
                          onClick={() => setInfoMessageId(message.id)}
                          title="Message info"
                          aria-label="Message info"
                        >
                          <Info size={13} strokeWidth={2} />
                        </button>
                        {mine && !message.media_type ? (
                          <button
                            type="button"
                            onClick={() => startEdit(message)}
                            title="Edit message"
                            aria-label="Edit message"
                          >
                            <Pencil size={13} strokeWidth={2} />
                          </button>
                        ) : null}
                        {canAct ? (
                          <button
                            type="button"
                            onClick={() => handleDelete(message)}
                            title="Delete message"
                            aria-label="Delete message"
                          >
                            <Trash2 size={13} strokeWidth={2} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </article>
                </div>
              );
            })
          )}
          {isMobileChat ? (
            <div
              className="msg-thread__composer-spacer"
              style={{ height: composerH }}
              aria-hidden="true"
            />
          ) : null}
        </div>
      </div>

      {isMobileChat ? createPortal(dockEl, document.body) : dockEl}

      {actionMessage ? (
        <div
          className="msg-sheet"
          role="presentation"
          onClick={closeMessageActions}
        >
          <div
            className="msg-sheet__panel"
            role="dialog"
            aria-label="Message actions"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="msg-sheet__handle" aria-hidden="true" />
            <p className="msg-sheet__preview">
              {actionMessage.title ||
                actionMessage.body ||
                mediaLabel(actionMessage.media_type) ||
                "Message"}
            </p>
            <button
              type="button"
              className="msg-sheet__item"
              onClick={() => {
                setInfoMessageId(actionMessage.id);
                closeMessageActions();
              }}
            >
              <Info size={18} strokeWidth={2} />
              Info
            </button>
            {ownsMessage(actionMessage) && !actionMessage.media_type ? (
              <button
                type="button"
                className="msg-sheet__item"
                onClick={() => startEdit(actionMessage)}
              >
                <Pencil size={18} strokeWidth={2} />
                Edit
              </button>
            ) : null}
            {ownsMessage(actionMessage) || canManage ? (
              <button
                type="button"
                className="msg-sheet__item is-danger"
                onClick={() => handleDelete(actionMessage)}
              >
                <Trash2 size={18} strokeWidth={2} />
                Delete
              </button>
            ) : null}
            <button
              type="button"
              className="msg-sheet__cancel"
              onClick={closeMessageActions}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {peopleOpen && channel ? (
        <AddPeopleModal
          channel={channel}
          onClose={() => setPeopleOpen(false)}
          onChanged={() => loadAll({ keepScroll: true })}
        />
      ) : null}

      {infoMessageId ? (
        <MessageInfoModal
          channelId={id}
          messageId={infoMessageId}
          onClose={() => setInfoMessageId(null)}
        />
      ) : null}
    </div>
  );
}
