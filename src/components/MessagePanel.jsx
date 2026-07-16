import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ChevronDown, Check } from "lucide-react";

export default function MessagePanel() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
    setOpen(false);
    setName("");
    setEmail("");
    setMessage("");
    setTimeout(() => setSubmitted(false), 3000);
  };

  return (
    <div className="w-full mt-6">
      {submitted && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-primary/10 px-4 py-3 text-sm text-primary transition-opacity">
          <Check className="w-4 h-4" />
          Thanks! Your message has been sent.
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          Leave a message
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform duration-300 ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>

        <div
          className={`grid transition-all duration-300 ease-in-out ${
            open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <form onSubmit={handleSubmit} className="space-y-4 border-t border-border p-4">
              <div className="space-y-2">
                <Label htmlFor="msg-name">Name</Label>
                <Input
                  id="msg-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="msg-email">Email</Label>
                <Input
                  id="msg-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="msg-message">Message</Label>
                <Textarea
                  id="msg-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="How can we help?"
                  rows={3}
                  required
                />
              </div>
              <Button type="submit" className="w-full font-medium">
                Submit
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}