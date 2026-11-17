"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { linkWhatsApp } from "@/lib/compartilhar";
import { PRODUTOS } from "@/lib/mercado/formato";

const CAMPO =
  "mt-1 block w-full rounded-xl border border-linha-forte bg-superficie px-3 py-2 text-texto focus:border-verde";

export default function ConsultaAgro({
  telefone,
  produto,
  praca,
}: {
  telefone: string;
  produto?: string;
  praca?: string | null;
}) {
  const [escolha, setEscolha] = useState(produto || "boi-gordo");
  const [local, setLocal] = useState(praca ?? "");
  const opcoes = Object.entries(PRODUTOS);
  if (produto && !(produto in PRODUTOS)) opcoes.push([produto, produto]);
  // comando que o atendimento automático entende (COTAÇÃO <produto> <praça>): a resposta chega na hora
  const mensagem = `COTAÇÃO ${PRODUTOS[escolha] ?? escolha}${local.trim() ? ` ${local.trim()}` : ""}`;

  return (
    <section aria-labelledby="consulta-agro" className="cartao mt-8 max-w-3xl space-y-4 p-5 md:p-7">
      <h2 id="consulta-agro" className="lp-display text-2xl">
        Receber a cotação no WhatsApp
      </h2>
      <p className="text-sm text-texto-2">
        A resposta é automática, com o preço do dia e a variação em 7 e 30 dias. Depois, envie outro produto ou
        SAFRA e o nome da cultura para ver a estimativa da CONAB.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Produto de interesse
          <select value={escolha} onChange={(e) => setEscolha(e.target.value)} className={CAMPO}>
            {opcoes.map(([id, nome]) => (
              <option key={id} value={id}>
                {nome}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Município, praça ou região
          <input
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            maxLength={120}
            placeholder="Ex. Triângulo Mineiro"
            className={CAMPO}
          />
        </label>
      </div>
      <a
        className="lp-btn lp-btn-contorno"
        href={linkWhatsApp(mensagem, telefone)}
        target="_blank"
        rel="noopener noreferrer"
      >
        <MessageCircle aria-hidden /> Receber pelo WhatsApp
      </a>
    </section>
  );
}
