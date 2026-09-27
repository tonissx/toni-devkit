// Anuncia o uso de uma feature no Event Bus do DevKit (ver electron/events.js).
// Quem emite não sabe quem escuta; falhas nunca atrapalham a feature.
export function emit(name, data) {
  try { window.devkit.events.emit(name, data); } catch { /* sem bus: ignora */ }
}
