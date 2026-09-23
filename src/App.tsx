import { lazy, Suspense } from "react";
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
const About = lazy(() => import("./pages/About"));
const Products = lazy(() => import("./pages/Products"));
const CookieYeti = lazy(() => import("./pages/CookieYeti"));
const CookieYetiPrivacy = lazy(() => import("./pages/CookieYetiPrivacy"));
const CookieYetiSuccess = lazy(() => import("./pages/CookieYetiSuccess"));
const CookieYetiCancel = lazy(() => import("./pages/CookieYetiCancel"));
const CookieYetiGetStarted = lazy(() => import("./pages/CookieYetiGetStarted"));
const CookieYetiGetStartedMac = lazy(() => import("./pages/CookieYetiGetStartedMac"));
const CookieYetiGetStartedChrome = lazy(() => import("./pages/CookieYetiGetStartedChrome"));
const CookieYetiGetStartedRouter = lazy(() => import("./pages/CookieYetiGetStartedRouter"));
const InventoryProof = lazy(() => import("./pages/InventoryProof"));
const Hoku = lazy(() => import("./pages/Hoku"));
const InHouseCloud = lazy(() => import("./pages/InHouseCloud"));
const NeckPilot = lazy(() => import("./pages/NeckPilot"));
const PressKit = lazy(() => import("./pages/PressKit"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const TermsOfUse = lazy(() => import("./pages/TermsOfUse"));
const DeveloperCompliance = lazy(() => import("./pages/DeveloperCompliance"));
const Contact = lazy(() => import("./pages/Contact"));
const ProductLegal = lazy(() => import("./pages/ProductLegal"));
const ReportSite = lazy(() => import("./pages/ReportSite"));
const Hire = lazy(() => import("./pages/Hire"));
const GetStarted = lazy(() => import("./pages/GetStarted"));
const Brief = lazy(() => import("./pages/Brief"));
const Intake = lazy(() => import("./pages/Intake"));
const ShieldReport = lazy(() => import("./pages/ShieldReport"));
const ShieldRequest = lazy(() => import("./pages/ShieldRequest"));
const Services = lazy(() => import("./pages/Services"));
const AppleModernization = lazy(() => import("./pages/AppleModernization"));
const MarketplaceSetup = lazy(() => import("./pages/MarketplaceSetup"));
const CookieYetiSupport = lazy(() => import("./pages/CookieYetiSupport"));
const ConfeshPrivacy = lazy(() => import("./pages/ConfeshPrivacy"));
const ConfeshSupport = lazy(() => import("./pages/ConfeshSupport"));
const Links = lazy(() => import("./pages/Links"));
const EmailUnsubscribe = lazy(() => import("./pages/EmailUnsubscribe"));
const Status = lazy(() => import("./pages/Status"));
const VoiceToClaude = lazy(() => import("./pages/VoiceToClaude"));
const CookieYetiDashboard = lazy(() => import("./pages/CookieYetiDashboard"));

// Lazy admin pages. AdminRoute/AdminLayout stay eager (they're tiny wrappers
// and keeping them eager avoids a double-load chain on /admin). The big win
// is that none of the admin page bodies (recharts, dashboards, etc.) ship to
// anonymous visitors.
import { AdminRoute } from "@/components/admin/AdminRoute";
import { AdminLayout } from "@/components/admin/AdminLayout";
const AdminLogin = lazy(() => import("./pages/admin/AdminLogin"));
const AdminApproveLogin = lazy(() => import("./pages/admin/AdminApproveLogin"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminSubmissionDetail = lazy(() => import("./pages/admin/AdminSubmissionDetail"));
// Cookie Yeti: three tabbed sections; each lazy-loads only its active tab's page.
const CookieYetiCommandCenter = lazy(() => import("./pages/admin/CookieYetiCommandCenter"));
const CookieYetiSubscribers = lazy(() => import("./pages/admin/CookieYetiSubscribers"));
const CookieYetiAnalytics = lazy(() => import("./pages/admin/CookieYetiAnalytics"));
const AdminContacts = lazy(() => import("./pages/admin/AdminContacts"));
const AdminMeetingsSection = lazy(() => import("./pages/admin/AdminMeetingsSection"));
const AdminPartners = lazy(() => import("./pages/admin/AdminPartners"));
const AdminTuro = lazy(() => import("./pages/admin/AdminTuro"));
const AdminPlaybook = lazy(() => import("./pages/admin/AdminPlaybook"));
const PartnerPortal = lazy(() => import("./pages/partner/PartnerPortal"));
const PartnerWelcome = lazy(() => import("./pages/partner/PartnerPortal").then((m) => ({ default: m.PartnerWelcome })));
const AdminWaitlist = lazy(() => import("./pages/admin/AdminWaitlist"));
const CloudDealDetail = lazy(() => import("./pages/admin/CloudDealDetail"));
const CloudDiscoveryBrief = lazy(() => import("./pages/admin/CloudDiscoveryBrief"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings"));
const AdminLeads = lazy(() => import("./pages/admin/AdminLeads"));
const HomeHubOverview = lazy(() => import("./pages/admin/HomeHubOverview"));
const HomeHubPihole = lazy(() => import("./pages/admin/HomeHubPihole"));
const HomeHubHomeAssistant = lazy(() => import("./pages/admin/HomeHubHomeAssistant"));
const HomeHubHomebridge = lazy(() => import("./pages/admin/HomeHubHomebridge"));
const HomeHubAccess = lazy(() => import("./pages/admin/HomeHubAccess"));
const StreetSweeping = lazy(() => import("./pages/admin/StreetSweeping"));
const Emergency = lazy(() => import("./pages/admin/Emergency"));
const Security = lazy(() => import("./pages/admin/Security"));
const AdminSkills = lazy(() => import("./pages/admin/AdminSkills"));
const AdminNotFound = lazy(() => import("./pages/admin/AdminNotFound"));

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
