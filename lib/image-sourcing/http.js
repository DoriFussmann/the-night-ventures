export async function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...opts, signal: controller.signal })
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`Request timed out after ${ms}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
