import crypto from 'node:crypto'

// AES-256-GCM. Stored form: "v1:<iv b64>:<tag b64>:<ciphertext b64>".
// Key: LOGINS_ENCRYPTION_KEY, 32 random bytes in base64 (openssl rand -base64 32).

function key() {
  const raw = process.env.LOGINS_ENCRYPTION_KEY || ''
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) {
    const err = new Error('LOGINS_ENCRYPTION_KEY is missing or not 32 bytes (base64). Add it in Vercel.')
    err.statusCode = 500
    throw err
  }
  return buf
}

export function encrypt(plain) {
  const text = String(plain ?? '')
  if (!text) return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':')
}

export function decrypt(stored) {
  if (!stored) return ''
  const [v, iv, tag, ct] = String(stored).split(':')
  if (v !== 'v1' || !iv || !tag || ct == null) throw new Error('Unreadable stored password')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8')
}
