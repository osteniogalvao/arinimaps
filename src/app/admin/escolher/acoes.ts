"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { exigirEquipe } from "@/lib/setores-servidor";
import { COOKIE_PAINEL, INICIO_PAINEL, painelValido } from "@/lib/paineis";

/** Guarda o painel escolhido (só muda o menu; a trava é de cada página). */
export async function escolherPainel(formData: FormData) {
  await exigirEquipe();
  const painel = painelValido(formData.get("painel"));
  if (!painel) redirect("/admin/escolher");
  (await cookies()).set(COOKIE_PAINEL, painel, {
    path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365,
  });
  redirect(INICIO_PAINEL[painel]);
}
