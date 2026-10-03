export async function jsonRequest(url, {body, apiKey, timeoutMs = 20000} = {}) {
  const response = await fetch(url, {method: body === undefined ? 'GET' : 'POST',
    headers: {'content-type': 'application/json', ...(apiKey ? {authorization: `Bearer ${apiKey}`} : {})},
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs)});
  if (!response.ok) throw new Error(`http_${response.status}`);
  try { return await response.json(); } catch { throw new Error('malformed_response'); }
}
