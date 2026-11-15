import { profissaoSugerida } from "@/lib/profissao";

export default function CamposProfissao({
  profissao,
  especialidade,
  mudar,
  classe,
}: {
  profissao: string;
  especialidade: string;
  mudar: (campo: "profissao_declarada" | "especialidade", valor: string) => void;
  classe: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-semibold">
        Profissão
        <input
          className={classe}
          maxLength={100}
          minLength={2}
          list="profissoes-arini"
          value={profissao}
          onChange={(e) => mudar("profissao_declarada", e.target.value)}
        />
        <datalist id="profissoes-arini">
          {profissaoSugerida.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>
      <label className="text-sm font-semibold">
        Especialidade
        <input
          className={classe}
          maxLength={120}
          minLength={2}
          value={especialidade}
          onChange={(e) => mudar("especialidade", e.target.value)}
        />
      </label>
    </div>
  );
}
