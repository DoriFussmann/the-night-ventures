import React from "react";
import { Users, Briefcase } from "lucide-react";

function BrandingPanel() {
  return (
    <div className="hidden lg:flex lg:w-1/2 bg-secondary relative overflow-hidden items-center justify-center p-12 xl:p-16">
      {/* Decorative blurred circles */}
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative z-10 max-w-md">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-10">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-sans font-bold text-lg">N</span>
          </div>
          <span className="text-2xl text-white font-sans font-medium tracking-tight">The Night Ventures</span>
        </div>

        {/* Headline */}
        <h1 className="text-4xl xl:text-5xl text-white font-sans font-medium leading-tight tracking-tight mb-6">
          Strategic Clarity.<br />Built on Hard Data.
        </h1>

        {/* Subtitle */}
        <p className="text-white/70 text-lg leading-relaxed mb-10">
          We provide the advanced financial modeling, research, and strategic consulting you need to make high-stakes business decisions with absolute confidence.
        </p>

        {/* Feature cards */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white/10 rounded-xl p-4 flex items-center gap-3">
            <Users className="w-5 h-5 text-white/80" />
            <span className="text-white text-sm font-medium">Clients</span>
          </div>
          <div className="bg-white/10 rounded-xl p-4 flex items-center gap-3">
            <Briefcase className="w-5 h-5 text-white/80" />
            <span className="text-white text-sm font-medium">Projects</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileLogo() {
  return (
    <div className="lg:hidden flex items-center justify-center gap-2 mb-6">
      <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
        <span className="text-primary-foreground font-sans font-bold text-base">N</span>
      </div>
      <span className="text-xl text-foreground font-sans font-medium tracking-tight">The Night Ventures</span>
    </div>
  );
}

export default function AuthLayout({ icon: Icon, title, subtitle, footer, children }) {
  return (
    <div className="min-h-screen flex">
      <BrandingPanel />

      <div className="w-full lg:w-1/2 flex flex-col items-center justify-center bg-background px-4 py-12">
        <div className="w-full max-w-sm">
          <MobileLogo />

          <div className="bg-card rounded-2xl shadow-sm border border-border p-8">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary mb-4">
                <Icon className="w-6 h-6 text-primary-foreground" aria-hidden="true" />
              </div>
              <h2 className="text-2xl font-bold text-foreground font-display">{title}</h2>
              {subtitle && <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>}
            </div>
            {children}
          </div>

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