"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/**
 * Campo de senha com botão de olho para mostrar ou ocultar o que foi digitado.
 * Aceita as mesmas props de um <input>; a classe recebida vale para o campo.
 */
export default function CampoSenha({ className = "", ...props }: Props) {
  const [visivel, setVisivel] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={visivel ? "text" : "password"} className={`${className} pr-12`}
        autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button type="button" onClick={() => setVisivel((v) => !v)}
        aria-label={visivel ? "Ocultar senha" : "Mostrar senha"} aria-pressed={visivel}
        title={visivel ? "Ocultar senha" : "Mostrar senha"}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-texto-2 transition hover:text-verde focus:outline-none focus-visible:text-verde">
        {visivel ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
      </button>
    </div>
  );
}
