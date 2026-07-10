import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext.js";
import { Toast } from "./Toast.js";
import { BlockingModalOverlay } from "./BlockingModalOverlay.js";

const navItems = [
  { to: "/clientes", label: "Clientes", testId: "nav-clientes" },
  { to: "/pedidos", label: "Pedidos", testId: "nav-pedidos" },
  { to: "/ajustes", label: "Ajustes", testId: "nav-ajustes" },
];

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen bg-gray-100">
      <aside className="flex w-56 flex-col bg-gray-900 text-white">
        <div className="px-4 py-5 text-lg font-bold">Ghostly Playground</div>
        <nav className="flex flex-col gap-1 px-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              data-testid={item.testId}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm ${
                  isActive ? "bg-gray-700 text-white" : "text-gray-300 hover:bg-gray-800"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
          <span className="text-sm text-gray-600">Usuario: {user}</span>
          <button
            type="button"
            data-testid="logout-button"
            onClick={logout}
            className="rounded-md bg-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-300"
          >
            Cerrar sesión
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>

      <Toast />
      <BlockingModalOverlay />
    </div>
  );
}
