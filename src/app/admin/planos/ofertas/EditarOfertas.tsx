"use client";

import { useState } from "react";
import { CAMPO } from "@/components/ui/Pagina";
import { personaPorId } from "@/lib/planos";
import type { OfertaPerfil } from "@/lib/ofertas-perfis";

const linhas = (s: string) => s.split("\n").map((t) => t.trim()).filter(Boolean);
const dinheiro = (v: string) => v === "" ? null : Math.round(Number(v.replace(",", ".")) * 100);
const moedaCampo = (v: number | null) => v === null ? "" : (v / 100).toFixed(2);

function Formulario({ oferta, podeEditar }: { oferta: OfertaPerfil; podeEditar: boolean }) {
  const [revisao, setRevisao] = useState(oferta.revisao);
  const [estado, setEstado] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function salvar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    const ler = (chave: string) => String(dados.get(chave) ?? "").trim();
    setEnviando(true); setEstado("");
    try {
      const r = await fetch("/api/admin/planos/ofertas", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: oferta.id, revisao, nome: ler("nome"), descricao: ler("descricao"),
          preco_centavos: dinheiro(ler("preco")), anual_centavos: dinheiro(ler("anual")), prazo_dias: ler("prazo") ? Number(ler("prazo")) : null,
          limites: linhas(ler("limites")), detalhes: linhas(ler("detalhes")), ativo: dados.has("ativo") }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Falha ao salvar.");
      setRevisao(d.revisao); setEstado("Alterações salvas.");
    } catch (erro) { setEstado(erro instanceof Error ? erro.message : "Falha de conexão."); }
    finally { setEnviando(false); }
  }
  return <details className="cartao p-4"><summary className="cursor-pointer font-semibold">{oferta.nome}</summary>
    <form onSubmit={salvar}>
      <fieldset disabled={!podeEditar || enviando} className="mt-4 grid gap-4 md:grid-cols-2">
        <label>Nome<input name="nome" required maxLength={100} className={CAMPO} defaultValue={oferta.nome} /></label>
        <label>Preço em reais ({oferta.ciclo})<input name="preco" type="number" min="0" step=".01" className={CAMPO} defaultValue={moedaCampo(oferta.preco_centavos)} /></label>
        <label>Preço anual em reais<input name="anual" type="number" min="0" step=".01" className={CAMPO} defaultValue={moedaCampo(oferta.anual_centavos)} /></label>
        <label>Prazo em dias<input name="prazo" type="number" min="1" step="1" className={CAMPO} defaultValue={oferta.prazo_dias ?? ""} /></label>
        <label className="md:col-span-2">Descrição<input name="descricao" required maxLength={600} className={CAMPO} defaultValue={oferta.descricao} /></label>
        <label>Limites, um por linha<textarea name="limites" rows={4} className={CAMPO} defaultValue={oferta.limites.join("\n")} /></label>
        <label>Detalhes, um por linha<textarea name="detalhes" rows={4} className={CAMPO} defaultValue={oferta.detalhes.join("\n")} /></label>
        <label className="flex items-center gap-2"><input name="ativo" type="checkbox" defaultChecked={oferta.ativo} /> Exibir na página do perfil</label>
        {podeEditar && <button type="submit" className="lp-btn lp-btn-verde justify-self-start">{enviando ? "Salvando…" : "Salvar oferta"}</button>}
      </fieldset>
      {estado && <p className="mt-3" role="status">{estado}</p>}
    </form>
  </details>;
}

export default function EditarOfertas({ ofertas, podeEditar }: { ofertas: OfertaPerfil[]; podeEditar: boolean }) {
  const perfis = [...new Set(ofertas.map((o) => o.perfil))];
  const [perfil, setPerfil] = useState(perfis[0] || "");
  return <section className="space-y-3">
    <label className="block max-w-md">Perfil<select className={CAMPO} value={perfil} onChange={(e) => setPerfil(e.target.value)}>
      {perfis.map((p) => <option key={p} value={p}>{personaPorId(p)?.nome}</option>)}</select></label>
    {ofertas.filter((o) => o.perfil === perfil).map((oferta) => <Formulario key={oferta.id} oferta={oferta} podeEditar={podeEditar} />)}
  </section>;
}
