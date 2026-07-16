import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { LanguageProvider } from "./context/language-context";
import { ThemeProvider } from "./context/theme-context";
import "./index.css";

const el = document.getElementById("root");
if (!el) throw new Error("root");

createRoot(el).render(
  <StrictMode>
    <LanguageProvider>
      <ThemeProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </LanguageProvider>
  </StrictMode>,
);
