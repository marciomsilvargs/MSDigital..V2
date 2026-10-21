import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import RequireAuth from "@/components/require-auth";
import AppShell from "@/components/app-shell";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Companies from "@/pages/companies";
import ConnectionPage from "@/pages/connection";
import Stories from "@/pages/stories";
import Inbox from "@/pages/inbox";
import Comments from "@/pages/comments";
import Automations from "@/pages/automations";
import Reports from "@/pages/reports";
import Assistant from "@/pages/assistant";

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
export default function App() {
  return (
    <>
    <Toaster position="top-right" theme="dark" />
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/companies" element={<Companies />} />
        <Route path="/connection" element={<ConnectionPage />} />
        <Route path="/stories" element={<Stories />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/comments" element={<Comments />} />
        <Route path="/automations" element={<Automations />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/reports" element={<Reports />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}

