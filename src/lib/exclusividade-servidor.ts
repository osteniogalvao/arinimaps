import "server-only";
import { createHash } from "node:crypto";
import { documento } from "@/lib/juridico";

export function exclusividadeVigente(cfg: Record<string, unknown>, meses: 6 | 12) {
  const termo = documento(cfg, "exclusividade", meses)!;
  return { termo, assinatura: createHash("sha256").update(JSON.stringify(termo)).digest("hex") };
}
