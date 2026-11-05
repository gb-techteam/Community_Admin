function wsUrl(token) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  return `${protocol}//${host}/ws?token=${encodeURIComponent(token)}`;
}

export function connectSuperkandleSocket(onEvent) {
  const token = localStorage.getItem("admin_token");
  if (!token) return () => {};

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
    socket.send(JSON.stringify({ type: "subscribe", topic: "superkandle" }));
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

      if (payload.type === "subscribed" && payload.topic === "superkandle") {
        subscribed = true;
        return;
      }

      if (payload.type === "superkandle.access") {
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
        socket.send(
          JSON.stringify({ type: "unsubscribe", topic: "superkandle" })
        );
      }
      socket?.close();
    } catch {
      /* ignore */
    }
  };
}
