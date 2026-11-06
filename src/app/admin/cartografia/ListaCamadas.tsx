"use client";

import { useCallback, useEffect, useState } from "react";
import CalibrarPlanta from "./CalibrarPlanta";
import { enviarJson, type ErroApi } from "@/lib/api/enviar";
import { AvisoErro } from "@/components/ui/Aviso";
import type { Transform, AjusteLocal, EdicaoGeometria } from "@/lib/geo/deslocar";
import { Etiqueta, Vazio } from "@/components/ui/Pagina";
import { Crosshair, LandPlot, Layers, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

type Camada = {
  id: string; nome: string; municipio: string | null; tipo: string;
  geojson?: string; opacidade: number; datum: string;
  bytes?: number | null;
  zona?: number | string | null;
  layers_ocultos?: string[];
  layers_cad?: { nome: string; linhas: number }[];
  transform?: Transform;
  ajustes?: AjusteLocal[];
  edicoes?: EdicaoGeometria[];
  lotes?: { total: number | null; gerados_em: string | null; defasados: boolean } | null;
  offset: { leste_m: number; norte_m: number };
};

const DATUM_LABEL: Record<string, string> = {
  sirgas: "SIRGAS 2000", sad69: "SAD 69", corrego: "Córrego Alegre",
};
const fmt = (n: number) => n.toLocaleString("pt-BR");

export default function ListaCamadas() {
  const [camadas, setCamadas] = useState<Camada[]>([]);
  const [calibrando, setCalibrando] = useState<Camada | null>(null);
  const [erro, setErro] = useState<ErroApi | null>(null);
  const [carregando, setCarregando] = useState(true);
  const router = useRouter();

  // `fresco=1` + `no-store`: esta lista alimenta a tela de calibração, e ler do
  // cache de 60 s reabria a planta nos valores anteriores ao salvar — o ajuste
  // seguinte gravava o valor velho por cima. Ver src/app/api/geo/cartografia.
  const carregar = useCallback(async () => {
    const r = await fetch("/api/geo/cartografia?fresco=1", { cache: "no-store" }).catch(() => null);
    if (r?.ok) {
      const dados = await r.json();
      setCamadas(
        (dados as Camada[]).map((c) => ({
          ...c,
          offset: { leste_m: c.transform?.offsetLesteM ?? 0, norte_m: c.transform?.offsetNorteM ?? 0 },
        }))
      );
    } else {
      setErro({
        mensagem: "Não consegui listar as camadas publicadas.",
        motivo: r ? `O servidor respondeu ${r.status}.` : "A requisição não chegou ao servidor.",
        solucao: "Recarregue a página. Se repetir, confira se o banco está no ar.",
        codigo: "lista_indisponivel", status: r?.status ?? 0,
      });
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      if (vivo) await carregar();
    })();
    return () => { vivo = false; };
  }, [carregar]);

  const [reencaixe, setReencaixe] = useState<{ id: string; texto: string } | null>(null);
  async function reencaixar(c: Camada) {
    if (!confirm(`Encaixar todos os anúncios de lote de ${c.municipio} nos lotes de "${c.nome}"?\n\nO que casar pela quadra/lote ou pela posição muda de divisa; o resto fica para conferir.`)) return;
    setReencaixe({ id: c.id, texto: "Reencaixando…" });
    const r = await enviarJson<{ ok: number; divergentes: number; sem_mudanca: number; aviso?: string }>(
      `/api/admin/cartografia/${c.id}/reencaixe`, "POST");
    if (!r.ok) { setReencaixe(null); setErro(r.erro); return; }
    const d = r.dados;
    setReencaixe({
      id: c.id,
      texto: d.aviso ?? `${d.ok} reencaixados · ${d.sem_mudanca} já no lugar · ${d.divergentes} para conferir`,
    });
    router.refresh();
  }

  async function remover(c: Camada) {
    if (!confirm(`Remover a camada "${c.nome}" do mapa?`)) return;
    const r = await enviarJson(`/api/admin/cartografia/${c.id}`, "DELETE");
    if (r.ok) { setErro(null); carregar(); } else setErro(r.erro);
  }

  if (carregando) {
    return (
      <p className="cartao flex items-center justify-center gap-2 px-6 py-10 text-base text-texto-2">
        <Loader2 className="size-4" /> Carregando camadas…
      </p>
    );
  }

  if (!camadas.length) {
    return (
      <div className="space-y-3">
        {erro && <AvisoErro erro={erro} aoFechar={() => setErro(null)} />}
        <Vazio icone={Layers} titulo="Nenhuma camada publicada ainda." texto="Publique a primeira planta no formulário acima." />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {erro && <AvisoErro erro={erro} aoFechar={() => setErro(null)} />}

      <div className="cartao divide-y divide-linha">
        {camadas.map((c) => {
          const t = c.transform;
          const desloc = t ? Math.hypot(t.offsetLesteM, t.offsetNorteM) : 0;
          const totalLinhas = (c.layers_cad ?? []).reduce((s, l) => s + l.linhas, 0);
          const ocultas = c.layers_ocultos?.length ?? 0;
          return (
            <div key={c.id} className="px-5 py-4 flex items-center gap-4 flex-wrap transition-colors hover:bg-superficie-2/60">
              <span className="hidden sm:grid size-10 shrink-0 place-items-center rounded-xl bg-verde/12 text-verde">
                <Layers className="size-5" />
              </span>
              <div className="flex-1 min-w-48 space-y-1">
                <p className="font-semibold text-texto">{c.nome}</p>
                <p className="text-sm text-texto-2 tabular-nums">
                  {c.municipio} · {c.tipo === "vector" ? "planta vetorial" : "imagem em tiles"}
                  {c.zona ? ` · ${c.zona === "graus" ? "graus" : `UTM ${c.zona}S`}` : ""}
                  {c.datum && ` · ${DATUM_LABEL[c.datum] ?? c.datum}`}
                  {desloc
                    ? ` · ajuste ${t!.offsetLesteM.toFixed(0)}m L / ${t!.offsetNorteM.toFixed(0)}m N`
                    : " · sem ajuste"}
                  {t && Math.abs(t.rotacaoGraus) > 0.0005 && ` · giro ${t.rotacaoGraus.toFixed(3)}°`}
                  {t && Math.abs(t.escala - 1) > 0.0001 && ` · escala ${(t.escala * 100).toFixed(2)}%`}
                  {(c.ajustes?.length ?? 0) > 0 && ` · ${c.ajustes!.length} parte${c.ajustes!.length === 1 ? "" : "s"} com ajuste próprio`}
                </p>
                {(totalLinhas > 0 || c.bytes) && (
                  <p className="text-sm text-texto-2 tabular-nums">
                    {totalLinhas > 0 && `${fmt(totalLinhas)} linhas em ${c.layers_cad!.length} camadas do CAD`}
                    {ocultas > 0 && ` · ${ocultas} ocultas no mapa`}
                    {c.bytes ? ` · ${(c.bytes / 1048576).toFixed(1)} MB` : ""}
                  </p>
                )}
                {c.tipo === "vector" && (
                  <p className={"text-sm " + (c.lotes?.defasados || c.lotes?.total == null ? "text-alerta" : "text-texto-2")}>
                    {c.lotes?.total == null
                      ? "Lotes clicáveis ainda não gerados — entram na fila do serviço do servidor."
                      : c.lotes.defasados
                        ? `${fmt(c.lotes.total)} lotes clicáveis, gerados antes do último ajuste — serão refeitos pela fila.`
                        : `${fmt(c.lotes.total)} lotes clicáveis, gerados em ${new Date(c.lotes.gerados_em!).toLocaleDateString("pt-BR")}`}
                  </p>
                )}
                {reencaixe?.id === c.id && <p className="text-sm font-semibold text-verde">{reencaixe.texto}</p>}
              </div>
              {/* selo de estado, não botão: sem borda e sem relevo, para não
                  disputar com as duas ações que estão ao lado */}
              <Etiqueta tom="verde" className="select-none">no ar</Etiqueta>
              {c.tipo === "vector" && (
                <button onClick={() => setCalibrando(c)} className="btn-contorno inline-flex items-center gap-1.5 px-3.5 py-2 text-sm">
                  <Crosshair className="size-4" /> Calibrar sobre o satélite
                </button>
              )}
              {c.tipo === "vector" && !!c.lotes?.total && (
                <button onClick={() => reencaixar(c)} disabled={reencaixe?.texto === "Reencaixando…"}
                  title="Para quando esta planta substitui outra: encaixa os anúncios de lote do município nos lotes dela"
                  className="btn-contorno inline-flex items-center gap-1.5 px-3.5 py-2 text-sm disabled:opacity-60">
                  <LandPlot className="size-4" /> Reencaixar anúncios
                </button>
              )}
              <button onClick={() => remover(c)} className="btn-perigo inline-flex items-center gap-1.5 px-3.5 py-2 text-sm">
                <Trash2 className="size-4" /> Remover
              </button>
            </div>
          );
        })}
      </div>

      {calibrando && (
        <CalibrarPlanta camada={calibrando} onFechar={() => { setCalibrando(null); carregar(); }} />
      )}
    </div>
  );
}
