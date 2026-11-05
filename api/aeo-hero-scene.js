import { handleHeroScene } from '../lib/aeo/heroScene.js'

export const config = { maxDuration: 60 }

export default function handler(req, res) {
  return handleHeroScene(req, res)
}
