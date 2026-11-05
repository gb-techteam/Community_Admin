import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import { URL } from "url";
import pool from "../config/db.js";
import { ALL_POWER_KEYS, hasPower, isSuperAdmin } from "../constants/powers.js";
import { getAdminTypeAndPowers } from "../services/portalAdmins.js";

// channelId -> Set<WebSocket>
const channelRooms = new Map();
const superkandleRoom = new Set();

function send(socket, payload) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(payload));
  }
}

function leaveAllRooms(socket) {
  for (const channelId of socket.subscribedChannels || []) {
    const room = channelRooms.get(channelId);
    if (!room) continue;
    room.delete(socket);
    if (!room.size) channelRooms.delete(channelId);
  }
  socket.subscribedChannels = new Set();
  superkandleRoom.delete(socket);
  socket.subscribedSuperkandle = false;
}

function joinRoom(socket, channelId) {
  const id = Number(channelId);
  if (!socket.subscribedChannels) socket.subscribedChannels = new Set();
  socket.subscribedChannels.add(id);

  if (!channelRooms.has(id)) {
    channelRooms.set(id, new Set());
  }
  channelRooms.get(id).add(socket);
}

function leaveRoom(socket, channelId) {
  const id = Number(channelId);
  socket.subscribedChannels?.delete(id);
  const room = channelRooms.get(id);
  if (!room) return;
  room.delete(socket);
  if (!room.size) channelRooms.delete(id);
}

async function resolveAdminFromToken(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET);

  if (payload.role === "super_admin") {
    return {
      role: "super_admin",
      adminId: payload.adminId,
      name: payload.name || "Super Admin",
      portalAdminId: null,
      powers: ALL_POWER_KEYS,
    };
  }

  const current = await getAdminTypeAndPowers(payload.portalAdminId);
  if (!current || !current.is_active) {
    throw new Error("Admin account not found or disabled");
  }

  return {
    role: "portal_admin",
    adminId: current.admin_id,
    name: current.name,
    portalAdminId: current.id,
    powers: current.powers || [],
  };
}

async function canReachChannel(admin, channelId) {
  if (isSuperAdmin(admin) || hasPower(admin, "manage_channels")) return true;

  const portalAdminId = Number(admin?.portalAdminId);
  if (!Number.isFinite(portalAdminId) || portalAdminId <= 0) return false;

  const result = await pool.query(
    `
    SELECT 1
    FROM channel_admins
    WHERE channel_id = $1 AND portal_admin_id = $2
    `,
    [channelId, portalAdminId]
  );

  return Boolean(result.rows[0]);
}

function canUseChannels(admin) {
  return (
    isSuperAdmin(admin) ||
    hasPower(admin, "manage_channels") ||
    hasPower(admin, "message_channels") ||
    hasPower(admin, "view_channel_people")
  );
}

function canUseSuperkandle(admin) {
  return isSuperAdmin(admin) || hasPower(admin, "manage_superkandle");
}

function canUseRealtime(admin) {
  return canUseChannels(admin) || canUseSuperkandle(admin);
}

export function broadcastSuperkandleAccess(member) {
  if (!superkandleRoom.size) return;
  const payload = JSON.stringify({
    type: "superkandle.access",
    member,
  });
  for (const socket of superkandleRoom) {
    if (socket.readyState === 1) socket.send(payload);
  }
}

export function broadcastChannelEvent(channelId, type, data = {}) {
  const room = channelRooms.get(Number(channelId));
  if (!room?.size) return;

  const payload = JSON.stringify({
    type,
    channelId: Number(channelId),
    ...data,
  });

  for (const socket of room) {
    if (socket.readyState === 1) socket.send(payload);
  }
}

export function attachChannelRealtime(server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", async (socket, req) => {
    socket.isAlive = true;
    socket.subscribedChannels = new Set();
    socket.admin = null;

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    try {
      const url = new URL(req.url || "/ws", "http://localhost");
      const token = url.searchParams.get("token");
      if (token) {
        socket.admin = await resolveAdminFromToken(token);
        if (!canUseRealtime(socket.admin)) {
          send(socket, { type: "error", message: "No realtime access" });
          socket.close(1008, "Forbidden");
          return;
        }
        if (canUseSuperkandle(socket.admin)) {
          superkandleRoom.add(socket);
          socket.subscribedSuperkandle = true;
        }
        send(socket, { type: "ready" });
      } else {
        send(socket, {
          type: "auth_required",
          message: "Send { type: 'auth', token } or connect with ?token=",
        });
      }
    } catch {
      send(socket, { type: "error", message: "Invalid or expired token" });
      socket.close(1008, "Unauthorized");
      return;
    }

    socket.on("message", async (raw) => {
      let payload;
      try {
        payload = JSON.parse(String(raw));
      } catch {
        send(socket, { type: "error", message: "Invalid JSON" });
        return;
      }

      try {
        if (payload.type === "auth") {
          socket.admin = await resolveAdminFromToken(payload.token);
          if (!canUseRealtime(socket.admin)) {
            send(socket, { type: "error", message: "No realtime access" });
            socket.close(1008, "Forbidden");
            return;
          }
          if (canUseSuperkandle(socket.admin)) {
            superkandleRoom.add(socket);
            socket.subscribedSuperkandle = true;
          }
          send(socket, { type: "ready" });
          return;
        }

        if (!socket.admin) {
          send(socket, { type: "error", message: "Authenticate first" });
          return;
        }

        if (payload.type === "ping") {
          send(socket, { type: "pong", at: Date.now() });
          return;
        }

        if (payload.type === "subscribe" && payload.topic === "superkandle") {
          if (!canUseSuperkandle(socket.admin)) {
            send(socket, {
              type: "error",
              message: "You do not have SuperKandle access",
            });
            return;
          }
          superkandleRoom.add(socket);
          socket.subscribedSuperkandle = true;
          send(socket, { type: "subscribed", topic: "superkandle" });
          return;
        }

        if (payload.type === "unsubscribe" && payload.topic === "superkandle") {
          superkandleRoom.delete(socket);
          socket.subscribedSuperkandle = false;
          send(socket, { type: "unsubscribed", topic: "superkandle" });
          return;
        }

        if (payload.type === "subscribe") {
          const channelId = Number(payload.channelId);
          if (!Number.isFinite(channelId) || channelId <= 0) {
            send(socket, { type: "error", message: "Invalid channelId" });
            return;
          }

          if (!(await canReachChannel(socket.admin, channelId))) {
            send(socket, {
              type: "error",
              message: "You do not have access to this channel",
            });
            return;
          }

          joinRoom(socket, channelId);
          send(socket, { type: "subscribed", channelId });
          return;
        }

        if (payload.type === "unsubscribe") {
          const channelId = Number(payload.channelId);
          if (Number.isFinite(channelId)) leaveRoom(socket, channelId);
          send(socket, { type: "unsubscribed", channelId });
          return;
        }

        send(socket, { type: "error", message: `Unknown type: ${payload.type}` });
      } catch (error) {
        console.error("WebSocket message error:", error.message);
        send(socket, { type: "error", message: "Realtime request failed" });
      }
    });

    socket.on("close", () => {
      leaveAllRooms(socket);
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, 30000);

  wss.on("close", () => clearInterval(heartbeat));

  console.log("WebSocket ready on /ws");
  return wss;
}
