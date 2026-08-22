import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { createTauriRepositoryService } from "./services/tauriRepository";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("gitinspect root element is missing");
}

const repositoryService = createTauriRepositoryService();

createRoot(root).render(
  <StrictMode>
    <App
      {...(repositoryService ? { repositoryService } : {})}
      autoOpenDemo={repositoryService === undefined}
    />
  </StrictMode>,
);
