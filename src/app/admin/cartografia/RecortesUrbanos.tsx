"use client";

import { useEffect, useState, type ComponentProps } from "react";
import DesenhoMapa, { type GeometriaEscolhida } from "@/components/map/DesenhoMapa";
import { enviarJson } from "@/lib/api/enviar";
import type { RecorteUrbano } from "@/lib/map/recortesUrbanos";

type Planta = NonNullable<ComponentProps<typeof DesenhoMapa>["planta"]> & { id: string; nome: string };
export default function RecortesUrbanos({ planta, fechar }: { planta: Planta; fechar: () => void }) {
  const [lista, setLista] = useState<RecorteUrbano[]>([]);
  const [nome, setNome] = useState("");
  const [desenho, setDesenho] = useState<GeometriaEscolhida | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/geo/recortes-urbanos?v=${Date.now()}`, { cache: "no-store", signal: controller.signal })
      .then(r => { if (!r.ok) throw Error(); return r.json(); })
      .then((dados: RecorteUrbano[]) => setLista(dados.filter(r => r.camada === planta.id)))
      .catch(() => { if (!controller.signal.aborted) setAviso("Falha ao consultar os recortes da planta."); });
    return () => controller.abort();
  }, [planta.id, versao]);
  async function editar(id?: string) {
    setOcupado(true);
    const r = await enviarJson(`/api/admin/cartografia/${planta.id}/recortes`, id ? "DELETE" : "POST", id ? { id } : { nome, geometry: desenho?.geometry });
    setOcupado(false);
    if (!r.ok) { setAviso(r.erro.mensagem); return; }
    setNome(""); setDesenho(null); setVersao(v => v + 1);
    setAviso(id ? "Recorte removido. O CAR volta a aparecer nesse perímetro." : "Recorte publicado.");
  }
  return <section className="cartao space-y-4 p-4">
    <div className="flex items-center justify-between gap-3"><h3 className="font-bold">Recortes urbanos · {planta.nome}</h3>
      <button type="button" onClick={fechar} className="btn-contorno px-3 py-1">Fechar</button></div>
    <p>Delimite a área onde a planta urbana tem prioridade. O mapa oculta o CAR dentro do perímetro. A consulta oficial conserva a divisa completa.</p>
    <DesenhoMapa key={versao} planta={planta} recortes={lista.map(r => r.geometry)} onChange={setDesenho} />
    <div className="flex flex-wrap items-end gap-3"><label>Nome do recorte<input className="campo block" maxLength={100} value={nome} onChange={e => setNome(e.target.value)} /></label>
      <button type="button" className="btn-verde px-3 py-2" disabled={ocupado || !nome.trim() || desenho?.geometry.type !== "Polygon"} onClick={() => editar()}>Publicar recorte</button></div>
    {lista.map(r => <div key={r.id} className="flex items-center gap-3"><span>{r.nome}</span><button type="button" className="btn-contorno px-3 py-1"
      disabled={ocupado} onClick={() => { if (confirm(`Restaurar o CAR no recorte “${r.nome}”?`)) void editar(r.id); }}>Restaurar CAR</button></div>)}
    <p role="status">{aviso}</p>
  </section>;
}
