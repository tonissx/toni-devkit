// Entrada do bundle separado renderer/dist/excalidraw.js (+ excalidraw.css), carregado sob demanda por
// src/diagrams/excalidraw.js. Leva o PRÓPRIO React: o Excalidraw roda numa raiz separada, então não depende
// do React global do app. Expõe window.DevkitExcalidraw.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, MainMenu, exportToSvg, exportToBlob, getSceneVersion } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

// Só o que não depende de rede nem leva para fora do Devkit (o resto do menu padrão tem links externos).
const UI_OPTIONS = {
  canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false, changeViewBackgroundColor: true, clearCanvas: true },
};

/**
 * Monta o editor em `el`. initialData: { elements, appState, files }.
 * onChange(elements, appState, files) — dispara a cada movimento; quem chama decide quando gravar (ver sceneVersion).
 * Devolve { api(), unmount() }; api() é o excalidrawAPI (null até o editor ficar pronto).
 */
function mount(el, { initialData, onChange, theme = 'dark' } = {}) {
  const root = createRoot(el);
  let api = null;
  root.render(
    <Excalidraw
      excalidrawAPI={(a) => { api = a; }}
      initialData={initialData}
      onChange={onChange}
      theme={theme}
      langCode="pt-BR"
      UIOptions={UI_OPTIONS}
      renderTopRightUI={() => null}
    >
      <MainMenu>
        <MainMenu.DefaultItems.ClearCanvas />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
        <MainMenu.DefaultItems.Help />
      </MainMenu>
    </Excalidraw>,
  );
  return { api: () => api, unmount: () => root.unmount() };
}

const live = (elements) => elements.filter((e) => !e.isDeleted);

/** SVG da cena (elementos vivos) como string, com fundo. */
async function exportSvg({ elements, appState, files }, { dark = true } = {}) {
  const svg = await exportToSvg({
    elements: live(elements), files: files || {},
    appState: { ...appState, exportBackground: true, exportWithDarkMode: dark, exportEmbedScene: false },
  });
  return new XMLSerializer().serializeToString(svg);
}

/** PNG da cena como Uint8Array (escala 2x). */
async function exportPng({ elements, appState, files }, { dark = true, scale = 2 } = {}) {
  const blob = await exportToBlob({
    mimeType: 'image/png', elements: live(elements), files: files || {},
    appState: { ...appState, exportBackground: true, exportWithDarkMode: dark, exportScale: scale, exportEmbedScene: false },
  });
  return new Uint8Array(await blob.arrayBuffer());
}

window.DevkitExcalidraw = { mount, exportSvg, exportPng, sceneVersion: getSceneVersion };
