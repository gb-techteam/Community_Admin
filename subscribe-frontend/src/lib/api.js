const API_BASE = String(import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

export async function studentApi(path, { token, ...options } = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(
    `${API_BASE}/api/superkandle/subscribe${path}`,
    {
      ...options,
      headers,
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const error = new Error(data.message || "Request failed");
    error.code = data.code;
    error.status = response.status;
    throw error;
  }
  return data;
}
