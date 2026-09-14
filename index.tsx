import React from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { App } from "./App";
import { registerServiceWorker } from "./helpers/registerServiceWorker";
import { initNativeShell } from "./helpers/native";

void initNativeShell();
registerServiceWorker();

const container = document.getElementById("root") as HTMLDivElement;
createRoot(container).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>,
);
    