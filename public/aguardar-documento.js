// Next 16.4.6 instala onload antes de inserir este beforeInteractive.
// Adia somente esse callback até o parser terminar; não intercepta outros
// scripts, não altera React e não esconde erros de hidratação (#37321).
// Precisa ser script clássico: currentScript é null em módulos, e o load de
// um módulo não espera seu top-level await. Revalidar ao atualizar o Next.
(() => {
  const script = document.currentScript;
  if (!script || typeof script.onload !== "function") return;
  const concluir = script.onload;
  script.onload = function (event) {
    if (document.readyState !== "loading") {
      concluir.call(this, event);
      return;
    }
    document.addEventListener("DOMContentLoaded", () => concluir.call(this, event), { once: true });
  };
})();
