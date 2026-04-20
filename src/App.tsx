import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { ScrollToTop } from "@/components/ScrollToTop";
import { ScrollProgress } from "@/components/ScrollProgress";
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
const InventoryProof = lazy(() => import("./pages/InventoryProof"));
const Hoku = lazy(() => import("./pages/Hoku"));
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
const Services = lazy(() => import("./pages/Services"));
const AppleModernization = lazy(() => import("./pages/AppleModernization"));
const MarketplaceSetup = lazy(() => import("./pages/MarketplaceSetup"));
const TeslaRentals = lazy(() => import("./pages/TeslaRentals"));
const CookieYetiSupport = lazy(() => import("./pages/CookieYetiSupport"));
const ConfeshPrivacy = lazy(() => import("./pages/ConfeshPrivacy"));
const ConfeshSupport = lazy(() => import("./pages/ConfeshSupport"));
const Links = lazy(() => import("./pages/Links"));
const EmailUnsubscribe = lazy(() => import("./pages/EmailUnsubscribe"));

// Lazy admin pages. AdminRoute/AdminLayout stay eager (they're tiny wrappers
// and keeping them eager avoids a double-load chain on /admin). The big win
// is that none of the admin page bodies (recharts, dashboards, etc.) ship to
// anonymous visitors.
import { AdminRoute } from "@/components/admin/AdminRoute";
import { AdminLayout } from "@/components/admin/AdminLayout";
const AdminLogin = lazy(() => import("./pages/admin/AdminLogin"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminSubmissions = lazy(() => import("./pages/admin/AdminSubmissions"));
const AdminSubmissionDetail = lazy(() => import("./pages/admin/AdminSubmissionDetail"));
const AdminSetupGuide = lazy(() => import("./pages/admin/AdminSetupGuide"));
const CYDashboard = lazy(() => import("./pages/admin/CYDashboard"));
const CYSubscribers = lazy(() => import("./pages/admin/CYSubscribers"));
const CYGrantedAccess = lazy(() => import("./pages/admin/CYGrantedAccess"));
const CommunityLearning = lazy(() => import("./pages/admin/CommunityLearning"));
const AdminContacts = lazy(() => import("./pages/admin/AdminContacts"));
const AdminHireRequests = lazy(() => import("./pages/admin/AdminHireRequests"));
const AdminWaitlist = lazy(() => import("./pages/admin/AdminWaitlist"));
const HomeHubOverview = lazy(() => import("./pages/admin/HomeHubOverview"));
const HomeHubPihole = lazy(() => import("./pages/admin/HomeHubPihole"));
const HomeHubHomeAssistant = lazy(() => import("./pages/admin/HomeHubHomeAssistant"));
const HomeHubHomebridge = lazy(() => import("./pages/admin/HomeHubHomebridge"));

const queryClient = new QueryClient();

const App = () => (
  <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <ScrollToTop />
          <ScrollProgress />
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
                  <Route path="/confesh/privacy" element={<ConfeshPrivacy />} />
                  <Route path="/confesh/support" element={<ConfeshSupport />} />
                  <Route path="/inventory-proof" element={<InventoryProof />} />
                  <Route path="/hoku" element={<Hoku />} />
                  <Route path="/neckpilot" element={<NeckPilot />} />
                  <Route path="/press" element={<PressKit />} />
                  <Route path="/privacy-policy" element={<PrivacyPolicy />} />
                  <Route path="/privacy" element={<CookieYetiPrivacy />} />
                  <Route path="/terms-of-service" element={<TermsOfService />} />
                  <Route path="/terms-of-use" element={<TermsOfUse />} />
                  <Route path="/developer-compliance" element={<DeveloperCompliance />} />
                  <Route path="/contact" element={<Contact />} />
                  <Route path="/product/:productId/legal" element={<ProductLegal />} />
                  <Route path="/report-site" element={<ReportSite />} />
                  <Route path="/hire" element={<Hire />} />
                  <Route path="/services" element={<Services />} />
                  <Route path="/apple-modernization" element={<AppleModernization />} />
                  <Route path="/marketplace-setup" element={<MarketplaceSetup />} />
                  <Route path="/tesla-rentals" element={<TeslaRentals />} />
                  <Route path="/support" element={<CookieYetiSupport />} />
                </Route>

                {/* Standalone pages (no Header/Footer) */}
                <Route path="/links" element={<Links />} />
                <Route path="/unsubscribe" element={<EmailUnsubscribe />} />

                {/* Admin Routes */}
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
                  <Route index element={<AdminDashboard />} />
                  <Route path="submissions" element={<AdminSubmissions />} />
                  <Route path="submissions/:id" element={<AdminSubmissionDetail />} />
                  <Route path="guide" element={<AdminSetupGuide />} />
                  <Route path="contacts" element={<AdminContacts />} />
                  <Route path="hires" element={<AdminHireRequests />} />
                  <Route path="waitlist" element={<AdminWaitlist />} />
                  <Route path="cookie-yeti" element={<CYDashboard />} />
                  <Route path="cookie-yeti/subscribers" element={<CYSubscribers />} />
                  <Route path="cookie-yeti/granted" element={<CYGrantedAccess />} />
                  <Route path="cookie-yeti/community" element={<CommunityLearning />} />
                  <Route path="home-hub" element={<HomeHubOverview />} />
                  <Route path="home-hub/pihole" element={<HomeHubPihole />} />
                  <Route path="home-hub/ha" element={<HomeHubHomeAssistant />} />
                  <Route path="home-hub/homebridge" element={<HomeHubHomebridge />} />
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

export default App;
