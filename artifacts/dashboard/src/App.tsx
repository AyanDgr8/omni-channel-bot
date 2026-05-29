import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/dashboard";
import Calls from "@/pages/calls";
import Bots from "@/pages/bots";
import Config from "@/pages/config";
import Memory from "@/pages/memory";
import Messaging from "@/pages/messaging";
import CalendarPage from "@/pages/calendar";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
    },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/calls" component={Calls} />
        <Route path="/bots" component={Bots} />
        <Route path="/config" component={Config} />
        <Route path="/memory" component={Memory} />
        <Route path="/messaging" component={Messaging} />
        <Route path="/calendar" component={CalendarPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
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
