import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles/base.css';
import './styles/home.css';
import './styles/editor.css';
import App from './App';
import { useEditor } from './state/editorStore';
import { useUI } from './state/uiStore';
import { viewport } from './scene/viewportServices';
import { registry } from './scene/registry';
import { useStats } from './state/statsStore';
import { useTools } from './state/toolsStore';

// Handles for automated end-to-end tests and debugging from the console.
(window as unknown as { __workspace: unknown }).__workspace = { editor: useEditor, ui: useUI, tools: useTools, viewport, registry, stats: useStats };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
