import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { ScrollToTop } from "@/components/ScrollToTop";
import { ScrollProgress } from "@/components/ScrollProgress";
import { PageTransition } from "@/components/PageTransition";
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
import DeveloperCompliance from "./pages/DeveloperCompliance";
import Contact from "./pages/Contact";
import ProductLegal from "./pages/ProductLegal";
import ReportSite from "./pages/ReportSite";
import Hire from "./pages/Hire";
import Services from "./pages/Services";
import AppleModernization from "./pages/AppleModernization";
import AmazonSetup from "./pages/AmazonSetup";
import CookieYetiSupport from "./pages/CookieYetiSupport";
import NotFound from "./pages/NotFound";
import { AdminRoute } from "@/components/admin/AdminRoute";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminSubmissions from "./pages/admin/AdminSubmissions";
import AdminSubmissionDetail from "./pages/admin/AdminSubmissionDetail";
import AdminSetupGuide from "./pages/admin/AdminSetupGuide";
import CYDashboard from "./pages/admin/CYDashboard";
import CYSubscribers from "./pages/admin/CYSubscribers";
import CYGrantedAccess from "./pages/admin/CYGrantedAccess";

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
          <PageTransition>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/about" element={<About />} />
              <Route path="/products" element={<Products />} />
              <Route path="/cookie-yeti" element={<CookieYeti />} />
              <Route path="/cookie-yeti/privacy" element={<CookieYetiPrivacy />} />
              <Route path="/inventory-proof" element={<InventoryProof />} />
              <Route path="/hoku" element={<Hoku />} />
              <Route path="/neckpilot" element={<NeckPilot />} />
              <Route path="/press" element={<PressKit />} />
              <Route path="/privacy-policy" element={<PrivacyPolicy />} />
              <Route path="/privacy" element={<CookieYetiPrivacy />} />
              <Route path="/terms-of-service" element={<TermsOfService />} />
              <Route path="/developer-compliance" element={<DeveloperCompliance />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/product/:productId/legal" element={<ProductLegal />} />
              <Route path="/report-site" element={<ReportSite />} />
              <Route path="/hire" element={<Hire />} />
              <Route path="/services" element={<Services />} />
              <Route path="/apple-modernization" element={<AppleModernization />} />
              <Route path="/amazon-setup" element={<AmazonSetup />} />
              <Route path="/support" element={<CookieYetiSupport />} />
              {/* Admin Routes */}
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
              <Route path="/admin/submissions" element={<AdminRoute><AdminSubmissions /></AdminRoute>} />
              <Route path="/admin/submissions/:id" element={<AdminRoute><AdminSubmissionDetail /></AdminRoute>} />
              <Route path="/admin/guide" element={<AdminRoute><AdminSetupGuide /></AdminRoute>} />
              <Route path="/admin/cookie-yeti" element={<AdminRoute><CYDashboard /></AdminRoute>} />
              <Route path="/admin/cookie-yeti/subscribers" element={<AdminRoute><CYSubscribers /></AdminRoute>} />
              <Route path="/admin/cookie-yeti/granted" element={<AdminRoute><CYGrantedAccess /></AdminRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </PageTransition>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </HelmetProvider>
);

export default App;
