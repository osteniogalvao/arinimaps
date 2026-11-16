import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/notify";
import { ipDoPedido } from "./limite";

/**
 * Alertas de acesso anormal (item 6.8 do roadmap; requisitos 3, 6 e 17).
 *
 * Detecção feita a partir do histórico de auth_events, sem guardar nada novo
 * sobre o aparelho além do que o login já registra:
 *  · novo aparelho — combinação navegador + sistema nunca vista nesta conta;
 *  · novo local   — faixa de IP (/24 no IPv4, /48 no IPv6) nunca vista;
 *  · excesso de falhas — 5 senhas erradas na mesma conta em 15 min, ou
 *    20 a partir do mesmo endereço em 10 min;
 *  · entrada após falhas — login certo logo depois de 5+ erros (sinal de
 *    senha adivinhada ou vazada).
 * O primeiro login da conta não gera alerta (não há histórico para comparar).
 *
 * Cada alerta vai para `alertas_seguranca` (tela Segurança) e, por e-mail, ao
 * dono da conta. Sem RESEND_API_KEY o e-mail é inerte (`notificado` = false) —
 * a detecção e o registro funcionam do mesmo jeito.
 *
 * Nada aqui pode derrubar o login: todas as funções engolem o próprio erro.
 */
export type TipoAlerta = "novo_aparelho" | "novo_local" | "excesso_falhas" | "entrada_apos_falhas" | "recuperacao_equipe" | "sistema_instavel";

export const ALERTA_LABEL: Record<TipoAlerta, string> = {
  novo_aparelho: "Entrada de aparelho novo",
  novo_local: "Entrada de local novo",
  excesso_falhas: "Excesso de senhas erradas",
  entrada_apos_falhas: "Entrada logo após várias senhas erradas",
  recuperacao_equipe: "Senha da equipe redefinida por recuperação",
  sistema_instavel: "Parte do sistema fora do ar (monitoramento)",
};

/** Navegador + sistema, sem versão: "Chrome · Windows". */
export function descreverAparelho(ua: string | null | undefined) {
  const s = ua ?? "";
  const so = /iPhone|iPad/.test(s) ? "iOS" : /Android/.test(s) ? "Android" : /Windows/.test(s) ? "Windows"
    : /Mac OS X|Macintosh/.test(s) ? "macOS" : /CrOS/.test(s) ? "ChromeOS" : /Linux/.test(s) ? "Linux" : "outro sistema";
  const nav = /Edg\//.test(s) ? "Edge" : /OPR\/|Opera/.test(s) ? "Opera" : /SamsungBrowser/.test(s) ? "Samsung Internet"
    : /Firefox\//.test(s) ? "Firefox" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "outro navegador";
  return `${nav} · ${so}`;
}
export function chaveAparelho(ua: string | null | undefined) {
  return createHash("sha256").update(descreverAparelho(ua)).digest("hex").slice(0, 16);
}
/** Faixa do endereço: /24 no IPv4, /48 no IPv6. */
export function faixaIp(ip: string | null | undefined) {
  if (!ip || ip === "desconhecido") return null;
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":") + "::/48";
  const p = ip.split(".");
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0/24` : ip;
}

const quando = () => new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

export async function registrarAlerta(dados: {
  tipo: TipoAlerta;
  severidade?: "baixa" | "media" | "alta";
  userId?: string | null;
  email?: string | null;
  detalhe?: Record<string, unknown>;
  request?: Request | null;
  /** e-mail ao dono da conta: [assunto, texto] */
  aviso?: [string, string] | null;
  /** outros destinatários (ex.: diretoria), mesmo texto */
  copias?: string[];
  /** registra mesmo que haja alerta igual há pouco (ex.: cada redefinição de senha da equipe) */
  sempre?: boolean;
}) {
  try {
    const admin = supabaseAdmin();
    // não repete o mesmo alerta para a mesma conta em 30 min
    if (!dados.sempre && (dados.email || dados.userId)) {
      let q = admin.from("alertas_seguranca").select("id").eq("tipo", dados.tipo)
        .gte("created_at", new Date(Date.now() - 30 * 60_000).toISOString()).limit(1);
      q = dados.userId ? q.eq("user_id", dados.userId) : q.eq("email", dados.email!.toLowerCase());
      if (dados.tipo === "excesso_falhas" && dados.detalhe?.por === "ip") q = q.eq("ip", String(dados.detalhe.ip ?? ""));
      const { data: recente } = await q;
      if (recente?.length) return;
    }
    const temEmail = !!process.env.RESEND_API_KEY;
    const destinos = [dados.aviso && dados.email ? dados.email : null, ...(dados.copias ?? [])].filter((e): e is string => !!e);
    await admin.from("alertas_seguranca").insert({
      user_id: dados.userId ?? null,
      email: dados.email?.toLowerCase() ?? null,
      tipo: dados.tipo,
      severidade: dados.severidade ?? "media",
      detalhe: dados.detalhe ?? null,
      ip: dados.request ? ipDoPedido(dados.request) : null,
      agente: dados.request?.headers.get("user-agent")?.slice(0, 300) ?? null,
      notificado: temEmail && destinos.length > 0,
    });
    if (dados.aviso) {
      for (const para of destinos) await sendEmail(para, dados.aviso[0], dados.aviso[1]);
    }
  } catch (e) {
    console.error("alertas_seguranca falhou:", e);
  }
}

/**
 * Chamada no login certo, ANTES de gravar o login_ok atual: compara este
 * aparelho/local com os logins anteriores da conta.
 */
export async function analisarEntrada(request: Request, userId: string, email: string) {
  try {
    const admin = supabaseAdmin();
    const ip = ipDoPedido(request);
    const ua = request.headers.get("user-agent");
    const desde = new Date(Date.now() - 180 * 86_400_000).toISOString();
    const [{ data: anteriores }, { count: falhas }] = await Promise.all([
      admin.from("auth_events").select("ip, agente").eq("user_id", userId).eq("evento", "login_ok")
        .gte("created_at", desde).order("created_at", { ascending: false }).limit(200),
      admin.from("auth_events").select("id", { count: "exact", head: true }).eq("email", email.toLowerCase())
        .eq("evento", "login_falhou").gte("created_at", new Date(Date.now() - 30 * 60_000).toISOString()),
    ]);
    const aparelho = descreverAparelho(ua);
    const detalhe = { aparelho, faixa: faixaIp(ip), ip };

    if ((falhas ?? 0) >= 5) {
      await registrarAlerta({
        tipo: "entrada_apos_falhas", severidade: "alta", userId, email, request, detalhe: { ...detalhe, falhas },
        aviso: ["Entrada na sua conta após várias senhas erradas — ARINI",
          `Sua conta foi acessada em ${quando()} (${aparelho}, endereço ${ip}) logo depois de ${falhas} tentativas com senha errada.\n\n` +
          "Se foi você, ignore este aviso. Se não foi, troque a senha agora em Minha segurança e ative o segundo fator."],
      });
    }

    if (!anteriores?.length) return; // primeiro login: nada a comparar
    const chave = chaveAparelho(ua);
    const faixa = faixaIp(ip);
    const aparelhoNovo = !anteriores.some((e) => chaveAparelho(e.agente) === chave);
    const localNovo = !!faixa && !anteriores.some((e) => faixaIp(e.ip) === faixa);
    if (!aparelhoNovo && !localNovo) return;

    await registrarAlerta({
      tipo: aparelhoNovo ? "novo_aparelho" : "novo_local",
      severidade: aparelhoNovo && localNovo ? "media" : "baixa",
      userId, email, request, detalhe: { ...detalhe, aparelho_novo: aparelhoNovo, local_novo: localNovo },
      aviso: ["Novo acesso à sua conta — ARINI",
        `Sua conta entrou em ${quando()} a partir de ${aparelhoNovo ? "um aparelho que ainda não tínhamos visto" : "um local que ainda não tínhamos visto"}:\n\n` +
        `  Aparelho: ${aparelho}\n  Endereço: ${ip}\n\n` +
        "Se foi você, não precisa fazer nada. Se não foi, troque a senha agora em Minha segurança, " +
        "encerre as outras sessões e ative o segundo fator."],
    });
  } catch (e) {
    console.error("analisarEntrada falhou:", e);
  }
}

/** Chamada depois de gravar um login_falhou: excesso por conta e por endereço. */
export async function analisarFalha(request: Request, email: string) {
  try {
    const admin = supabaseAdmin();
    const ip = ipDoPedido(request);
    const [{ count: porConta }, { count: porIp }] = await Promise.all([
      admin.from("auth_events").select("id", { count: "exact", head: true }).eq("email", email.toLowerCase())
        .eq("evento", "login_falhou").gte("created_at", new Date(Date.now() - 15 * 60_000).toISOString()),
      admin.from("auth_events").select("id", { count: "exact", head: true }).eq("ip", ip)
        .eq("evento", "login_falhou").gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString()),
    ]);
    if ((porConta ?? 0) >= 5) {
      // só avisa por e-mail se a conta existe (já entrou alguma vez) — sem revelar nada a quem tenta
      const { count: existe } = await admin.from("auth_events").select("id", { count: "exact", head: true })
        .eq("email", email.toLowerCase()).eq("evento", "login_ok");
      await registrarAlerta({
        tipo: "excesso_falhas", severidade: "media", email, request, detalhe: { por: "conta", falhas: porConta, ip },
        aviso: existe ? ["Tentativas de entrar na sua conta — ARINI",
          `Registramos ${porConta} tentativas com senha errada na sua conta nos últimos 15 minutos (último endereço: ${ip}, em ${quando()}).\n\n` +
          "O sistema já bloqueia novas tentativas por alguns minutos. Se não foi você, troque a senha e ative o segundo fator."] : null,
      });
    }
    if ((porIp ?? 0) >= 20) {
      await registrarAlerta({
        tipo: "excesso_falhas", severidade: "alta", email: `ip:${ip}`, request, detalhe: { por: "ip", falhas: porIp, ip },
      });
    }
  } catch (e) {
    console.error("analisarFalha falhou:", e);
  }
}
