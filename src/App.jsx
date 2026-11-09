import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider } from '@/lib/AuthContext';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import AppShell from '@/components/AppShell';
import Companies from '@/pages/Companies';
import GlobalAdmin from '@/pages/GlobalAdmin';
import CompanyData from '@/pages/tools/CompanyData';
import SocialMediaTracker from '@/pages/tools/SocialMediaTracker';
import Articles from '@/pages/tools/Articles';
import AiImageGenerator from '@/pages/tools/AiImageGenerator';
import SiteBuildFlow from '@/pages/tools/SiteBuildFlow';
import ExternalAuditSnapshot from '@/pages/tools/ExternalAuditSnapshot';
import Audit from '@/pages/tools/Audit';
import CoreVersion from '@/pages/tools/CoreVersion';
import Integrations from '@/pages/tools/Integrations';
import Analytics from '@/pages/tools/Analytics';
import AeoPlaybook from '@/pages/tools/AeoPlaybook';
import AeoGeneration from '@/pages/tools/AeoGeneration';

const AuthenticatedApp = () => {
  // Keep public auth routes mounted while session/profile settles.
  // ProtectedRoute already shows a spinner for authenticated pages.
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Companies />} />
          <Route path="/admin" element={<GlobalAdmin />} />
          <Route path="/company/:companyId/company-data" element={<CompanyData />} />
          <Route path="/company/:companyId/aeo-playbook" element={<AeoPlaybook />} />
          <Route path="/company/:companyId/aeo-generation" element={<AeoGeneration />} />
          <Route path="/company/:companyId/social-media-tracker" element={<SocialMediaTracker />} />
          <Route path="/company/:companyId/external-audit-snapshot" element={<ExternalAuditSnapshot />} />
          <Route path="/company/:companyId/audit" element={<Audit />} />
          <Route path="/company/:companyId/articles" element={<Articles />} />
          <Route path="/company/:companyId/analytics" element={<Analytics />} />
          <Route path="/company/:companyId/image-generator" element={<AiImageGenerator />} />
          <Route path="/company/:companyId/site-build-flow" element={<SiteBuildFlow />} />
          <Route path="/company/:companyId/core-version" element={<CoreVersion />} />
          <Route path="/company/:companyId/integrations" element={<Integrations />} />
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <QueryClientProvider client={queryClientInstance}>
      <Router>
        <AuthProvider>
          <ScrollToTop />
          <AuthenticatedApp />
        </AuthProvider>
      </Router>
      <Toaster />
    </QueryClientProvider>
  )
}

export default App
