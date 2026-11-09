// Leitor mínimo de planilha .xls (BIFF8 dentro de um arquivo CFB/OLE), sem
// dependência. Feito para as séries históricas do CEPEA (indicador/series/*.aspx),
// que só saem em .xls: lê números, RK/MULRK, textos (SST e LABEL) e devolve
// cada planilha como lista de linhas. Não lê fórmulas, datas formatadas nem estilos.
export function lerXls(buf) {
  const b = Buffer.from(buf);
  if (b.readUInt32LE(0) !== 0xe011cfd0) throw new Error("não é CFB");
  const setor = 1 << b.readUInt16LE(0x1e);
  const miniSetor = 1 << b.readUInt16LE(0x20);
  const nFat = b.readUInt32LE(0x2c);
  const dir0 = b.readUInt32LE(0x30);
  const corte = b.readUInt32LE(0x38);
  const miniFat0 = b.readUInt32LE(0x3c);
  let difat = b.readUInt32LE(0x44);
  const off = (s) => 512 + s * setor;
  const setoresFat = [];
  for (let i = 0; i < 109 && setoresFat.length < nFat; i++) setoresFat.push(b.readUInt32LE(0x4c + i * 4));
  while (setoresFat.length < nFat && difat < 0xfffffffa) {
    for (let i = 0; i < setor / 4 - 1 && setoresFat.length < nFat; i++) setoresFat.push(b.readUInt32LE(off(difat) + i * 4));
    difat = b.readUInt32LE(off(difat) + setor - 4);
  }
  const fat = [];
  for (const s of setoresFat) for (let i = 0; i < setor / 4; i++) fat.push(b.readUInt32LE(off(s) + i * 4));
  const cadeia = (ini, tabela = fat) => { const r = []; for (let s = ini; s < 0xfffffffa && r.length < 1e6; s = tabela[s]) r.push(s); return r; };
  const lerCadeia = (ini) => Buffer.concat(cadeia(ini).map((s) => b.subarray(off(s), off(s) + setor)));
  const dir = lerCadeia(dir0);
  const ents = [];
  for (let p = 0; p + 128 <= dir.length; p += 128) {
    const len = dir.readUInt16LE(p + 64);
    ents.push({ nome: dir.toString("utf16le", p, p + Math.max(0, len - 2)), tipo: dir[p + 66], ini: dir.readUInt32LE(p + 116), tam: dir.readUInt32LE(p + 120) });
  }
  const wb = ents.find((e) => e.nome === "Workbook" || e.nome === "Book");
  if (!wb) throw new Error("sem Workbook");
  let dados;
  if (wb.tam >= corte) dados = lerCadeia(wb.ini).subarray(0, wb.tam);
  else {
    const raiz = ents[0];
    const mini = lerCadeia(raiz.ini);
    const miniFat = [];
    for (const s of cadeia(miniFat0)) for (let i = 0; i < setor / 4; i++) miniFat.push(b.readUInt32LE(off(s) + i * 4));
    dados = Buffer.concat(cadeia(wb.ini, miniFat).map((s) => mini.subarray(s * miniSetor, (s + 1) * miniSetor))).subarray(0, wb.tam);
  }
  return lerBiff(dados);
}

function lerBiff(d) {
  // junta SST + CONTINUE guardando as fronteiras (a string pode trocar de 8/16 bits na quebra)
  const sst = [];
  const planilhas = [];
  let atual = null;
  let p = 0;
  while (p + 4 <= d.length) {
    const tipo = d.readUInt16LE(p), len = d.readUInt16LE(p + 2);
    const corpo = d.subarray(p + 4, p + 4 + len);
    p += 4 + len;
    if (tipo === 0x00fc) {
      const partes = [corpo];
      while (p + 4 <= d.length && d.readUInt16LE(p) === 0x003c) {
        const l = d.readUInt16LE(p + 2);
        partes.push(d.subarray(p + 4, p + 4 + l));
        p += 4 + l;
      }
      lerSst(partes, sst);
    } else if (tipo === 0x0809) {
      const bof = corpo.readUInt16LE(2);
      if (bof === 0x10) { atual = new Map(); planilhas.push(atual); }
    } else if (atual) {
      const cel = (r, c, v) => { let l = atual.get(r); if (!l) atual.set(r, (l = [])); l[c] = v; };
      if (tipo === 0x0203) cel(corpo.readUInt16LE(0), corpo.readUInt16LE(2), corpo.readDoubleLE(6));
      else if (tipo === 0x027e) cel(corpo.readUInt16LE(0), corpo.readUInt16LE(2), rk(corpo.readUInt32LE(6)));
      else if (tipo === 0x00bd) {
        const r = corpo.readUInt16LE(0), c0 = corpo.readUInt16LE(2);
        const n = (corpo.length - 6) / 6;
        for (let i = 0; i < n; i++) cel(r, c0 + i, rk(corpo.readUInt32LE(4 + i * 6 + 2)));
      } else if (tipo === 0x00fd) cel(corpo.readUInt16LE(0), corpo.readUInt16LE(2), sst[corpo.readUInt32LE(6)]);
      else if (tipo === 0x0204) cel(corpo.readUInt16LE(0), corpo.readUInt16LE(2), corpo.toString("latin1", 9, 9 + corpo.readUInt16LE(6)));
      else if (tipo === 0x000a) atual = null; // EOF da planilha
    }
  }
  return planilhas.map((m) => [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l));
}

function rk(v) {
  let n = v & 2 ? v >> 2 : (() => { const t = Buffer.alloc(8); t.writeUInt32LE(v & 0xfffffffc, 4); return t.readDoubleLE(0); })();
  return v & 1 ? n / 100 : n;
}

function lerSst(partes, sst) {
  let pi = 0, q = 8;
  const total = partes[0].readUInt32LE(4);
  const garante = () => { while (pi < partes.length && q >= partes[pi].length) { pi++; q = 0; } };
  const u8 = () => { garante(); return partes[pi][q++]; };
  const u16 = () => u8() | (u8() << 8);
  const u32 = () => (u16() | (u16() << 16)) >>> 0;
  for (let i = 0; i < total && pi < partes.length; i++) {
    const cch = u16();
    let fl = u8();
    const runs = fl & 8 ? u16() : 0;
    const ext = fl & 4 ? u32() : 0;
    let s = "";
    let falta = cch;
    while (falta > 0) {
      garante();
      if (pi >= partes.length) break;
      const larg = fl & 1 ? 2 : 1;
      const cabe = Math.min(falta, Math.floor((partes[pi].length - q) / larg));
      s += larg === 2 ? partes[pi].toString("utf16le", q, q + cabe * 2) : partes[pi].toString("latin1", q, q + cabe);
      q += cabe * larg;
      falta -= cabe;
      if (falta > 0) { pi++; q = 0; fl = partes[pi]?.[q++] ?? 0; }
    }
    // pula formatação e extensão (podem atravessar CONTINUE)
    for (let k = 0; k < runs * 4 + ext; k++) u8();
    sst.push(s);
  }
}
