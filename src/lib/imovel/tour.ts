/**
 * Tour virtual 360 / vídeo imersivo do anúncio (item 9 da segunda etapa).
 *
 * O anunciante cola um link do Matterport, Kuula, YouTube ou Vimeo. O link é
 * validado pelo DOMÍNIO (nada de iframe apontando para qualquer site) e
 * guardado em `properties.caracteristicas.tour_virtual_url`. Na ficha pública
 * o embed só é montado quando o visitante clica (iframe preguiçoso).
 *
 * Compartilhado entre o navegador (formulários, ficha) e o servidor (rotas).
 */

export type ProvedorTour = "matterport" | "kuula" | "youtube" | "vimeo";

export const PROVEDOR_TOUR_LABEL: Record<ProvedorTour, string> = {
  matterport: "Matterport", kuula: "Kuula", youtube: "YouTube", vimeo: "Vimeo",
};

export type TourValido = { url: string; provedor: ProvedorTour; embed: string };

const ID_YT = /^[A-Za-z0-9_-]{6,20}$/;

/** Confere o link e devolve o endereço de embed. null = link não aceito. */
export function lerTour(bruto: string | null | undefined): TourValido | null {
  const texto = String(bruto ?? "").trim();
  if (!texto || texto.length > 500) return null;
  let u: URL;
  try { u = new URL(texto); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const url = u.toString().replace(/^http:/, "https:");

  // Matterport: my.matterport.com/show/?m=ID
  if (host === "matterport.com" || host.endsWith(".matterport.com")) {
    const m = u.searchParams.get("m");
    if (!m || !/^[A-Za-z0-9]{6,32}$/.test(m)) return null;
    return { url, provedor: "matterport", embed: `https://my.matterport.com/show/?m=${m}&play=1` };
  }

  // Kuula: kuula.co/share/ID ou kuula.co/share/collection/ID
  if (host === "kuula.co") {
    const p = u.pathname.match(/^\/share\/(collection\/)?([A-Za-z0-9]{3,32})/);
    if (!p) return null;
    return { url, provedor: "kuula", embed: `https://kuula.co/share/${p[1] ?? ""}${p[2]}?fs=1&vr=1&thumbs=1` };
  }

  // YouTube: watch?v=, youtu.be/, shorts/, embed/
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    else if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const p = u.pathname.match(/^\/(shorts|embed|live)\/([^/?#]+)/);
      id = p?.[2] ?? null;
    }
    if (!id || !ID_YT.test(id)) return null;
    return { url, provedor: "youtube", embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0` };
  }

  // Vimeo: vimeo.com/ID ou player.vimeo.com/video/ID
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const p = u.pathname.match(/(?:^\/video\/|^\/)(\d{5,12})(?:\/([0-9a-f]{6,20}))?/);
    if (!p) return null;
    const hash = p[2] ? `&h=${p[2]}` : "";
    return { url, provedor: "vimeo", embed: `https://player.vimeo.com/video/${p[1]}?autoplay=1${hash}` };
  }

  return null;
}

export const TOUR_AJUDA = "Links do Matterport, Kuula, YouTube ou Vimeo.";

/**
 * Normaliza o campo vindo de um formulário: "" vira null (remover o tour);
 * link fora dos domínios aceitos devolve erro.
 */
export function validarCampoTour(bruto: unknown): { ok: true; url: string | null } | { ok: false; erro: string } {
  const t = String(bruto ?? "").trim();
  if (!t) return { ok: true, url: null };
  const tour = lerTour(t);
  if (!tour) return { ok: false, erro: `Link do tour virtual não reconhecido. ${TOUR_AJUDA}` };
  return { ok: true, url: tour.url };
}
