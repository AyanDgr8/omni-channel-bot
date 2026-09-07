import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/dashboard";
import Calls from "@/pages/calls";
import Bots from "@/pages/bots";
import Config from "@/pages/config";
import Memory from "@/pages/memory";
import FlowEditor from "@/pages/flow-editor";
import EmailAgent from "@/pages/email-agent";
import Messaging from "@/pages/messaging";
import VoiceAgent from "@/pages/voice-agent";
import CalendarPage from "@/pages/calendar";
import LoginPage from "@/pages/login";
import UsersPage from "@/pages/users";
import ProvidersPage from "@/pages/providers";
import ModelCatalogPage from "@/pages/model-catalog";
import CompliancePage from "@/pages/compliance";
import CampaignsPage from "@/pages/campaigns";
import NotFound from "@/pages/not-found";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
    },
  },
});

/** Wraps a page: redirects to /login if not authenticated */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      {/* Public route */}
      <Route path="/login" component={LoginPage} />

      {/* Protected routes — all wrapped in Layout */}
      <Route>
        <ProtectedRoute>
          <Layout>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/calls" component={Calls} />
              <Route path="/bots" component={Bots} />
              <Route path="/config" component={Config} />
              <Route path="/memory" component={Memory} />
              <Route path="/flow" component={FlowEditor} />
              <Route path="/email-agent" component={EmailAgent} />
              <Route path="/messaging" component={Messaging} />
              <Route path="/voice-agent" component={VoiceAgent} />
              <Route path="/calendar" component={CalendarPage} />
              <Route path="/users" component={UsersPage} />
              <Route path="/providers" component={ProvidersPage} />
              <Route path="/model-catalog" component={ModelCatalogPage} />
              <Route path="/compliance" component={CompliancePage} />
              <Route path="/campaigns" component={CampaignsPage} />
              <Route component={NotFound} />
            </Switch>
          </Layout>
        </ProtectedRoute>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
