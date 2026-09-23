import { Suspense } from "react";
import { lazyPage } from "@/lib/lazyPage";
import { useAppUpdate } from "@/hooks/useAppUpdate";
import { AppToasts } from "@/components/AppToasts";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { ScrollToTop } from "@/components/ScrollToTop";
import { ScrollProgress } from "@/components/ScrollProgress";
import { CursorFollower } from "@/components/wow/CursorFollower";
import { Layout } from "@/components/layout/Layout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RouteFallback } from "@/components/RouteFallback";

// Eager: home + 404 (small, hit constantly).
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

// Lazy: every other public page. The homepage no longer has to download
// admin code, the intake form, recharts, etc. on first paint.
const About = lazyPage(() => import("./pages/About"));
const Products = lazyPage(() => import("./pages/Products"));
const CookieYeti = lazyPage(() => import("./pages/CookieYeti"));
const CookieYetiPrivacy = lazyPage(() => import("./pages/CookieYetiPrivacy"));
const CookieYetiSuccess = lazyPage(() => import("./pages/CookieYetiSuccess"));
const CookieYetiCancel = lazyPage(() => import("./pages/CookieYetiCancel"));
const CookieYetiGetStarted = lazyPage(() => import("./pages/CookieYetiGetStarted"));
const CookieYetiGetStartedMac = lazyPage(() => import("./pages/CookieYetiGetStartedMac"));
const CookieYetiGetStartedChrome = lazyPage(() => import("./pages/CookieYetiGetStartedChrome"));
const CookieYetiGetStartedRouter = lazyPage(() => import("./pages/CookieYetiGetStartedRouter"));
const InventoryProof = lazyPage(() => import("./pages/InventoryProof"));
const Hoku = lazyPage(() => import("./pages/Hoku"));
const InHouseCloud = lazyPage(() => import("./pages/InHouseCloud"));
const NeckPilot = lazyPage(() => import("./pages/NeckPilot"));
const PressKit = lazyPage(() => import("./pages/PressKit"));
const PrivacyPolicy = lazyPage(() => import("./pages/PrivacyPolicy"));
const TermsOfService = lazyPage(() => import("./pages/TermsOfService"));
const TermsOfUse = lazyPage(() => import("./pages/TermsOfUse"));
const DeveloperCompliance = lazyPage(() => import("./pages/DeveloperCompliance"));
const Contact = lazyPage(() => import("./pages/Contact"));
const ProductLegal = lazyPage(() => import("./pages/ProductLegal"));
const ReportSite = lazyPage(() => import("./pages/ReportSite"));
const Hire = lazyPage(() => import("./pages/Hire"));
const GetStarted = lazyPage(() => import("./pages/GetStarted"));
const Brief = lazyPage(() => import("./pages/Brief"));
const Intake = lazyPage(() => import("./pages/Intake"));
const ShieldReport = lazyPage(() => import("./pages/ShieldReport"));
const ShieldRequest = lazyPage(() => import("./pages/ShieldRequest"));
const Services = lazyPage(() => import("./pages/Services"));
const AppleModernization = lazyPage(() => import("./pages/AppleModernization"));
const MarketplaceSetup = lazyPage(() => import("./pages/MarketplaceSetup"));
const CookieYetiSupport = lazyPage(() => import("./pages/CookieYetiSupport"));
const ConfeshPrivacy = lazyPage(() => import("./pages/ConfeshPrivacy"));
const ConfeshSupport = lazyPage(() => import("./pages/ConfeshSupport"));
const Links = lazyPage(() => import("./pages/Links"));
const LaxGuest = lazyPage(() => import("./pages/LaxGuest"));
const EmailUnsubscribe = lazyPage(() => import("./pages/EmailUnsubscribe"));
const Status = lazyPage(() => import("./pages/Status"));
const VoiceToClaude = lazyPage(() => import("./pages/VoiceToClaude"));
const CookieYetiDashboard = lazyPage(() => import("./pages/CookieYetiDashboard"));

// Lazy admin pages. AdminRoute/AdminLayout stay eager (they're tiny wrappers
// and keeping them eager avoids a double-load chain on /admin). The big win
// is that none of the admin page bodies (recharts, dashboards, etc.) ship to
// anonymous visitors.
import { AdminRoute } from "@/components/admin/AdminRoute";
import { AdminLayout } from "@/components/admin/AdminLayout";
const AdminLogin = lazyPage(() => import("./pages/admin/AdminLogin"));
const AdminApproveLogin = lazyPage(() => import("./pages/admin/AdminApproveLogin"));
const AdminDashboard = lazyPage(() => import("./pages/admin/AdminDashboard"));
const AdminSubmissionDetail = lazyPage(() => import("./pages/admin/AdminSubmissionDetail"));
// Cookie Yeti: three tabbed sections; each lazy-loads only its active tab's page.
const CookieYetiCommandCenter = lazyPage(() => import("./pages/admin/CookieYetiCommandCenter"));
const CookieYetiSubscribers = lazyPage(() => import("./pages/admin/CookieYetiSubscribers"));
const CookieYetiAnalytics = lazyPage(() => import("./pages/admin/CookieYetiAnalytics"));
const AdminContacts = lazyPage(() => import("./pages/admin/AdminContacts"));
const AdminMeetingsSection = lazyPage(() => import("./pages/admin/AdminMeetingsSection"));
const AdminPartners = lazyPage(() => import("./pages/admin/AdminPartners"));
const AdminTuro = lazyPage(() => import("./pages/admin/AdminTuro"));
const LaxPass = lazyPage(() => import("./pages/admin/LaxPass"));
const AdminPlaybook = lazyPage(() => import("./pages/admin/AdminPlaybook"));
const PartnerPortal = lazyPage(() => import("./pages/partner/PartnerPortal"));
const PartnerWelcome = lazyPage(() => import("./pages/partner/PartnerPortal").then((m) => ({ default: m.PartnerWelcome })));
const AdminWaitlist = lazyPage(() => import("./pages/admin/AdminWaitlist"));
const CloudDealDetail = lazyPage(() => import("./pages/admin/CloudDealDetail"));
const CloudDiscoveryBrief = lazyPage(() => import("./pages/admin/CloudDiscoveryBrief"));
const AdminSettings = lazyPage(() => import("./pages/admin/AdminSettings"));
const AdminLeads = lazyPage(() => import("./pages/admin/AdminLeads"));
const HomeHubOverview = lazyPage(() => import("./pages/admin/HomeHubOverview"));
const HomeHubPihole = lazyPage(() => import("./pages/admin/HomeHubPihole"));
const HomeHubHomeAssistant = lazyPage(() => import("./pages/admin/HomeHubHomeAssistant"));
const HomeHubHomebridge = lazyPage(() => import("./pages/admin/HomeHubHomebridge"));
const HomeHubAccess = lazyPage(() => import("./pages/admin/HomeHubAccess"));
const StreetSweeping = lazyPage(() => import("./pages/admin/StreetSweeping"));
const Emergency = lazyPage(() => import("./pages/admin/Emergency"));
const Security = lazyPage(() => import("./pages/admin/Security"));
const AdminSkills = lazyPage(() => import("./pages/admin/AdminSkills"));
const AdminNotFound = lazyPage(() => import("./pages/admin/AdminNotFound"));

/** Redirects an old route to a section tab, carrying over the query string (e.g. ?q= for Granted Access). */
function TabRedirect({ to, tab }: { to: string; tab: string }) {
  const { search, hash } = useLocation();
  const params = new URLSearchParams(search);
  params.set("tab", tab);
  return <Navigate to={`${to}?${params.toString()}${hash}`} replace />;
}

const queryClient = new QueryClient();

const App = () => {
  useAppUpdate();
  return (
  <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <AppToasts />
          <ScrollToTop />
          <ScrollProgress />
          <CursorFollower />
          <ErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                {/* Public pages with persistent Header/Footer */}
                <Route element={<Layout />}>
                  <Route path="/" element={<Index />} />
                  <Route path="/about" element={<About />} />
                  <Route path="/products" element={<Products />} />
                  <Route path="/apps" element={<Products />} />
                  <Route path="/cookie-yeti" element={<CookieYeti />} />
                  <Route path="/cookie-yeti/privacy" element={<CookieYetiPrivacy />} />
                  {/* Scoped Terms alias to match /cookie-yeti/privacy; renders the same page as /terms. */}
                  <Route path="/cookie-yeti/terms" element={<TermsOfUse />} />
                  <Route path="/cookie-yeti/success" element={<CookieYetiSuccess />} />
                  <Route path="/cookie-yeti/cancel" element={<CookieYetiCancel />} />
                  <Route path="/cookie-yeti/get-started" element={<CookieYetiGetStartedRouter />} />
                  <Route path="/cookie-yeti/get-started/ios" element={<CookieYetiGetStarted />} />
                  <Route path="/cookie-yeti/get-started/mac" element={<CookieYetiGetStartedMac />} />
                  <Route path="/cookie-yeti/get-started/chrome" element={<CookieYetiGetStartedChrome />} />
                  <Route path="/confesh/privacy" element={<ConfeshPrivacy />} />
                  <Route path="/confesh/support" element={<ConfeshSupport />} />
                  <Route path="/inventory-proof" element={<InventoryProof />} />
                  <Route path="/hoku" element={<Hoku />} />
                  <Route path="/cloud" element={<InHouseCloud />} />
                  <Route path="/in-house-cloud" element={<InHouseCloud />} />
                  <Route path="/neckpilot" element={<NeckPilot />} />
                  <Route path="/press" element={<PressKit />} />
                  <Route path="/privacy-policy" element={<PrivacyPolicy />} />
                  <Route path="/privacy" element={<CookieYetiPrivacy />} />
                  <Route path="/terms-of-service" element={<TermsOfService />} />
                  <Route path="/terms-of-use" element={<TermsOfUse />} />
                  {/* Alias: the apps link to /terms (Cookie Yeti paywall "Terms of Use"). */}
                  <Route path="/terms" element={<TermsOfUse />} />
                  <Route path="/developer-compliance" element={<DeveloperCompliance />} />
                  <Route path="/contact" element={<Contact />} />
                  <Route path="/product/:productId/legal" element={<ProductLegal />} />
                  <Route path="/report-site" element={<ReportSite />} />
                  <Route path="/hire" element={<Hire />} />
                  <Route path="/get-started" element={<GetStarted />} />
                  <Route path="/brief/:token" element={<Brief />} />
                  <Route path="/intake/:token" element={<Intake />} />
                  <Route path="/shield/report" element={<ShieldReport />} />
                  <Route path="/shield/request/:token" element={<ShieldRequest />} />
                  <Route path="/services" element={<Services />} />
                  <Route path="/apple-modernization" element={<AppleModernization />} />
                  <Route path="/marketplace-setup" element={<MarketplaceSetup />} />
                  <Route path="/support" element={<CookieYetiSupport />} />
                </Route>

                {/* Standalone pages (no Header/Footer) */}
                <Route path="/links" element={<Links />} />
                <Route path="/lax" element={<LaxGuest />} />
                <Route path="/lax/t/:token" element={<LaxGuest />} />
                <Route path="/lax/:slug" element={<LaxGuest />} />
                <Route path="/unsubscribe" element={<EmailUnsubscribe />} />
                <Route path="/status" element={<Status />} />
                <Route path="/voice-to-claude" element={<VoiceToClaude />} />
                <Route path="/cookie-yeti/transparency" element={<CookieYetiDashboard />} />

                {/* Partner portal (Eli): its own sign-in, sees only what RLS allows a partner */}
                <Route path="/partner" element={<PartnerPortal />} />
                <Route path="/partner/welcome" element={<PartnerWelcome />} />

                {/* Admin Routes */}
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/admin/approve" element={<AdminRoute><AdminApproveLogin /></AdminRoute>} />
                <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
                  <Route index element={<AdminDashboard />} />
                  <Route path="leads" element={<AdminLeads />} />
                  <Route path="submissions" element={<TabRedirect to="/admin/leads" tab="marketplace" />} />
                  <Route path="submissions/:id" element={<AdminSubmissionDetail />} />
                  <Route path="settings" element={<AdminSettings />} />
                  <Route path="guide" element={<Navigate to="/admin/settings?tab=guide" replace />} />
                  <Route path="contacts" element={<AdminContacts />} />
                  <Route path="hires" element={<TabRedirect to="/admin/leads" tab="hire" />} />
                  <Route path="waitlist" element={<AdminWaitlist />} />
                  <Route path="meetings" element={<AdminMeetingsSection />} />
                  {/* Clips used to be its own page; keep the link working. */}
                  <Route path="clips" element={<Navigate to="/admin/meetings" replace />} />
                  <Route path="partners" element={<AdminPartners />} />
                  <Route path="cloud" element={<TabRedirect to="/admin/leads" tab="cloud" />} />
                  <Route path="cloud/:id" element={<CloudDealDetail />} />
                  <Route path="cloud/:id/brief-pdf" element={<CloudDiscoveryBrief />} />
                  <Route path="shield-reports" element={<Navigate to="/admin" replace />} />
                  <Route path="cookie-yeti" element={<CookieYetiCommandCenter />} />
                  <Route path="cookie-yeti/subscribers" element={<CookieYetiSubscribers />} />
                  <Route path="cookie-yeti/analytics" element={<CookieYetiAnalytics />} />
                  {/* Old Cookie Yeti pages, now tabs of the three sections. */}
                  <Route path="cookie-yeti/autofix" element={<TabRedirect to="/admin/cookie-yeti" tab="autofix" />} />
                  <Route path="cookie-yeti/domains" element={<TabRedirect to="/admin/cookie-yeti" tab="domains" />} />
                  <Route path="cookie-yeti/granted" element={<TabRedirect to="/admin/cookie-yeti/subscribers" tab="granted" />} />
                  <Route path="cookie-yeti/ops" element={<TabRedirect to="/admin/cookie-yeti/analytics" tab="operations" />} />
                  <Route path="cookie-yeti/community" element={<TabRedirect to="/admin/cookie-yeti/analytics" tab="community" />} />
                  <Route path="home-hub" element={<HomeHubOverview />} />
                  <Route path="home-hub/pihole" element={<HomeHubPihole />} />
                  <Route path="home-hub/home-assistant" element={<HomeHubHomeAssistant />} />
                  <Route path="home-hub/homebridge" element={<HomeHubHomebridge />} />
                  <Route path="home-hub/access" element={<HomeHubAccess />} />
                  <Route path="street-sweeping" element={<StreetSweeping />} />
                  <Route path="emergency" element={<Emergency />} />
                  <Route path="security" element={<Security />} />
                  <Route path="turo" element={<AdminTuro />} />
                  <Route path="turo/lax-pass" element={<LaxPass />} />
                  <Route path="playbook" element={<AdminPlaybook />} />
                  <Route path="skills" element={<AdminSkills />} />
                  <Route path="*" element={<AdminNotFound />} />
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </HelmetProvider>
  );
};

export default App;
