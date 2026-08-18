function getToken() {
  return localStorage.getItem("admin_token");
}

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_user");
    window.location.href = "/";
    throw new Error(data.message || "Unauthorized");
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.message || "Request failed");
  }

  return data;
}

export async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  return parseResponse(response);
}

// Multipart helper — do not set Content-Type; the browser adds the boundary
export async function apiUpload(path, formData, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, {
    method: options.method || "POST",
    ...options,
    headers,
    body: formData,
  });

  return parseResponse(response);
}
