import { supabaseAdmin } from "@/lib/supabase/admin";
import { ator, temSetor } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { limitar, respostaLimite } from "@/lib/seguranca/limite";
import { ETAPA_LABEL } from "@/lib/funil";
import { ORIGEM_LABEL, TEMPERATURA_LABEL, celulaCsv, type Temperatura } from "@/lib/crm-comercial";

/** Planilha (CSV) das oportunidades do Comercial, com os mesmos filtros da tela de Leads. */
export async function GET(request: Request) {
  const a = await ator();
  if (!temSetor(a, "comercial", "diretoria")) return new Response("Restrito ao Comercial.", { status: 403 });
  const limite = await limitar(`crm:exportar:${a!.userId}`, 10, 600);
  if (!limite.permitido) return respostaLimite(limite, "exportação");
  const sp = new URL(request.url).searchParams;
  const admin = supabaseAdmin();

  let q = admin.from("oportunidades_oficiais")
    .select(`codigo, etapa, created_at, responsavel_user_id, temperatura, etiquetas, proxima_acao, proxima_acao_em, ultimo_contato_em, motivo_perda,
      lead:leads(nome, telefone, email, origem, mensagem), property:properties(codigo, titulo, valor)`)
    .order("created_at", { ascending: false }).limit(5000);
  const etapa = sp.get("etapa");
  if (etapa && ETAPA_LABEL[etapa]) q = q.eq("etapa", etapa);
  const corretor = sp.get("corretor");
  if (corretor && /^[0-9a-f-]{36}$/i.test(corretor)) q = q.eq("responsavel_user_id", corretor);
  const temp = sp.get("temperatura");
  if (temp && temp in TEMPERATURA_LABEL) q = q.eq("temperatura", temp);
  const { data, error } = await q;
  if (error) return new Response("Falta rodar a migration 0147 (CRM comercial).", { status: 400 });

  const { data: equipe } = await admin.from("profiles").select("user_id, nome").in("role", ["admin_central", "analista_arini"]);
  const nome = new Map((equipe ?? []).map((m) => [m.user_id, m.nome]));
  const cab = ["Oportunidade", "Criada em", "Etapa", "Cliente", "Telefone", "E-mail", "Origem", "Imóvel", "Título", "Valor", "Corretor",
    "Temperatura", "Etiquetas", "Próxima ação", "Quando", "Último contato", "Motivo da perda", "Mensagem"];
  const data_ = (d: string | null) => d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";
  const linhas = (data ?? []).map((o) => {
    const l = o.lead as unknown as { nome: string; telefone: string | null; email: string | null; origem: string; mensagem: string | null } | null;
    const p = o.property as unknown as { codigo: string; titulo: string; valor: number | null } | null;
    return [o.codigo, data_(o.created_at), ETAPA_LABEL[o.etapa] ?? o.etapa, l?.nome, l?.telefone, l?.email,
      ORIGEM_LABEL[l?.origem ?? ""] ?? l?.origem, p?.codigo, p?.titulo, p?.valor ?? "",
      o.responsavel_user_id ? nome.get(o.responsavel_user_id) ?? "" : "",
      o.temperatura ? TEMPERATURA_LABEL[o.temperatura as Temperatura] : "", (o.etiquetas ?? []).join(" | "),
      o.proxima_acao, data_(o.proxima_acao_em), data_(o.ultimo_contato_em), o.motivo_perda, l?.mensagem].map(celulaCsv).join(";");
  });
  await logAudit({ user_id: a!.userId, acao: "crm_exportado", entidade: "opportunities", dados_depois: { linhas: linhas.length } });
  const hoje = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + [cab.join(";"), ...linhas].join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-arini-${hoje}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
