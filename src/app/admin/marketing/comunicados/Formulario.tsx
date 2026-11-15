"use client";
import { useRef, useState, type FormEvent } from "react";
import { comunicar } from "./acoes";

type Opcao = { id: string; nome: string };
export default function Formulario({ perfis, planos }: { perfis: Opcao[]; planos: Opcao[] }) {
  const [previa, setPrevia] = useState<number | null>(null),
    [aviso, setAviso] = useState(""),
    [ocupado, setOcupado] = useState(false);
  const chave = useRef<string | null>(null);
  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (ocupado) return;
    const form = e.currentTarget,
      prever = previa === null;
    chave.current ??= crypto.randomUUID();
    setOcupado(true);
    try {
      const resp = await comunicar(new FormData(form), chave.current, prever);
      if (resp.erro) {
        setAviso(resp.erro);
        return;
      }
      if (prever) {
        setPrevia(resp.total ?? 0);
        setAviso("Público estimado: " + resp.total + " conta(s).");
      } else {
        form.reset();
        chave.current = null;
        setPrevia(null);
        setAviso("Publicado para " + resp.total + " conta(s).");
      }
    } catch {
      setAviso("Conexão interrompida. Tente novamente.");
    } finally {
      setOcupado(false);
    }
  }
  const campo = "mt-1 block w-full rounded-lg border border-linha bg-fundo p-2.5";
  return (
    <form
      className="cartao space-y-5 p-5"
      onSubmit={enviar}
      onChange={() => {
        chave.current = null;
        setPrevia(null);
        setAviso("");
      }}
    >
      <fieldset disabled={ocupado} className="space-y-4">
        <legend className="mb-3 text-lg font-semibold">Destinatários</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["perfil", "Perfil em uso", perfis],
              ["plano", "Plano vigente", planos],
              [
                "interesse",
                "Interesse salvo",
                [
                  { id: "rural", nome: "Imóveis rurais" },
                  { id: "urbano", nome: "Imóveis urbanos" },
                  { id: "leilao", nome: "Leilões" },
                ],
              ],
            ] as const
          ).map(([k, n, opcoes]) => (
            <label key={k}>
              {n}
              <select name={k} className={campo}>
                <option value="">Todos</option>
                {opcoes.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nome}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label>
            Profissão declarada
            <input className={campo} name="profissao" placeholder="Todas" maxLength={100} />
          </label>
        </div>
        <label className="block">
          Título
          <input name="titulo" required minLength={4} maxLength={140} className={campo} />
        </label>
        <label className="block">
          Mensagem
          <textarea name="mensagem" required minLength={8} maxLength={4000} rows={4} className={campo} />
        </label>
        <label className="flex gap-2">
          <input type="checkbox" name="email" />
          Enviar também por e-mail a quem autorizou em Minha conta
        </label>
      </fieldset>
      <button disabled={ocupado || previa === 0} className="btn-verde px-4 py-2">
        {ocupado ? "Aguarde…" : previa === null ? "Conferir destinatários" : "Publicar comunicado"}
      </button>
      <p role="status">{aviso}</p>
    </form>
  );
}
