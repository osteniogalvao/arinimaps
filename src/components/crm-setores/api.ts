/** Chamada ao motor de CRM (/api/admin/crm). Devolve a mensagem de erro ou null. */
export async function crm(corpo: Record<string, unknown>): Promise<string | null> {
  const r = await fetch("/api/admin/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }).catch(() => null);
  if (!r) return "Sem conexão.";
  if (r.ok) return null;
  return (await r.json().catch(() => ({}))).error ?? "Não foi possível salvar.";
}
