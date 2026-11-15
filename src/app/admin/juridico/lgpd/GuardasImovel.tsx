"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { enviarJson } from "@/lib/api/enviar";
import { CAMPO } from "@/components/ui/Pagina";
import { urlArquivo } from "@/lib/seguranca/link-arquivo";

export type Guarda = {
  id: string;
  fundamento: string;
  revisar_em: string;
  codigo_imovel: string;
  cofre_id: string | null;
  documentos?: { storage_path: string; nome_arquivo: string }[];
};

export default function GuardasImovel({ guardas }: { guardas: Guarda[] }) {
  const router = useRouter();
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  return (
    <section className="cartao space-y-4 p-5" aria-labelledby="guarda-juridica">
      <h2 id="guarda-juridica" className="lp-display text-xl">
        Preservação de evidências por imóvel
      </h2>
      <p className="text-sm text-texto-2">
        Preserve documentos do anúncio, autorizações e registros de abertura durante uma disputa ou apuração.
        A data orienta a revisão pelo Jurídico. A liberação exige uma decisão registrada.
      </p>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const campos = new FormData(form);
          setOcupado(true);
          setErro("");
          const r = await enviarJson("/api/admin/lgpd", "POST", {
            acao: "guarda",
            ...Object.fromEntries(campos),
          });
          setOcupado(false);
          if (!r.ok) {
            setErro(r.erro.mensagem);
            return;
          }
          form.reset();
          router.refresh();
        }}
      >
        <label className="text-sm">
          Código do anúncio ou cofre
          <input name="imovel" required className={CAMPO} placeholder="ARINI-MAP-… ou COFRE-…" />
        </label>
        <label className="text-sm">
          Revisar em
          <input name="revisar" type="date" required className={CAMPO} />
        </label>
        <label className="text-sm sm:col-span-2">
          Fundamento da guarda
          <textarea name="motivo" maxLength={2000} required rows={2} className={CAMPO} />
        </label>
        <button disabled={ocupado} className="btn-verde justify-self-start px-3 py-2 text-sm">
          Preservar evidências
        </button>
      </form>
      {guardas.map((g) => (
        <form
          key={g.id}
          className="space-y-2 border-t border-linha pt-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const motivo = new FormData(e.currentTarget).get("motivo");
            setOcupado(true);
            setErro("");
            const r = await enviarJson("/api/admin/lgpd", "POST", { acao: "guarda", guarda: g.id, motivo });
            setOcupado(false);
            if (!r.ok) {
              setErro(r.erro.mensagem);
              return;
            }
            router.refresh();
          }}
        >
          <h3 className="break-words font-semibold">
            {g.codigo_imovel} · revisão em {g.revisar_em.split("-").reverse().join("/")}
          </h3>
          <p className="whitespace-pre-wrap text-sm">{g.fundamento}</p>
          {g.documentos?.map((d) => (
            <a
              key={d.storage_path}
              href={urlArquivo(d.storage_path)}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-sm text-verde underline"
            >
              {d.nome_arquivo}
            </a>
          ))}
          <label className="block text-sm">
            Justificativa da liberação
            <input className={CAMPO} required maxLength={2000} name="motivo" />
          </label>
          <button disabled={ocupado} className="btn-contorno px-3 py-2 text-sm">
            Liberar guarda
          </button>
        </form>
      ))}
      {erro && (
        <p role="alert" className="text-sm text-critico">
          {erro}
        </p>
      )}
    </section>
  );
}
