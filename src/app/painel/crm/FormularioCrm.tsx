"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ETAPAS_CRM_PRIVADO, type AtendimentoPrivado, type ContatoPrivado, type ConfiguracaoSetorial } from "@/lib/crm-privado";

const campo = "mt-1 block w-full min-w-0 rounded-lg border border-linha bg-transparent px-3 py-2 text-base";
export function ProfissaoCrm({ config }: { config: ConfiguracaoSetorial }) {
  const router = useRouter();
  const [salvando,setSalvando] = useState(false);
  const [aviso,setAviso] = useState("");
  async function aplicar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSalvando(true); setAviso("");
    const profissao = new FormData(e.currentTarget).get("profissao");
    try {
      const res = await fetch("/api/painel/crm", { method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify({profissao}) });
      if (!res.ok) throw new Error();
      setAviso("Modelo de serviço salvo."); router.refresh();
    } catch { setAviso("Não foi possível alterar o modelo. Confira o acesso do plano."); }
    finally { setSalvando(false); }
  }
  return <details className="rounded-xl border border-linha p-4" open={!config.profissao}>
    <summary className="cursor-pointer font-medium">Modelo de serviço: {config.profissao ? config.modelos[config.profissao]?.nome : "escolher profissão"}</summary>
    <p className="mt-3 text-sm text-texto-3">Estes modelos organizam os serviços e os dados que você informa. Documentos oficiais, validações profissionais e consultas a órgãos dependem de serviços próprios.</p>
    <form onSubmit={aplicar} className="mt-3 flex flex-wrap items-end gap-3"><label>Profissão
      <select className={campo} name="profissao" defaultValue={config.profissao ?? ""} required>
        <option value="" disabled>Selecione</option>
        {Object.entries(config.modelos).sort(([,a],[,b]) => a.nome.localeCompare(b.nome,"pt-BR")).map(([id,m]) => <option key={id} value={id}>{m.nome}</option>)}
      </select></label><button className="rounded-lg border border-linha px-4 py-2" disabled={salvando}>Salvar modelo</button>
      {aviso && <p role="status">{aviso}</p>}</form></details>;
}
export default function FormularioCrm({ atendimento, contato, config }: { atendimento?: AtendimentoPrivado; contato?: ContatoPrivado; config?: ConfiguracaoSetorial | null }) {
  const router = useRouter();
  const chave = useRef<string | null>(null);
  const ocupado = useRef(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [categoria,setCategoria] = useState("");
  const modelo = config?.profissao ? config.modelos[config.profissao] : null;
  async function salvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ocupado.current) return;
    ocupado.current = true; setSalvando(true); setErro("");
    const form = event.currentTarget;
    const fd = new FormData(form);
    const campos = Object.fromEntries(Array.from(fd).filter(([k]) => k.startsWith("setorial:")).map(([k,v]) => [k.slice(9),v]));
    const dados = Object.fromEntries(Array.from(fd).filter(([k]) => !k.startsWith("setorial:")));
    chave.current ??= crypto.randomUUID();
    const id = atendimento?.id ?? chave.current;
    try {
      const res = await fetch("/api/painel/crm", {
        method: atendimento ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...dados, id, ...(atendimento ? { versao: atendimento.versao } : contato ? { contatoId: contato.id } : {}),
          ...(!atendimento && categoria && config?.profissao ? { modelo: config.profissao, categoria, campos } : {}) }),
      });
      if (!res.ok) {
        const corpo = await res.json().catch(() => ({}));
        setErro(corpo.erro ?? "Não foi possível salvar. Tente novamente.");
        return;
      }
      form.reset(); chave.current = null;
      if (!atendimento) router.push("/painel/crm?id=" + id);
      router.refresh();
    } catch { setErro("A conexão foi interrompida. Você pode tentar novamente."); }
    finally { ocupado.current = false; setSalvando(false); }
  }
  return <form onSubmit={salvar} className="mt-4 max-w-2xl space-y-4">
    {atendimento ? <><h2 className="text-xl font-semibold">Atualizar atendimento</h2>
      <label className="block">Etapa<select name="etapa" className={campo} defaultValue={atendimento.etapa}>
        {Object.entries(ETAPAS_CRM_PRIVADO).map(([id,nome]) => <option key={id} value={id}>{nome}</option>)}
      </select></label></> : <>
      {contato ? <p>Contato: <strong>{contato.nome}</strong></p> : <>
        <label className="block">Nome do contato<input className={campo} name="nome" required maxLength={140} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>E-mail (opcional)<input className={campo} name="email" type="email" maxLength={254} /></label>
          <label>Telefone (opcional)<input className={campo} name="telefone" type="tel" maxLength={40} /></label>
        </div></>}
      <label className="block">Assunto<input name="assunto" className={campo} required maxLength={180} /></label>
      {modelo && <fieldset className="space-y-3 rounded-lg border border-linha p-3"><legend className="px-1">Serviço · {modelo.nome}</legend>
        <label className="block">Categoria<select className={campo} value={categoria} onChange={e => setCategoria(e.target.value)}>
          <option value="">Triagem comum</option>{Object.entries(modelo.categorias).map(([id,nome]) => <option key={id} value={id}>{nome}</option>)}
        </select></label>
        {categoria && Object.entries(modelo.campos).map(([id,c]) => <label className="block" key={id}>{c.nome} (opcional)
          <input className={campo} name={"setorial:" + id} maxLength={250} type={c.tipo === "data" ? "date" : c.tipo === "numero" ? "number" : "text"}
            min={c.tipo === "numero" ? 0 : undefined} step={c.tipo === "numero" ? "0.000001" : undefined} /></label>)}
      </fieldset>}</>}
    <label className="block">Próximo retorno (opcional)<input type="date" name="retorno" className={campo} defaultValue={atendimento?.proximo_retorno ?? ""} /></label>
    <label className="block">Anotação para o histórico (opcional)<textarea className={campo} rows={3} name="nota" maxLength={2000} /></label>
    <button disabled={salvando} className="rounded-lg bg-verde px-4 py-2 font-semibold text-[#0a271b] disabled:opacity-60">
      {salvando ? "Salvando…" : atendimento ? "Registrar atualização" : "Abrir em triagem"}</button>
    {erro && <p role="alert" className="text-critico">{erro} {atendimento && <button type="button" className="underline" onClick={() => router.refresh()}>Recarregar atendimento</button>}</p>}
  </form>;
}
