// Entrada da janela da command palette (renderer/palette.html → dist/palette.js).
import { resolveTheme } from './lib/themes.js';
import { Palette } from './palette/Palette.jsx';

try { document.documentElement.dataset.theme = resolveTheme((JSON.parse(localStorage.getItem('tk.prefs')) || {}).theme || 'dark'); } catch { /* tema padrão */ }

ReactDOM.createRoot(document.getElementById('root')).render(<Palette />);
