'use strict';
/**
 * Cena do Excalidraw guardada como texto (JSON) no `content` de uma nota do tipo 'diagram'. JS puro: usado pela tela
 * Diagramas, pelo cartão em Notes e pelos testes. Nada aqui conhece o Excalidraw além do formato do arquivo (.excalidraw).
 *
 * Regra de ouro: texto que NÃO é uma cena (por exemplo um diagrama antigo em Mermaid) volta como { error, raw } e o
 * editor não grava nada por cima dele.
 */

const SOURCE = 'toni-devkit';

/** Cena em branco: o mesmo formato de um arquivo .excalidraw. */
const emptyScene = () => ({ type: 'excalidraw', version: 2, source: SOURCE, elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} });

/** Texto da nota → { scene } | { error, raw }. Vazio vira cena em branco. */
function parseScene(text) {
  const raw = String(text == null ? '' : text);
  if (!raw.trim()) return { scene: emptyScene() };
  let data;
  try { data = JSON.parse(raw); } catch { return { error: 'O conteúdo não é um desenho do Excalidraw (não é JSON).', raw }; }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.type !== 'excalidraw') {
    return { error: 'O conteúdo não é um desenho do Excalidraw.', raw };
  }
  if (data.elements != null && !Array.isArray(data.elements)) return { error: 'O desenho está corrompido (elements inválido).', raw };
  const base = emptyScene();
  return {
    scene: {
      ...base,
      elements: data.elements || [],
      appState: { ...base.appState, ...(data.appState && typeof data.appState === 'object' ? { viewBackgroundColor: data.appState.viewBackgroundColor || base.appState.viewBackgroundColor } : {}) },
      files: data.files && typeof data.files === 'object' && !Array.isArray(data.files) ? data.files : {},
    },
  };
}

/**
 * Estado do editor → texto da nota. Só elementos vivos; só os arquivos (imagens) que algum elemento ainda usa; do
 * appState só a cor de fundo (zoom, rolagem e seleção mudam o tempo todo e não devem gerar gravação).
 */
function serializeScene(elements, appState, files) {
  const live = (elements || []).filter((e) => e && !e.isDeleted);
  const used = new Set(live.filter((e) => e.type === 'image' && e.fileId).map((e) => e.fileId));
  const keep = {};
  for (const [id, f] of Object.entries(files || {})) if (used.has(id)) keep[id] = f;
  return JSON.stringify({
    type: 'excalidraw', version: 2, source: SOURCE, elements: live,
    appState: { viewBackgroundColor: (appState && appState.viewBackgroundColor) || '#ffffff' }, files: keep,
  });
}

/** Cena sem nenhum elemento vivo. */
const sceneIsEmpty = (scene) => !scene || !(scene.elements || []).some((e) => e && !e.isDeleted);

/** Nome de arquivo seguro a partir do título ("Pedidos: v2?" → "Pedidos v2"); 'diagrama' se sobrar nada. */
function safeFileName(title) {
  const s = String(title || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return s.slice(0, 80) || 'diagrama';
}

module.exports = { emptyScene, parseScene, serializeScene, sceneIsEmpty, safeFileName };
