import { DS, mod } from '../lib/ds.js';
import { usePersisted } from '../lib/store.js';
import { TOOLS } from '../tools/registry.js';

const { PageHeader, ToolCard, Button } = DS;

export function Home({ go, openPalette }) {
  const [fav, setFav] = usePersisted('favorites', { ids: [] });
  const toggle = (id) => setFav((f) => ({ ids: f.ids.includes(id) ? f.ids.filter((x) => x !== id) : [...f.ids, id] }));
  const sorted = [...TOOLS].sort((a, b) => fav.ids.includes(b.id) - fav.ids.includes(a.id));

  return (
    <div>
      <PageHeader icon="layout-grid" title="Início" subtitle={TOOLS.length + (TOOLS.length === 1 ? ' ferramenta disponível' : ' ferramentas disponíveis')}
        actions={<Button variant="secondary" icon="search" kbd={mod('K')} onClick={openPalette}>Buscar</Button>} />
      <div className="home-section">
        <span className="home-section__title">Ferramentas</span>
        <div className="home-grid">
          {sorted.map((t) => (
            <ToolCard key={t.id} icon={t.icon} name={t.name} description={t.desc} category={t.group}
              shortcut={t.shortcutKey ? mod(t.shortcutKey) : undefined}
              favorite={fav.ids.includes(t.id)} onToggleFavorite={() => toggle(t.id)} onClick={() => go(t.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}
