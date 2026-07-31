import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.end()
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    const message = typeof body.message === 'string' ? body.message.trim() : ''

    if (!name || !email || !message) {
      return json(res, 400, { error: 'Name, email, and message are required' })
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const resendKey = process.env.RESEND_API_KEY
    const toEmail = process.env.INQUIRY_TO_EMAIL || 'dori@thenightventures.com'

    if (!supabaseUrl || !serviceKey) {
      console.error('Missing Supabase server env')
      return json(res, 500, { error: 'Server configuration error' })
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { error: insertError } = await supabase.from('inquiries').insert({
      name,
      email,
      message,
      status: 'new',
    })

    if (insertError) {
      console.error('Inquiry insert failed:', insertError)
      return json(res, 500, { error: 'Failed to save inquiry' })
    }

    if (resendKey) {
      const resend = new Resend(resendKey)
      const { error: emailError } = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'The Night Ventures <onboarding@resend.dev>',
        to: [toEmail],
        replyTo: email,
        subject: `New inquiry from ${name}`,
        text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
      })
      if (emailError) {
        console.error('Resend failed:', emailError)
        // Inquiry already saved; still return ok
      }
    } else {
      console.warn('RESEND_API_KEY not set; inquiry saved without email')
    }

    return json(res, 200, { ok: true })
  } catch (err) {
    console.error('submit-inquiry error:', err)
    return json(res, 500, { error: 'Unexpected server error' })
  }
}
