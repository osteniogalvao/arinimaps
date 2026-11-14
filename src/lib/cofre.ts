export function temPerfilCofre(role: string, nicho: string | null) {
  return !["admin_central", "analista_arini"].includes(role) &&
    (nicho === "proprietario" || nicho === "produtor_rural" || (nicho === null && role === "proprietario"));
}
export type PropriedadeCofre = {
  id: string; nome: string; municipio: string; area_ha: number; car: string | null; matricula: string | null;
};
export type DocumentoCofre = { id: string; nome_arquivo: string; tamanho_bytes: number; url: string };
