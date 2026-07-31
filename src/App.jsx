import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
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
import SeoSitePrompt from '@/pages/tools/SeoSitePrompt';
import DesignGuideBuilder from '@/pages/tools/DesignGuideBuilder';
import DesignLayerPrompt from '@/pages/tools/DesignLayerPrompt';
import TemplateToPrompt from '@/pages/tools/TemplateToPrompt';
import ArticleTopicSuggestion from '@/pages/tools/ArticleTopicSuggestion';
import ArticleGeneration from '@/pages/tools/ArticleGeneration';

const AuthenticatedApp = () => {
  const { isLoadingAuth } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Companies />} />
          <Route path="/company/:companyId/company-data" element={<CompanyData />} />
          <Route path="/company/:companyId/social-media-tracker" element={<SocialMediaTracker />} />
          <Route path="/company/:companyId/website-build-tracker" element={<WebsiteBuildTracker />} />
          <Route path="/company/:companyId/business-dev-tracker" element={<BusinessDevTracker />} />
          <Route path="/company/:companyId/seo-site-prompt" element={<SeoSitePrompt />} />
          <Route path="/company/:companyId/design-guide-builder" element={<DesignGuideBuilder />} />
          <Route path="/company/:companyId/design-layer-prompt" element={<DesignLayerPrompt />} />
          <Route path="/company/:companyId/template-to-prompt" element={<TemplateToPrompt />} />
          <Route path="/company/:companyId/article-topic-suggestion" element={<ArticleTopicSuggestion />} />
          <Route path="/company/:companyId/article-generation" element={<ArticleGeneration />} />
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
