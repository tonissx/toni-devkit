// Entrada da janela de uma sticky note (renderer/sticky.html?id=<nota> → dist/sticky.js).
import { resolveTheme } from './lib/themes.js';
import { Sticky } from './sticky/Sticky.jsx';

const applyTheme = (pref) => { document.documentElement.dataset.theme = resolveTheme(pref || 'dark'); };
try { applyTheme((JSON.parse(localStorage.getItem('tk.prefs')) || {}).theme); } catch { applyTheme('dark'); }
// Trocou o tema em outra janela: muda aqui na hora.
window.devkit.theme.onChanged(applyTheme);

ReactDOM.createRoot(document.getElementById('root')).render(<Sticky />);
