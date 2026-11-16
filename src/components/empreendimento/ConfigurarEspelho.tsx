"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { enviarJson } from "@/lib/api/enviar";
import type { ConfigEspelho } from "@/lib/empreendimento/tipos";

export default function ConfigurarEspelho({ id, config }: { id: string; config: ConfigEspelho }) {
  const router = useRouter();
  const [online, setOnline] = useState(config.reserva_online);
  const [horas, setHoras] = useState(config.prazo_horas?.toString() ?? "");
  const [projeto, setProjeto] = useState(config.projeto_url ?? "");
  const [pre, setPre] = useState(config.pre_lancamento);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  return <form className="cartao space-y-3 p-5" onSubmit={async (ev) => {
    ev.preventDefault();
    setErro(""); setOcupado(true);
    const r = await enviarJson("/api/empreendimentos/" + id + "/espelho", "PATCH", {
      online, horas: horas ? Number(horas) : null, projeto, pre, versao: config.alterado_em,
    });
    setOcupado(false);
    if (!r.ok) setErro(r.erro.mensagem);
    if (r.ok || r.erro.status === 409) router.refresh();
  }}>
    <h2 className="font-semibold">Condições do empreendimento</h2>
    <label className="flex items-center gap-2"><input type="checkbox" checked={pre} onChange={e => setPre(e.target.checked)} /> Pré-lançamento · ocultar o empreendimento e suas unidades no mapa principal</label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={online} onChange={e => setOnline(e.target.checked)} /> Aceitar reservas online</label>
    <label className="block">Duração da reserva em horas
      <input className="input mt-1 block w-36" type="number" min="1" max="2160" step="1" required={online} value={horas} onChange={e => setHoras(e.target.value)} />
    </label>
    <label className="block">Link do projeto 3D ou do tour
      <input className="input mt-1 block w-full" type="url" placeholder="https://" maxLength={2048} value={projeto} onChange={e => setProjeto(e.target.value)} />
      <span className="text-sm text-texto-2">Use o endereço público do visualizador ou de um arquivo GLB, glTF ou OBJ.</span>
    </label>
    <button type="submit" disabled={ocupado} className="btn btn-primario">{ocupado ? "Salvando…" : "Salvar condições"}</button>
    {erro && <p role="alert" className="text-sm">{erro}</p>}
  </form>;
}
