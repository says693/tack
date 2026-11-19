import { createRoot } from 'react-dom/client';

import '@fontsource-variable/geist';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/noto-sans-sc';
import '@fontsource-variable/noto-serif-sc';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';

import '@/styles/base.css';
import '@/styles/screens.css';
import '@/styles/extra.css';

import App from '@/App';
import { isTauri } from '@/lib/bridge';

document.documentElement.dataset.runtime = isTauri ? 'tauri' : 'browser';

const root = document.getElementById('root');
if (!root) throw new Error('Root element is missing.');

createRoot(root).render(<App />);
