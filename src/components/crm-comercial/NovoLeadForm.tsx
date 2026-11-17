"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CAMPO, ROTULO } from "@/components/ui/Pagina";
import { enviarJson } from "@/lib/api/enviar";
import { ORIGENS_MANUAIS, TEMPERATURAS, TEMPERATURA_LABEL } from "@/lib/crm-comercial";

type Props = {
  imoveis: { codigo: string; titulo: string }[];
  equipe: { id: string; nome: string }[];
  eu: string;
  codigoInicial?: string;
};

export default function NovoLeadForm({ imoveis, equipe, eu, codigoInicial = "" }: Props) {
  const router = useRouter();
  const [f, setF] = useState({
    codigo_imovel: codigoInicial, nome: "", telefone: "", email: "", mensagem: "", origem: "telefone",
    temperatura: "", etiquetas: "", atribuir: "rodizio",
  });
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const muda = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const imovel = imoveis.find((i) => i.codigo.toUpperCase() === f.codigo_imovel.trim().toUpperCase());

  return (
    <form className="cartao space-y-5 p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setOcupado(true); setErro("");
        const r = await enviarJson<{ id: string }>("/api/admin/crm-comercial/leads", "POST", f);
        setOcupado(false);
        if (!r.ok) { setErro(r.erro.mensagem); return; }
        router.push(`/admin/oportunidades/${r.dados.id}`);
      }}>
      {erro && <p className="rounded-xl border border-critico/30 bg-critico/10 px-4 py-3 text-sm text-critico">{erro}</p>}

      <div>
        <label className={ROTULO} htmlFor="nl-imovel">Imóvel de interesse</label>
        <input id="nl-imovel" list="nl-imoveis" className={CAMPO} value={f.codigo_imovel} onChange={muda("codigo_imovel")}
          placeholder="Digite o código (AIB-000123) ou parte do título" required />
        <datalist id="nl-imoveis">
          {imoveis.map((i) => <option key={i.codigo} value={i.codigo}>{i.titulo}</option>)}
        </datalist>
        <p className="mt-1 text-xs text-texto-2">
          {imovel ? imovel.titulo : "O cliente ainda não escolheu imóvel? Registre em Demandas sem imóvel, que avisa quando um anúncio casar."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={ROTULO} htmlFor="nl-nome">Nome do cliente</label>
          <input id="nl-nome" className={CAMPO} value={f.nome} onChange={muda("nome")} maxLength={180} required />
        </div>
        <div>
          <label className={ROTULO} htmlFor="nl-tel">Telefone / WhatsApp</label>
          <input id="nl-tel" className={CAMPO} value={f.telefone} onChange={muda("telefone")} inputMode="tel" maxLength={40} placeholder="(34) 99999-0000" />
        </div>
        <div>
          <label className={ROTULO} htmlFor="nl-email">E-mail</label>
          <input id="nl-email" type="email" className={CAMPO} value={f.email} onChange={muda("email")} maxLength={254} />
        </div>
        <div>
          <label className={ROTULO} htmlFor="nl-origem">Como chegou</label>
          <select id="nl-origem" className={CAMPO} value={f.origem} onChange={muda("origem")}>
            {ORIGENS_MANUAIS.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
          </select>
        </div>
        <div>
          <label className={ROTULO} htmlFor="nl-temp">Temperatura</label>
          <select id="nl-temp" className={CAMPO} value={f.temperatura} onChange={muda("temperatura")}>
            <option value="">Sem classificar</option>
            {TEMPERATURAS.map((t) => <option key={t} value={t}>{TEMPERATURA_LABEL[t]}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={ROTULO} htmlFor="nl-msg">O que o cliente procura</label>
          <textarea id="nl-msg" className={CAMPO + " min-h-24"} value={f.mensagem} onChange={muda("mensagem")} maxLength={2000} />
        </div>
        <div className="sm:col-span-2">
          <label className={ROTULO} htmlFor="nl-tags">Etiquetas</label>
          <input id="nl-tags" className={CAMPO} value={f.etiquetas} onChange={muda("etiquetas")} placeholder="investidor, pecuária, financiamento" maxLength={400} />
        </div>
        <div className="sm:col-span-2">
          <label className={ROTULO} htmlFor="nl-resp">Quem atende</label>
          <select id="nl-resp" className={CAMPO} value={f.atribuir} onChange={muda("atribuir")}>
            <option value="rodizio">Rodízio de leads (próximo da fila)</option>
            <option value="eu">Eu mesmo</option>
            {equipe.filter((m) => m.id !== eu).map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </div>
      </div>

      <button disabled={ocupado} className="lp-btn lp-btn-verde !px-6 !py-3 disabled:opacity-50">
        {ocupado ? "Gravando…" : "Cadastrar lead"}
      </button>
    </form>
  );
}
