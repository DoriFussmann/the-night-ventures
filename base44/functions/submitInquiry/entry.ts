import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { name, email, message } = body;

    if (!name || !email || !message) {
      return Response.json({ error: "Missing fields" }, { status: 400 });
    }

    await base44.asServiceRole.entities.Inquiry.create({
      name,
      email,
      message,
      status: "new"
    });

    await base44.asServiceRole.integrations.Core.SendEmail({
      to: "dori@thenightventures.com",
      subject: `New inquiry from ${name}`,
      body: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`
    });

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});