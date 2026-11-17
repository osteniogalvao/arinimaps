"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";
import { enviarJson } from "@/lib/api/enviar";

type Meta = { atendimentos: number; visitas: number; propostas: number; vendas: number; vgv: number };

/** Meta mensal do corretor (só a Diretoria vê este formulário). */
export default function MetaForm({ userId, mes, atual }: { userId: string; mes: string; atual: Meta | null }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [f, setF] = useState({
    atendimentos: String(atual?.atendimentos ?? ""), visitas: String(atual?.visitas ?? ""), propostas: String(atual?.propostas ?? ""),
    vendas: String(atual?.vendas ?? ""), vgv: atual?.vgv ? String(atual.vgv).replace(".", ",") : "",
  });
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className="mt-3 text-sm font-semibold text-verde hover:underline">
        {atual ? "Alterar meta" : "Meta"}
      </button>
    );
  }
  const campos: [keyof typeof f, string][] = [["atendimentos", "Atendimentos"], ["visitas", "Visitas"], ["propostas", "Propostas"], ["vendas", "Vendas"], ["vgv", "VGV (R$)"]];
  return (
    <form className="mt-4 flex flex-wrap items-end gap-3 border-t border-linha pt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setOcupado(true); setErro("");
        const r = await enviarJson("/api/admin/crm-comercial/metas", "PUT", { user_id: userId, mes, ...f });
        setOcupado(false);
        if (!r.ok) { setErro(r.erro.mensagem); return; }
        setAberto(false);
        router.refresh();
      }}>
      {campos.map(([k, r]) => (
        <label key={k} className="flex flex-col gap-1 text-xs font-semibold text-texto-2">{r}
          <input className={CAMPO_COMPACTO + " w-28"} inputMode={k === "vgv" ? "decimal" : "numeric"} value={f[k]}
            onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} />
        </label>
      ))}
      <button disabled={ocupado} className="lp-btn lp-btn-verde !px-4 !py-2 text-sm disabled:opacity-50">Salvar meta</button>
      <button type="button" onClick={() => setAberto(false)} className="text-sm text-texto-2">Cancelar</button>
      {erro && <p className="w-full text-sm text-critico">{erro}</p>}
    </form>
  );
}
