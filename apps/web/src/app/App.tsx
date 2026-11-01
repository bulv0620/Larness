import { Navigate, Route, Routes } from "react-router";
import { HomeRoute } from "@/features/auth/HomeRoute";
import { LoginPage } from "@/features/auth/LoginPage";
import { PairPage } from "@/features/auth/PairPage";
import { useUnauthorizedRedirect } from "@/features/auth/useAuth";
import { USE_MOCKS } from "@/lib/env";
import { AppShell } from "./AppShell";

function MockRoutes() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AuthRoutes() {
  useUnauthorizedRedirect();

  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/pair" element={<PairPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return USE_MOCKS ? <MockRoutes /> : <AuthRoutes />;
}
