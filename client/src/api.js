// client/src/api.js

const API_BASE = ""; 
// Empty string = same origin as server (good for Replit reverse proxy)

export async function apiRequest(path, options = {}) {
  const { method = "GET", token, body } = options;

  const headers = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = `HTTP ${res.status}`;
    try {
      const json = JSON.parse(text);
      if (json.error) message = json.error;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }

  return res.json().catch(() => ({}));
}
