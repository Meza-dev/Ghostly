import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext.js";
import { Layout } from "./components/Layout.js";
import { LoginPage } from "./pages/LoginPage.js";
import { ClientesPage } from "./pages/ClientesPage.js";
import { PedidosPage } from "./pages/PedidosPage.js";
import { AjustesPage } from "./pages/AjustesPage.js";

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/clientes" element={<ClientesPage />} />
        <Route path="/pedidos" element={<PedidosPage />} />
        <Route path="/ajustes" element={<AjustesPage />} />
        <Route path="/" element={<Navigate to="/clientes" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/clientes" replace />} />
    </Routes>
  );
}
