// Gateway de pagamento SINTÉTICO para a auditoria local. Nunca chama o Asaas.
// ASAAS_BASE_URL=http://127.0.0.1:55429/v3 ASAAS_API_KEY=qa-local-only
// Controle local: GET /__qa/state; POST /__qa/status {id,status,billingType?}
// devolve o payload que o teste entrega ao webhook REAL da aplicação.
import {createServer} from "node:http";
import {randomUUID} from "node:crypto";

const customers = new Map(), payments = new Map(), invoices = new Map();
let failure = null;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const send = (status, data) => { res.writeHead(status, {"Content-Type":"application/json"}); res.end(JSON.stringify(data)); };
  let text = "";
  for await (const part of req) { text += part; if (text.length > 16384) return send(413, {error:"fixture body limit"}); }
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { return send(400, {error:"invalid json"}); }
  if (url.pathname === "/__qa/state") return send(200, {synthetic:true, customers:[...customers.values()], payments:[...payments.values()], invoices:[...invoices.values()]});
  if (url.pathname === "/__qa/fail" && req.method === "POST") {
    failure = {path:String(body.path || "/v3/payments"), status:Number(body.status || 503)};
    return send(200, {ok:true});
  }
  if (url.pathname === "/__qa/status" && req.method === "POST") {
    const payment = payments.get(body.id);
    if (!payment || !["CONFIRMED","RECEIVED","OVERDUE","REFUNDED","CHARGEBACK_REQUESTED","PARTIALLY_REFUNDED"].includes(body.status)) return send(400, {error:"unknown payment/status"});
    payment.status = body.status;
    if (body.billingType) payment.billingType = body.billingType;
    return send(200, {id:"evt_qa_"+randomUUID(), event:"PAYMENT_"+body.status, dateCreated:new Date().toISOString(), payment});
  }
  if (req.headers.access_token !== (process.env.QA_ASAAS_KEY || "qa-local-only")) return send(401, {errors:[{code:"invalid_access_token",description:"Chave da fixture recusada."}]});
  if (failure?.path === url.pathname) { const status=failure.status; failure=null; return send(status, {errors:[{code:"fixture_failure",description:"Falha sintética de pagamento."}]}); }
  const collection = /^\/v3\/(customers|payments|invoices)$/.exec(url.pathname)?.[1];
  if (collection) {
    const map = {customers,payments,invoices}[collection];
    if (req.method === "GET") return send(200, {data:[...map.values()].filter(x => !url.searchParams.has("externalReference") || x.externalReference === url.searchParams.get("externalReference")), hasMore:false});
    if (req.method === "POST") {
      if (collection === "payments" && (!customers.has(body.customer) || !(body.value > 0))) return send(400, {errors:[{code:"invalid_payment",description:"Cliente ou valor inválido."}]});
      const id = ({customers:"cus",payments:"pay",invoices:"inv"}[collection])+"_qa_"+randomUUID().replaceAll("-", "");
      const item = {...body,id,object:collection.slice(0,-1), ...(collection === "payments" ? {status:"PENDING",deleted:false,invoiceUrl:"https://sandbox.asaas.com/i/"+id} : collection === "invoices" ? {status:"SCHEDULED"} : {})};
      map.set(id,item); return send(200,item);
    }
  }
  const match = /^\/v3\/(customers|payments|invoices)\/([^/]+)(.*)$/.exec(url.pathname);
  if (match) {
    const [,kind,id,action]=match, map={customers,payments,invoices}[kind], item=map.get(id);
    if (!item) return send(404, {errors:[{code:"not_found",description:"Registro sintético ausente."}]});
    if (kind === "payments" && action === "/pixQrCode") return send(200, {encodedImage:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=", payload:"000201-PIX-SINTETICO-NAO-PAGAVEL-"+id, expirationDate:"2099-01-01 23:59:59"});
    if (req.method === "DELETE") { item.deleted=true; return send(200,{deleted:true,id}); }
    if (["/refund","/bankSlip/refund"].includes(action)) {item.status="REFUNDED"; return send(200,item);}
    if (kind === "invoices" && action === "/authorize") {item.status="AUTHORIZED"; item.number="QA-1"; return send(200,item);}
    if (kind === "invoices" && action === "/cancel") {item.status="CANCELED"; return send(200,item);}
    if (!action && req.method === "GET") return send(200,item);
  }
  return send(404,{error:"Rota não implementada na fixture",path:url.pathname});
});
server.listen(Number(process.env.QA_ASAAS_PORT || 55429), "127.0.0.1", () => console.log("Asaas SINTÉTICO ouvindo somente 127.0.0.1:"+server.address().port));
