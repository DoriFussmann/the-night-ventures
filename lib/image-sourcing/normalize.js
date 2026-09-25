import sharp from 'sharp'

export async function normalizeToJpeg(buffer) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  const jpeg = await sharp(input)
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer()
  return jpeg.toString('base64')
}
