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
import CompanyData from '@/pages/tools/CompanyData';
import SocialMediaTracker from '@/pages/tools/SocialMediaTracker';
import WebsiteBuildTracker from '@/pages/tools/WebsiteBuildTracker';
import BusinessDevTracker from '@/pages/tools/BusinessDevTracker';
import DesignGuideBuilder from '@/pages/tools/DesignGuideBuilder';
import TemplateToPrompt from '@/pages/tools/TemplateToPrompt';
import SiteContentBuild from '@/pages/tools/SiteContentBuild';
import ArticleTopicSuggestion from '@/pages/tools/ArticleTopicSuggestion';
import ArticleGeneration from '@/pages/tools/ArticleGeneration';
import Articles from '@/pages/tools/Articles';
import ClusterImageGenerator from '@/pages/tools/ClusterImageGenerator';
import AiImageGenerator from '@/pages/tools/AiImageGenerator';
import SiteBuildFlow from '@/pages/tools/SiteBuildFlow';
import SiteBuildPrompt from '@/pages/general/SiteBuildPrompt';
import SeoAiAdvisor from '@/pages/tools/SeoAiAdvisor';
import ExternalAuditSnapshot from '@/pages/tools/ExternalAuditSnapshot';

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
          <Route path="/general/site-build-prompt" element={<SiteBuildPrompt />} />
          <Route path="/company/:companyId/company-data" element={<CompanyData />} />
          <Route path="/company/:companyId/social-media-tracker" element={<SocialMediaTracker />} />
          <Route path="/company/:companyId/website-build-tracker" element={<WebsiteBuildTracker />} />
          <Route path="/company/:companyId/business-dev-tracker" element={<BusinessDevTracker />} />
          <Route path="/company/:companyId/design-guide-builder" element={<DesignGuideBuilder />} />
          <Route path="/company/:companyId/template-to-prompt" element={<TemplateToPrompt />} />
          <Route path="/company/:companyId/site-content-build" element={<SiteContentBuild />} />
          <Route path="/company/:companyId/article-topic-suggestion" element={<ArticleTopicSuggestion />} />
          <Route path="/company/:companyId/seo-ai-advisor" element={<SeoAiAdvisor />} />
          <Route path="/company/:companyId/external-audit-snapshot" element={<ExternalAuditSnapshot />} />
          <Route path="/company/:companyId/article-generation" element={<ArticleGeneration />} />
          <Route path="/company/:companyId/articles" element={<Articles />} />
          <Route path="/company/:companyId/cluster-image-generator" element={<ClusterImageGenerator />} />
          <Route path="/company/:companyId/image-generator" element={<AiImageGenerator />} />
          <Route path="/company/:companyId/site-build-flow" element={<SiteBuildFlow />} />
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
