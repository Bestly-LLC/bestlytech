import { Link } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import comingSoonAppstore from "@/assets/coming-soon-appstore.jpg";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import cookieYetiIcon from "@/assets/cookieyeti-icon.png";
import {
  Download,
  Settings,
  Globe,
  Shield,
  Zap,
  BarChart3,
  Eye,
  EyeOff,
  Chrome,
  CheckCircle2,
  Clock,
  Infinity,
  Headphones,
  Mail,
  AlertTriangle,
  Activity,
  TrendingUp,
  Database,
  Wifi,
  WifiOff,
} from "lucide-react";

// ============================================
// EDITABLE CONFIGURATION
// ============================================
const CONFIG = {
  version: "1.0.1",
  pricing: {
    free: "Free",
    monthly: "$4.99",
    yearly: "$39.99",
    lifetime: "$149.99",
  },
  platforms: [
    { name: "Chrome", available: false, icon: Chrome },
    { name: "Safari (iOS + macOS)", available: false, icon: Globe },
  ],
  links: {
    chrome: "#",
    safari: "#",
  },
  features: [
    {
      icon: Eye,
      title: "Auto-Detect Banners",
      description: "Automatically identifies cookie consent pop-ups across thousands of websites.",
    },
    {
      icon: Shield,
      title: "Tracking Cookie Cleaning",
      description: "Cleans tracking cookies after dismissing banners. Pro = unlimited, Free = 50 sites/day.",
    },
    {
      icon: EyeOff,
      title: "Background Operation",
      description: "Runs silently without interrupting your browsing experience.",
    },
    {
      icon: BarChart3,
      title: "Activity Stats",
      description: "See how many pop-ups Cookie Yeti has handled for you.",
    },
    {
      icon: Zap,
      title: "Lightweight & Fast",
      description: "Minimal resource usage. Won't slow down your browsing.",
    },
    {
      icon: Globe,
      title: "Cross-Platform Support",
      description: "Available on Chrome and Safari for iOS and macOS. Browse privately on any device.",
    },
  ],
  faqs: [
    {
      question: "Does Cookie Yeti collect my data?",
      answer: "No. Cookie Yeti does not collect, transmit, or store any of your personal data. All settings and statistics are stored locally on your device and never leave your browser.",
    },
    {
      question: "Will this break websites?",
      answer: "Cookie Yeti is designed to handle cookie consent banners without affecting website functionality. In rare cases where a site behaves unexpectedly, you can whitelist it or report the issue to our team.",
    },
    {
      question: "Can I whitelist specific sites?",
      answer: "Yes. Cookie Yeti allows you to exclude specific websites from automatic handling, giving you full control over where it operates.",
    },
    {
      question: "Does it work on mobile?",
      answer: "Yes! Cookie Yeti is available on Safari for iPhone and iPad. Download it from the App Store and enable it in Settings → Safari → Extensions.",
    },
    {
      question: "How much does Cookie Yeti cost?",
      answer: "Cookie Yeti offers a free tier (5 banner handles/day), Monthly at $4.99/mo, Yearly at $39.99/yr (save 33%), and Lifetime at $149.99 one-time. Prices may vary by platform and region.",
    },
    {
      question: "What cookie preferences can I set?",
      answer: "You can configure Cookie Yeti to accept only essential cookies, reject all optional cookies, or accept all cookies. Your preference is applied automatically to every site you visit.",
    },
  ],
  stats: {
    today: 12,
    week: 87,
    allTime: 1234,
  },
};

export default function CookieYeti() {
  return (
    <>
      <SEOHead
        title="Cookie Yeti – Automatic Cookie Consent Handler | Bestly LLC"
        description="Cookie Yeti automatically handles cookie consent pop-ups based on your privacy preferences. No tracking, no data collection. Coming soon to Chrome and App Store."
      />
      
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-secondary/50 to-background">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-32">
          <div className="text-center max-w-3xl mx-auto">
            <AnimatedSection>
              <div className="flex justify-center mb-8">
                <div className="relative">
                  <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 overflow-hidden">
                    <img src={cookieYetiIcon} alt="Cookie Yeti" className="h-16 w-16 object-contain" />
                  </div>
                  <Badge className="absolute -top-2 -right-2 bg-primary text-primary-foreground">
                    v{CONFIG.version}
                  </Badge>
                </div>
              </div>
            </AnimatedSection>
            
            <AnimatedSection delay={80}>
              <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
                Cookie Yeti
              </h1>
              <p className="mt-4 text-xl text-primary font-medium">
                Distraction-Free Browsing, Automatically
              </p>
            </AnimatedSection>

            <AnimatedSection delay={160}>
              <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
                Automatically handles cookie consent pop-ups and cleans tracking cookies from sites you visit. 
                5 banner handles per day free, unlimited with Pro. No data collection. Just peaceful browsing.
              </p>
            </AnimatedSection>
            
            <AnimatedSection delay={240}>
              <div className="mt-8">
                <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 text-sm px-4 py-1">
                  Coming Soon
                </Badge>
              </div>
              
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-6">
                <img
                  src={comingSoonAppstore}
                  alt="Coming Soon to App Store and Android"
                  className="h-auto w-64 rounded-xl shadow-md"
                />
                <div className="flex items-center gap-3 px-6 py-4 rounded-xl border border-border bg-card shadow-sm">
                  <Chrome className="h-8 w-8 text-muted-foreground" />
                  <div className="text-left">
                    <p className="text-sm font-semibold text-foreground">Chrome Desktop</p>
                    <p className="text-xs text-muted-foreground">Coming Soon</p>
                  </div>
                </div>
              </div>
              
              <p className="mt-6 text-sm text-muted-foreground">
                Coming soon to Chrome and App Store
              </p>
            </AnimatedSection>
            
            <AnimatedSection delay={320}>
              <div className="mt-6">
                <Link 
                  to="/privacy" 
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
                >
                  View Privacy Policy
                </Link>
              </div>
              
              <div className="mt-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Shield className="h-4 w-4" />
                <span>100% Privacy-First • No Data Collection • No Tracking</span>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 lg:py-24 border-t border-border">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <AnimatedSection>
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                How It Works
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Three simple steps to distraction-free browsing
              </p>
            </div>
          </AnimatedSection>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-12">
            {[
              {
                step: 1,
                icon: Download,
                title: "Install Cookie Yeti",
                description: "Add Cookie Yeti to your browser from the official store. Takes less than 10 seconds.",
              },
              {
                step: 2,
                icon: Settings,
                title: "Set Your Preferences",
                description: "Choose how you want cookie consent handled: essential only, reject all, or accept all.",
              },
              {
                step: 3,
                icon: Globe,
                title: "Browse Freely",
                description: "That's it! Cookie Yeti works silently in the background while you enjoy the web.",
              },
            ].map((item, index) => (
              <AnimatedSection key={item.step} delay={index * 100}>
                <div className="relative text-center">
                  <div className="flex justify-center mb-6">
                    <div className="relative">
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary border border-border">
                        <item.icon className="h-7 w-7 text-foreground" />
                      </div>
                      <div className="absolute -top-2 -left-2 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
                        {item.step}
                      </div>
                    </div>
                  </div>
                  <h3 className="text-xl font-semibold text-foreground mb-3">{item.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{item.description}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Key Features */}
      <section className="py-20 lg:py-24 bg-secondary/30 border-t border-border">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <AnimatedSection>
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Key Features
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Everything you need for a cleaner browsing experience
              </p>
            </div>
          </AnimatedSection>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {CONFIG.features.map((feature, index) => (
              <AnimatedSection key={feature.title} delay={index * 80}>
                <div className="rounded-xl border border-border bg-card p-6 transition-all hover:shadow-md">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-secondary mb-4">
                    <feature.icon className="h-6 w-6 text-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Privacy & Trust */}
      <section className="py-20 lg:py-24 border-t border-border">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <AnimatedSection>
              <div className="flex justify-center mb-6">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <Shield className="h-8 w-8 text-primary" />
                </div>
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Built for Privacy
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Cookie Yeti operates entirely on your device. Your privacy preferences never leave your browser.
              </p>
            </AnimatedSection>
            
            <AnimatedSection delay={100}>
              <div className="mt-10 grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                  "No data collection",
                  "No tracking",
                  "No selling or sharing",
                  "No ads",
                  "Free tier available",
                  "All settings stored locally",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                    <span className="text-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </AnimatedSection>
            
            <AnimatedSection delay={200}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button variant="outline" asChild>
                  <Link to="/privacy">View Full Privacy Policy</Link>
                </Button>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-20 lg:py-24 bg-secondary/30 border-t border-border">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <AnimatedSection>
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Simple, Fair Pricing
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Choose the plan that works for you
              </p>
            </div>
          </AnimatedSection>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Free Tier */}
            <AnimatedSection delay={0}>
              <div className="rounded-xl border border-border bg-card p-8">
                <div className="text-center">
                  <h3 className="text-xl font-semibold text-foreground">Free</h3>
                  <div className="mt-4">
                    <span className="text-4xl font-bold text-foreground">{CONFIG.pricing.free}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">5 banner handles per day</p>
                </div>
                <ul className="mt-8 space-y-4">
                  {[
                    { icon: Clock, text: "5 banner handles per day" },
                    { icon: Settings, text: "Basic preferences" },
                    { icon: Globe, text: "Works on popular sites" },
                  ].map((item) => (
                    <li key={item.text} className="flex items-center gap-3">
                      <item.icon className="h-5 w-5 text-muted-foreground shrink-0" />
                      <span className="text-sm text-muted-foreground">{item.text}</span>
                    </li>
                  ))}
                </ul>
                <Button variant="outline" className="w-full mt-8">Get Started Free</Button>
              </div>
            </AnimatedSection>
            
            {/* Monthly Tier */}
            <AnimatedSection delay={100}>
              <div className="rounded-xl border border-border bg-card p-8">
                <div className="text-center">
                  <h3 className="text-xl font-semibold text-foreground">Monthly</h3>
                  <div className="mt-4">
                    <span className="text-4xl font-bold text-foreground">{CONFIG.pricing.monthly}</span>
                    <span className="text-muted-foreground ml-1">/mo</span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">Billed monthly</p>
                </div>
                <ul className="mt-8 space-y-4">
                  {[
                    { icon: Infinity, text: "Unlimited sites" },
                    { icon: Shield, text: "Tracking cookie cleaning" },
                    { icon: Settings, text: "Saved preferences" },
                    { icon: CheckCircle2, text: "Cancel anytime" },
                  ].map((item) => (
                    <li key={item.text} className="flex items-center gap-3">
                      <item.icon className="h-5 w-5 text-primary shrink-0" />
                      <span className="text-sm text-foreground">{item.text}</span>
                    </li>
                  ))}
                </ul>
                <Button variant="outline" className="w-full mt-8">Subscribe Monthly</Button>
              </div>
            </AnimatedSection>
            
            {/* Yearly Tier */}
            <AnimatedSection delay={200}>
              <div className="rounded-xl border-2 border-primary bg-card p-8 relative">
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                  Recommended
                </Badge>
                <div className="text-center">
                  <h3 className="text-xl font-semibold text-foreground">Yearly</h3>
                  <div className="mt-4">
                    <span className="text-4xl font-bold text-foreground">{CONFIG.pricing.yearly}</span>
                    <span className="text-muted-foreground ml-1">/yr</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-primary">Save 33%</p>
                </div>
                <ul className="mt-8 space-y-4">
                  {[
                    { icon: Infinity, text: "Unlimited sites" },
                    { icon: Shield, text: "Tracking cookie cleaning" },
                    { icon: Settings, text: "Saved preferences" },
                    { icon: Headphones, text: "Priority support" },
                  ].map((item) => (
                    <li key={item.text} className="flex items-center gap-3">
                      <item.icon className="h-5 w-5 text-primary shrink-0" />
                      <span className="text-sm text-foreground">{item.text}</span>
                    </li>
                  ))}
                </ul>
                <Button className="w-full mt-8">Subscribe Yearly</Button>
              </div>
            </AnimatedSection>
            
            {/* Lifetime Tier */}
            <AnimatedSection delay={300} className="md:col-span-3 max-w-md mx-auto w-full">
              <div className="rounded-xl border border-border bg-card p-8">
                <div className="text-center">
                  <h3 className="text-xl font-semibold text-foreground">Lifetime</h3>
                  <div className="mt-4">
                    <span className="text-4xl font-bold text-foreground">{CONFIG.pricing.lifetime}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">One-time payment, forever access</p>
                </div>
                <ul className="mt-8 space-y-4">
                  {[
                    { icon: Infinity, text: "Unlimited everything, forever" },
                    { icon: Shield, text: "Tracking cookie cleaning" },
                    { icon: Headphones, text: "Priority support" },
                    { icon: CheckCircle2, text: "All future updates included" },
                  ].map((item) => (
                    <li key={item.text} className="flex items-center gap-3">
                      <item.icon className="h-5 w-5 text-primary shrink-0" />
                      <span className="text-sm text-foreground">{item.text}</span>
                    </li>
                  ))}
                </ul>
                <Button variant="outline" className="w-full mt-8">Buy Lifetime</Button>
              </div>
            </AnimatedSection>
          </div>
          
          <AnimatedSection delay={400}>
            <p className="text-center text-sm text-muted-foreground mt-8">
              * Prices may vary by platform and region.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* Stats Visualization */}
      <section className="py-20 lg:py-24 border-t border-border">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <AnimatedSection>
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Your Browsing, Your Control
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Cookie Yeti shows you exactly how much time you're saving
              </p>
            </div>
          </AnimatedSection>
          
          <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto">
            {[
              { label: "Today", value: CONFIG.stats.today },
              { label: "This Week", value: CONFIG.stats.week },
              { label: "All Time", value: CONFIG.stats.allTime.toLocaleString() },
            ].map((stat, index) => (
              <AnimatedSection key={stat.label} delay={index * 100}>
                <div className="text-center p-6 rounded-xl bg-secondary/50 border border-border">
                  <div className="text-3xl sm:text-4xl font-bold text-foreground">{stat.value}</div>
                  <div className="text-sm text-muted-foreground mt-1">{stat.label}</div>
                </div>
              </AnimatedSection>
            ))}
          </div>
          
          <AnimatedSection delay={300}>
            <p className="text-center text-sm text-muted-foreground mt-6 flex items-center justify-center gap-2">
              <Shield className="h-4 w-4" />
              All stats stored locally on your device
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* Platform Availability */}
      <section className="py-20 lg:py-24 bg-secondary/30 border-t border-border">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <AnimatedSection>
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Coming Soon
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Cookie Yeti will be available on your favorite platforms
              </p>
            </div>
          </AnimatedSection>
          
          <AnimatedSection delay={100}>
            <div className="flex flex-wrap items-center justify-center gap-4">
              {CONFIG.platforms.map((platform) => (
                <div
                  key={platform.name}
                  className="flex items-center gap-3 px-6 py-3 rounded-full border border-border bg-card"
                >
                  <platform.icon className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium text-foreground">{platform.name}</span>
                  <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 text-xs">
                    Coming Soon
                  </Badge>
                </div>
              ))}
            </div>
          </AnimatedSection>
          
          <AnimatedSection delay={200}>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-6">
              <img
                src={comingSoonAppstore}
                alt="Coming Soon to App Store and Android"
                className="h-auto w-64 rounded-xl shadow-md"
              />
              <div className="flex items-center gap-3 px-6 py-4 rounded-xl border border-border bg-card shadow-sm">
                <Chrome className="h-8 w-8 text-muted-foreground" />
                <div className="text-left">
                  <p className="text-sm font-semibold text-foreground">Chrome Desktop</p>
                  <p className="text-xs text-muted-foreground">Coming Soon</p>
                </div>
              </div>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* Support */}
      <section className="py-20 lg:py-24 border-t border-border">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="max-w-2xl mx-auto text-center">
            <AnimatedSection>
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Need Help?
              </h2>
            </AnimatedSection>
            
            <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-6">
              <AnimatedSection delay={80}>
                <div className="p-6 rounded-xl border border-border bg-card">
                  <AlertTriangle className="h-8 w-8 text-foreground mx-auto mb-4" />
                  <h3 className="font-semibold text-foreground mb-2">Report a Site</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Found a website where Cookie Yeti doesn't work correctly?
                  </p>
                  <Button variant="outline" asChild className="w-full">
                    <Link to="/report-site">Report Issue</Link>
                  </Button>
                </div>
              </AnimatedSection>
              
              <AnimatedSection delay={160}>
                <div className="p-6 rounded-xl border border-border bg-card">
                  <Mail className="h-8 w-8 text-foreground mx-auto mb-4" />
                  <h3 className="font-semibold text-foreground mb-2">Contact Support</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Questions, feedback, or need assistance?
                  </p>
                  <Button variant="outline" asChild className="w-full">
                    <a href="mailto:support@bestly.tech">Email Support</a>
                  </Button>
                </div>
              </AnimatedSection>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 lg:py-24 bg-secondary/30 border-t border-border">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <AnimatedSection>
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Frequently Asked Questions
              </h2>
            </div>
          </AnimatedSection>
          
          <AnimatedSection delay={100}>
            <div className="max-w-3xl mx-auto">
              <Accordion type="single" collapsible className="w-full">
                {CONFIG.faqs.map((faq, index) => (
                  <AccordionItem key={index} value={`item-${index}`}>
                    <AccordionTrigger className="text-left text-foreground">
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 lg:py-24 border-t border-border">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto">
            <AnimatedSection>
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Cookie Yeti Is Coming Soon
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                We're putting the finishing touches on Cookie Yeti. Stay tuned for launch on Chrome and the App Store.
              </p>
            </AnimatedSection>
            
            <AnimatedSection delay={100}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-6">
                <img
                  src={comingSoonAppstore}
                  alt="Coming Soon to App Store and Android"
                  className="h-auto w-56 rounded-xl shadow-md"
                />
                <div className="flex items-center gap-3 px-6 py-4 rounded-xl border border-border bg-card shadow-sm">
                  <Chrome className="h-8 w-8 text-muted-foreground" />
                  <div className="text-left">
                    <p className="text-sm font-semibold text-foreground">Chrome Desktop</p>
                    <p className="text-xs text-muted-foreground">Coming Soon</p>
                  </div>
                </div>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>
    </>
  );
}
