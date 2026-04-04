import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { ScrollToTop } from "@/components/ScrollToTop";
import { ScrollProgress } from "@/components/ScrollProgress";
import { Layout } from "@/components/layout/Layout";
import Index from "./pages/Index";
import About from "./pages/About";
import Products from "./pages/Products";
import CookieYeti from "./pages/CookieYeti";
import CookieYetiPrivacy from "./pages/CookieYetiPrivacy";
import InventoryProof from "./pages/InventoryProof";
import Hoku from "./pages/Hoku";
import NeckPilot from "./pages/NeckPilot";
import PressKit from "./pages/PressKit";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import TermsOfService from "./pages/TermsOfService";
import TermsOfUse from "./pages/TermsOfUse";
import DeveloperCompliance from "./pages/DeveloperCompliance";
import Contact from "./pages/Contact";
import ProductLegal from "./pages/ProductLegal";
import ReportSite from "./pages/ReportSite";
import Hire from "./pages/Hire";
import Services from "./pages/Services";
import AppleModernization from "./pages/AppleModernization";
import MarketplaceSetup from "./pages/MarketplaceSetup";
import TeslaRentals from "./pages/TeslaRentals";
import CookieYetiSupport from "./pages/CookieYetiSupport";
import NotFound from "./pages/NotFound";
import Links from "./pages/Links";
import EmailUnsubscribe from "./pages/EmailUnsubscribe";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { AdminLayout } from "@/components/admin/AdminLayout";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminSubmissions from "./pages/admin/AdminSubmissions";
import AdminSubmissionDetail from "./pages/admin/AdminSubmissionDetail";
import AdminSetupGuide from "./pages/admin/AdminSetupGuide";
import CYDashboard from "./pages/admin/CYDashboard";
import CYSubscribers from "./pages/admin/CYSubscribers";
import CYGrantedAccess from "./pages/admin/CYGrantedAccess";
import CommunityLearning from "./pages/admin/CommunityLearning";
import AdminContacts from "./pages/admin/AdminContacts";
import AdminHireRequests from "./pages/admin/AdminHireRequests";
import AdminWaitlist from "./pages/admin/AdminWaitlist";
import HomeHubOverview from "./pages/admin/HomeHubOverview";
import HomeHubPihole from "./pages/admin/HomeHubPihole";
import HomeHubHomeAssistant from "./pages/admin/HomeHubHomeAssistant";
import HomeHubHomebridge from "./pages/admin/HomeHubHomebridge";

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
          <Routes>
            {/* Public pages with persistent Header/Footer */}
            <Route element={<Layout />}>
              <Route path="/" element={<Index />} />
              <Route path="/about" element={<About />} />
              <Route path="/products" element={<Products />} />
              <Route path="/apps" element={<Products />} />
              <Route path="/cookie-yeti" element={<CookieYeti />} />
              <Route path="/cookie-yeti/privacy" element={<CookieYetiPrivacy />} />
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
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </HelmetProvider>
);

export default App;
