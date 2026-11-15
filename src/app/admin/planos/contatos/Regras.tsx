"use client";
import { CAMPO_COMPACTO } from "@/components/admin/estilos";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type RegraContato = {
  tipo: string;
  ativo: boolean;
  dias: number[];
  mensagem: string;
  modelo_id: string | null;
};
const nomes: Record<string, string> = {
  recuperacao: "Contratação incompleta",
  renovacao: "Condições da próxima renovação",
  vencimento: "Vencimento mensal",
  lembrete: "Fatura em atraso",
  pagamento: "Pagamento confirmado",
};
const periodos: Record<string, string> = {
  recuperacao: "Dias após liberar a proposta (até duas tentativas)",
  renovacao: "Dias antes da renovação",
  vencimento: "Dias antes do vencimento (até 15)",
  lembrete: "Dias após o vencimento (até três avisos)",
  pagamento: "Dia da confirmação",
};
export default function Regras({ regras }: { regras: RegraContato[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false),
    [aviso, setAviso] = useState("");
  async function salvar(evento: React.FormEvent<HTMLFormElement>, tipo: string) {
    evento.preventDefault();
    const form = new FormData(evento.currentTarget);
    setAviso("");
    setOcupado(true);
    try {
      const r = await fetch("/api/admin/planos/contatos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          ativo: form.has("ativo"),
          mensagem: form.get("mensagem"),
          modelo_id: form.get("modelo"),
          dias: String(form.get("dias"))
            .split(",")
            .map((d) => d.trim()),
        }),
      });
      if (!r.ok) throw Error((await r.json()).error || "Falha ao salvar.");
      setAviso("Regra atualizada.");
      router.refresh();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Falha de conexão.");
    } finally {
      setOcupado(false);
    }
  }
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Regras de contato</h2>
      <p className="text-sm text-texto-2">
        Os textos do painel aceitam {"{nome}, {plano}, {data} e {valor}"}. No WhatsApp, selecione um modelo
        aprovado com dois campos no corpo, nome e link para o pedido.
      </p>
      <details className="cartao p-4">
        <summary className="cursor-pointer font-semibold">Propor novas condições de renovação</summary>
        <form
          className="mt-4 grid max-w-2xl gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setOcupado(true);
            setAviso("");
            try {
              const r = await fetch("/api/planos/contratacao", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  acao: "propor_reajuste",
                  id: f.get("pedido"),
                  data: f.get("vigencia"),
                  valor: Math.round(Number(f.get("valor")) * 100),
                  condicoes: f.get("condicoes"),
                }),
              });
              const j = await r.json();
              if (!r.ok) throw Error(j.error || "Falha ao salvar.");
              setAviso(
                "Proposta registrada. O titular será avisado 30 dias antes da vigência e poderá aceitar em Meus pedidos.",
              );
            } catch (e) {
              setAviso(e instanceof Error ? e.message : "Falha de conexão.");
            } finally {
              setOcupado(false);
            }
          }}
        >
          <label>
            Identificador do pedido contratado
            <input required name="pedido" className={CAMPO_COMPACTO + " mt-1 block w-full"} />
          </label>
          <label>
            Início do ciclo com as novas condições
            <input required name="vigencia" type="date" className={CAMPO_COMPACTO + " mt-1 block w-full"} />
          </label>
          <label>
            Novo valor do plano por ciclo, sem adicionais (R$)
            <input
              required
              name="valor"
              type="number"
              min="0.01"
              max="1000000"
              step="0.01"
              className={CAMPO_COMPACTO + " mt-1 block w-full"}
            />
          </label>
          <label>
            Condições completas da renovação
            <textarea
              required
              name="condicoes"
              minLength={10}
              maxLength={1500}
              className={CAMPO_COMPACTO + " mt-1 block w-full"}
              rows={3}
            />
          </label>
          <button disabled={ocupado} className="btn-verde justify-self-start px-4 py-2">
            Registrar proposta
          </button>
        </form>
      </details>
      {regras.map((r) => (
        <details key={r.tipo} className="cartao p-4">
          <summary className="cursor-pointer font-semibold">
            {nomes[r.tipo]} · {r.ativo ? "Ativa" : "Desativada"}
          </summary>
          <form className="mt-4 grid max-w-2xl gap-3" onSubmit={(e) => salvar(e, r.tipo)}>
            <label>
              <input name="ativo" type="checkbox" defaultChecked={r.ativo} /> Ativar esta regra
            </label>
            <label>
              {periodos[r.tipo]}
              <input
                name="dias"
                required
                defaultValue={r.dias.join(", ")}
                readOnly={["pagamento", "renovacao"].includes(r.tipo)}
                className={CAMPO_COMPACTO + " mt-1 block w-full"}
              />
            </label>
            <label>
              Mensagem no painel
              <textarea
                name="mensagem"
                required
                minLength={5}
                maxLength={700}
                defaultValue={r.mensagem}
                className={CAMPO_COMPACTO + " mt-1 block w-full"}
                rows={3}
              />
            </label>
            <label>
              ID do modelo aprovado no WhatsApp
              <input
                name="modelo"
                inputMode="numeric"
                pattern="[0-9]{1,24}"
                defaultValue={r.modelo_id ?? ""}
                placeholder="Opcional"
                className={CAMPO_COMPACTO + " mt-1 block w-full"}
              />
            </label>
            <button type="submit" disabled={ocupado} className="btn-verde justify-self-start px-4 py-2">
              Salvar regra
            </button>
          </form>
        </details>
      ))}
      <p role="status">{aviso}</p>
    </section>
  );
}
