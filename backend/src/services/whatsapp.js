const GRAPH = "https://graph.facebook.com";

export function whatsappReady() {
  return Boolean(
    String(process.env.WHATSAPP_TOKEN || "").trim() &&
      String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim()
  );
}

export function toWhatsAppNumber(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  const country = String(process.env.WHATSAPP_COUNTRY_CODE || "91").replace(
    /\D/g,
    ""
  );
  // Already stored with country code (e.g. 918281238079 or 9715…)
  if (digits.length >= 11) return digits.replace(/^0+/, "");
  if (digits.length === 10 && country) return `${country}${digits}`;
  if (digits.length === 11 && digits.startsWith("0") && country) {
    return `${country}${digits.slice(1)}`;
  }
  return digits;
}

export async function sendWhatsAppText({ phone, text }) {
  const to = toWhatsAppNumber(phone);
  const body = String(text || "").trim();
  if (!whatsappReady() || !to || !body) {
    return { sent: false, skipped: true };
  }

  const phoneId = String(process.env.WHATSAPP_PHONE_NUMBER_ID).trim();
  const version = String(process.env.WHATSAPP_API_VERSION || "v21.0").trim();
  const response = await fetch(`${GRAPH}/${version}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${String(process.env.WHATSAPP_TOKEN).trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { preview_url: true, body: body.slice(0, 4096) },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload?.error?.message || `WhatsApp send failed (${response.status})`
    );
  }
  return { sent: true, id: payload?.messages?.[0]?.id || "" };
}

export async function sendWhatsAppSafe({ phone, text }) {
  try {
    const result = await sendWhatsAppText({ phone, text });
    if (result.sent) {
      console.log("WhatsApp sent to", toWhatsAppNumber(phone));
    }
    return result;
  } catch (error) {
    console.error("WhatsApp send failed:", error.message);
    return { sent: false, error: error.message };
  }
}
