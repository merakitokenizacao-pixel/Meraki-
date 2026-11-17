import { useLayoutEffect, useSyncExternalStore } from "react";
import { SIDEBAR_CHAVE, SIDEBAR_RECOLHIDA } from "./sidebar-recolhida";

let recolhida: boolean | undefined;
const ouvintes = new Set<() => void>();

function lerGuardado() {
  try {
    return localStorage.getItem(SIDEBAR_CHAVE) === SIDEBAR_RECOLHIDA;
  } catch {
    return false;
  }
}

function getSnapshot() {
  recolhida ??= lerGuardado();
  return recolhida;
}

// No servidor (e na hidratação) o menu está aberto; o CSS já mostra o estado certo antes disso.
function getServerSnapshot() {
  return false;
}

function aplicar(valor: boolean) {
  recolhida = valor;
  if (valor) document.documentElement.dataset.sidebar = SIDEBAR_RECOLHIDA;
  else delete document.documentElement.dataset.sidebar;
  ouvintes.forEach((ouvinte) => ouvinte());
}

/** Recolheu ou abriu em outra aba: acompanha. */
function aoGuardar(evento: StorageEvent) {
  if (evento.key === SIDEBAR_CHAVE) aplicar(evento.newValue === SIDEBAR_RECOLHIDA);
}

function subscribe(ouvinte: () => void) {
  if (ouvintes.size === 0) window.addEventListener("storage", aoGuardar);
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
    if (ouvintes.size === 0) window.removeEventListener("storage", aoGuardar);
  };
}

export function useSidebarRecolhida() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function setSidebarRecolhida(valor: boolean) {
  try {
    localStorage.setItem(SIDEBAR_CHAVE, valor ? SIDEBAR_RECOLHIDA : "aberta");
  } catch {
    // Sem localStorage (navegação privada restrita): vale até recarregar a página.
  }
  aplicar(valor);
}

/**
 * Garante o atributo no <html>. Em produção o script do <head> já cuidou disso; em dev, o remount do
 * Strict Mode apaga os atributos do <html> que o React não controla.
 */
export function useSidebarAtributo() {
  useLayoutEffect(() => {
    aplicar(getSnapshot());
  }, []);
}
