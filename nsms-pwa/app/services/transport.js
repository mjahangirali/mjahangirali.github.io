// ============================================================================
// services/transport.js
// Single place that actually talks to the Apps Script /exec endpoint.
// Kept separate from api.js so sync.js can call it directly during a
// background-sync retry without creating an api.js <-> sync.js import cycle.
// ============================================================================
import { API_BASE_URL } from '../utils/constants.js';

export class ApiError extends Error {
  constructor(message, fn, args, isNetworkError = false) {
    super(message);
    this.name = 'ApiError';
    this.fn = fn;
    this.args = args;
    this.isNetworkError = isNetworkError;
  }
}

// Content-Type is deliberately 'text/plain' — Apps Script Web Apps don't
// implement doOptions(), so any request that would trigger a CORS preflight
// (e.g. Content-Type: application/json) fails outright. text/plain keeps
// this a "simple request" with no preflight; the server still JSON.parse()s
// the body regardless of the declared type. Do not change this to
// 'application/json' without adding a matching doOptions handler server-side.
export async function rawCall(fn, args = [], clientId = null) {
  let res;
  try {
    res = await fetch(API_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn, args, clientId })
    });
  } catch (networkErr) {
    throw new ApiError(networkErr.message || 'Network request failed.', fn, args, true);
  }

  if (!res.ok) {
    throw new ApiError(`HTTP ${res.status} ${res.statusText}`, fn, args, res.status >= 500);
  }

  let data;
  try {
    data = await res.json();
  } catch (parseErr) {
    throw new ApiError('Malformed response from server.', fn, args, false);
  }

  if (data && data.error) {
    // Server-side validation/permission errors are not retryable — surface
    // them immediately rather than routing through the offline queue.
    throw new ApiError(data.msg || data.error, fn, args, false);
  }

  return data;
}
