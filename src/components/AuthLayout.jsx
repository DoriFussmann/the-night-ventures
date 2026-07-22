import React from "react";
import { Users, Briefcase } from "lucide-react";

function BrandingPanel() {
  return (
    <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-[#2c4a6e] px-14 py-12 text-white md:flex">
      {/* 1. Dual radial gradients */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 20% 30%, rgba(120,160,200,0.35), transparent 55%), radial-gradient(ellipse 70% 50% at 85% 80%, rgba(40,70,110,0.55), transparent 50%)",
        }}
      />
      {/* 2. Blueprint grid texture */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.9) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* 3. Content */}
      <div className="relative z-10">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-sans text-lg">N</span>
          </div>
          <span className="text-2xl text-white font-sans tracking-tight">The Night Ventures</span>
        </div>
      </div>

      <div className="relative z-10">
        {/* Hero */}
        <h1 className="text-5xl leading-tight tracking-tight text-white mb-6">
          Sharp Strategy.<br />
          <span className="block mt-2">Built on Hard Data.</span>
        </h1>
        {/* Subcopy */}
        <p className="text-[15px] leading-relaxed text-white/70 max-w-md">
          Advanced financial modeling, research, and strategic consulting for high-stakes business decisions.
        </p>
      </div>

      <div className="relative z-10 flex items-center gap-3 text-white/40 text-[13px]">
        <Users className="w-4 h-4" />
        <span>Clients</span>
        <span className="mx-1">·</span>
        <Briefcase className="w-4 h-4" />
        <span>Projects</span>
      </div>
    </div>
  );
}

function MobileLogo() {
  return (
    <div className="md:hidden flex items-center justify-center gap-2 mb-6">
      <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
        <span className="text-primary-foreground font-sans text-base">N</span>
      </div>
      <span className="text-2xl text-foreground font-sans tracking-tight">The Night Ventures</span>
    </div>
  );
}

export default function AuthLayout({ icon: Icon, title, subtitle, footer, belowCard, children }) {
  return (
    <div className="min-h-screen flex">
      <BrandingPanel />

      <div className="w-full md:w-1/2 flex flex-col items-center justify-center bg-background px-4 py-12">
        <div className="w-full max-w-[420px]">
          <MobileLogo />

          <div className="bg-card rounded-xl border border-border p-6">
            {(Icon || title) && (
              <div className="text-center mb-6">
                {Icon && (
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary mb-4">
                    <Icon className="w-6 h-6 text-primary-foreground" aria-hidden="true" />
                  </div>
                )}
                {title && <h2 className="text-2xl font-medium text-foreground font-display">{title}</h2>}
                {subtitle && <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>}
              </div>
            )}
            {children}
          </div>

          {belowCard}

          {footer && (
            <p className="text-center text-sm text-muted-foreground mt-6">{footer}</p>
          )}

          <p className="text-center text-xs text-muted-foreground/60 mt-8">
            © {new Date().getFullYear()} The Night Ventures. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}