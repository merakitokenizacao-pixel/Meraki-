/* Menu lateral do desktop: aberto ou recolhido (só os ícones).
   A escolha fica no localStorage. O script abaixo roda no <head>, antes da primeira pintura, e marca o
   <html> com data-sidebar="recolhida"; a variante `recolhida:` (globals.css) lê esse atributo. Assim o
   menu já abre do jeito certo, sem piscar. Sem hooks aqui: o layout raiz (servidor) importa este arquivo. */

export const SIDEBAR_CHAVE = "meraki:sidebar";
export const SIDEBAR_RECOLHIDA = "recolhida";

export const sidebarInitScript = `try{if(localStorage.getItem("${SIDEBAR_CHAVE}")==="${SIDEBAR_RECOLHIDA}")document.documentElement.dataset.sidebar="${SIDEBAR_RECOLHIDA}"}catch(e){}`;

/**
 * Texto que some no menu recolhido: sai rápido e só volta quando a largura já quase abriu.
 * Só a opacidade muda: o nome continua no link, então leitores de tela seguem anunciando cada item.
 */
export const SIDEBAR_SOME =
  "transition-[opacity,visibility] duration-150 delay-100 recolhida:opacity-0 recolhida:delay-0 recolhida:duration-100 motion-reduce:transition-none";
