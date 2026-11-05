import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { StoreProvider } from "./store";
import { ToastProvider } from "./components/ui";

if (!(window as any).webkit?.messageHandlers?.atlas) document.body.classList.add("web");
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider><StoreProvider><App /></StoreProvider></ToastProvider>
  </React.StrictMode>,
);
