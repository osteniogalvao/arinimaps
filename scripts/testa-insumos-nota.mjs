// Exercita o leitor real do navegador com NF-e sintética, sem credenciais ou serviço fiscal.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';

test('leitura local de NF-e e comparação por produto/unidade',async()=>{
 const fonte=await readFile(new URL('../src/lib/insumos-nota.ts',import.meta.url),'utf8');
 const script=ts.transpileModule(fonte,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const server=createServer((req,res)=>{const js=req.url==='/nota.js';res.writeHead(200,{'content-type':js?'application/javascript':'text/html'});res.end(js?script:'<title>NF-e sintética</title>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'/usr/bin/google-chrome'),headless:true,args:['--no-sandbox']});
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
  const r=await page.evaluate(async()=>{
   const {lerNota,grupoCompra}=await import('/nota.js');const key='9'.repeat(44);
   const xml='<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe'+key+'"><ide><dhEmi>2026-10-17T09:00:00-03:00</dhEmi></ide><emit><xNome>Fornecedor de teste</xNome></emit><det nItem="1"><prod><xProd>Calcário</xProd><cEAN>SEM GTIN</cEAN><uCom>kg</uCom><qCom>4.0000</qCom><vProd>20.00</vProd><vDesc>2.00</vDesc></prod></det></infNFe></NFe><protNFe><infProt><cStat>100</cStat><chNFe>'+key+'</chNFe></infProt></protNFe></nfeProc>';
   const ler=s=>lerNota(new File([s],'teste.xml'));const n=await ler(xml);const i=n.itens[0];const outra=await ler(xml.replaceAll(key,'8'.repeat(44)).replace('Fornecedor de teste','Outro fornecedor').replace('20.00','30.00'));
   const segundo=outra.itens[0];const comparou=n.chave!==outra.chave && n.fornecedor!==outra.fornecedor && grupoCompra(i)===grupoCompra(segundo) && segundo.total/segundo.quantidade===7;
   const recusados=[];
   for(const s of [xml.replace('>100<','>110<'),xml.replace('Id="NFe9','Id="NFe0'),'<!DOCTYPE teste>'+xml,xml.replace('4.0000','0')]){
     try{await ler(s);recusados.push(false);}catch{recusados.push(true);}
   }
   return {comparou,emissao:n.emissao,unidade:i.unidade,preco:i.total/i.quantidade,segredo:JSON.stringify(n).includes(key),
    repetida:n.chave===(await ler(xml)).chave,mesmo:grupoCompra(i)===grupoCompra({...i,produto:'CALCÁRIO'}),diferente:grupoCompra(i)!==grupoCompra({...i,unidade:'SC'}),recusados};
  });assert.deepEqual(r,{comparou:true,emissao:'2026-10-17',unidade:'KG',preco:4.5,segredo:false,repetida:true,mesmo:true,diferente:true,recusados:[true,true,true,true]});
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
});
