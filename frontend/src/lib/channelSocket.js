function wsUrl(token) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  return `${protocol}//${host}/ws?token=${encodeURIComponent(token)}`;
}

/**
 * Live channel message updates over WebSocket.
 * onEvent receives { type, channelId, message?, messageId?, seenCount?, read? }
 */
export function connectChannelSocket(channelId, onEvent) {
  const token = localStorage.getItem("admin_token");
  const roomId = Number(channelId);
  if (!token || !Number.isFinite(roomId) || roomId <= 0) {
    return () => {};
  }

  let socket = null;
  let closed = false;
  let retryMs = 1000;
  let retryTimer = null;
  let pingTimer = null;
  let subscribed = false;

  function clearTimers() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function scheduleReconnect() {
    if (closed) return;
    clearTimers();
    subscribed = false;
    retryTimer = setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 1.7, 12000);
  }

  function subscribe() {
    if (!socket || socket.readyState !== WebSocket.OPEN || subscribed) return;
    socket.send(JSON.stringify({ type: "subscribe", channelId: roomId }));
  }

  function connect() {
    if (closed) return;
    clearTimers();
    subscribed = false;

    try {
      socket = new WebSocket(wsUrl(token));
    } catch {
      scheduleReconnect();
      return;
    }

    socket.addEventListener("open", () => {
      retryMs = 1000;
      // Token is in the query string; server may reply "ready" first
      subscribe();
      pingTimer = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping" }));
        }
      }, 25000);
    });

    socket.addEventListener("message", (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      if (payload.type === "ready" || payload.type === "auth_required") {
        if (payload.type === "auth_required") {
          socket.send(JSON.stringify({ type: "auth", token }));
        }
        subscribe();
        return;
      }

      if (payload.type === "subscribed") {
        subscribed = Number(payload.channelId) === roomId;
        return;
      }

      if (
        payload.type === "message.created" ||
        payload.type === "message.updated" ||
        payload.type === "message.deleted" ||
        payload.type === "message.seen"
      ) {
        // Normalize ids so string/number mismatches don't drop events
        if (payload.message?.id != null) {
          payload.message = {
            ...payload.message,
            id: Number(payload.message.id),
          };
        }
        if (payload.messageId != null) {
          payload.messageId = Number(payload.messageId);
        }
        if (payload.channelId != null) {
          payload.channelId = Number(payload.channelId);
        }
        if (payload.channelId && payload.channelId !== roomId) return;
        onEvent?.(payload);
      }
    });

    socket.addEventListener("close", () => {
      clearTimers();
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      // close handler will reconnect
    });
  }

  connect();

  return () => {
    closed = true;
    clearTimers();
    try {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "unsubscribe",
            channelId: roomId,
          })
        );
      }
      socket?.close();
    } catch {
      /* ignore */
    }
  };
}

/**
 * Subscribe to many channels (e.g. channels list unread badges).
 * onEvent receives the same payloads as connectChannelSocket.
 */
export function connectChannelsSocket(channelIds, onEvent) {
  const token = localStorage.getItem("admin_token");
  const rooms = [
    ...new Set(
      (channelIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
  if (!token || !rooms.length) {
    return () => {};
  }

  let socket = null;
  let closed = false;
  let retryMs = 1000;
  let retryTimer = null;
  let pingTimer = null;
  const subscribed = new Set();

  function clearTimers() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function scheduleReconnect() {
    if (closed) return;
    clearTimers();
    subscribed.clear();
    retryTimer = setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 1.7, 12000);
  }

  function subscribeAll() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    for (const channelId of rooms) {
      if (subscribed.has(channelId)) continue;
      socket.send(JSON.stringify({ type: "subscribe", channelId }));
    }
  }

  function connect() {
    if (closed) return;
    clearTimers();
    subscribed.clear();

    try {
      socket = new WebSocket(wsUrl(token));
    } catch {
      scheduleReconnect();
      return;
    }

    socket.addEventListener("open", () => {
      retryMs = 1000;
      subscribeAll();
      pingTimer = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping" }));
        }
      }, 25000);
    });

    socket.addEventListener("message", (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      if (payload.type === "ready" || payload.type === "auth_required") {
        if (payload.type === "auth_required") {
          socket.send(JSON.stringify({ type: "auth", token }));
        }
        subscribeAll();
        return;
      }

      if (payload.type === "subscribed") {
        const id = Number(payload.channelId);
        if (rooms.includes(id)) subscribed.add(id);
        return;
      }

      if (
        payload.type === "message.created" ||
        payload.type === "message.updated" ||
        payload.type === "message.deleted" ||
        payload.type === "message.seen"
      ) {
        if (payload.message?.id != null) {
          payload.message = {
            ...payload.message,
            id: Number(payload.message.id),
          };
        }
        if (payload.messageId != null) {
          payload.messageId = Number(payload.messageId);
        }
        if (payload.channelId != null) {
          payload.channelId = Number(payload.channelId);
        }
        if (payload.channelId && !rooms.includes(payload.channelId)) return;
        onEvent?.(payload);
      }
    });

    socket.addEventListener("close", () => {
      clearTimers();
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {});
  }

  connect();

  return () => {
    closed = true;
    clearTimers();
    try {
      if (socket?.readyState === WebSocket.OPEN) {
        for (const channelId of rooms) {
          socket.send(JSON.stringify({ type: "unsubscribe", channelId }));
        }
      }
      socket?.close();
    } catch {
      /* ignore */
    }
  };
}
