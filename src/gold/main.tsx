import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { registerSW } from "./device";
import { applyTheme, loadTheme } from "./theme";
import "./gold.css";

applyTheme(loadTheme());
registerSW();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
