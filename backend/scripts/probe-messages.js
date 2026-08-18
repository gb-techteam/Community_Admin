import dotenv from "dotenv";

dotenv.config();

const BASE = `http://localhost:${process.env.PORT || 5000}`;

async function call(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, options);
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function main() {
  const login = await call("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      adminId: process.env.SUPER_ADMIN_ID,
      password: process.env.SUPER_ADMIN_PASSWORD,
      client: "portal",
    }),
  });

  if (!login.data.token) {
    console.log("login failed", login.status, login.data);
    return;
  }

  const auth = { Authorization: `Bearer ${login.data.token}` };
  const json = { ...auth, "Content-Type": "application/json" };

  const channels = await call("/api/channels", { headers: auth });
  const channel = channels.data.channels?.[0];
  console.log("channels:", channels.status, channels.data.channels?.length);

  if (!channel) {
    console.log("no channel to test with");
    return;
  }

  console.log("using channel:", channel.id, channel.name);

  const sent = await call(`/api/channels/${channel.id}/messages`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      title: "Probe headline",
      body: "Probe message from scripts/probe-messages.js",
    }),
  });
  console.log("send:", sent.status, sent.data.message?.id);

  const messageId = sent.data.message?.id;

  const list = await call(`/api/channels/${channel.id}/messages`, {
    headers: auth,
  });
  console.log("list:", list.status, "count:", list.data.messages?.length);

  if (messageId) {
    const edited = await call(
      `/api/channels/${channel.id}/messages/${messageId}`,
      {
        method: "PUT",
        headers: json,
        body: JSON.stringify({ title: "", body: "Probe message (edited)" }),
      }
    );
    console.log("edit:", edited.status, edited.data.message?.edited_at);

    const removed = await call(
      `/api/channels/${channel.id}/messages/${messageId}`,
      { method: "DELETE", headers: auth }
    );
    console.log("delete:", removed.status, removed.data.message);
  }
}

main().catch((error) => console.error(error));
