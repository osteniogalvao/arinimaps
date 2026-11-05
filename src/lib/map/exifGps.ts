/**
 * Lê a coordenada de GPS gravada numa foto JPEG (EXIF), no navegador.
 *
 * Foto de celular tirada no local já diz onde está: é a busca por imagem mais
 * barata e mais precisa, sem servidor e sem IA. Devolve null quando a imagem
 * não é JPEG, não tem EXIF ou não tem GPS (prints e croquis nunca têm).
 */
export async function gpsDaFoto(arquivo: Blob): Promise<{ lat: number; lng: number } | null> {
  const buf = await arquivo.slice(0, 256 * 1024).arrayBuffer();
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;

  // procura o segmento APP1 "Exif"
  let p = 2;
  while (p + 4 <= v.byteLength) {
    const marca = v.getUint16(p);
    const tam = v.getUint16(p + 2);
    if (marca === 0xffe1 && p + 10 <= v.byteLength && v.getUint32(p + 4) === 0x45786966) {
      return lerTiff(v, p + 10);
    }
    if ((marca & 0xff00) !== 0xff00 || marca === 0xffda) return null;
    p += 2 + tam;
  }
  return null;
}

function lerTiff(v: DataView, t: number): { lat: number; lng: number } | null {
  if (t + 8 > v.byteLength) return null;
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o: number) => v.getUint16(o, le);
  const u32 = (o: number) => v.getUint32(o, le);
  const dentro = (o: number, n: number) => o >= 0 && o + n <= v.byteLength;

  /** entradas de um diretório: tag → posição da entrada */
  const entradas = (ifd: number) => {
    const m = new Map<number, number>();
    if (!dentro(ifd, 2)) return m;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (!dentro(e, 12)) break;
      m.set(u16(e), e);
    }
    return m;
  };

  const ifd0 = entradas(t + u32(t + 4));
  const gpsEntrada = ifd0.get(0x8825);
  if (gpsEntrada === undefined) return null;
  const gps = entradas(t + u32(gpsEntrada + 8));

  const graus = (tag: number) => {
    const e = gps.get(tag);
    if (e === undefined || u16(e + 2) !== 5 || u32(e + 4) < 3) return null;
    const o = t + u32(e + 8);
    if (!dentro(o, 24)) return null;
    const r = (k: number) => { const d = u32(o + k * 8 + 4); return d ? u32(o + k * 8) / d : 0; };
    return r(0) + r(1) / 60 + r(2) / 3600;
  };
  const ref = (tag: number) => {
    const e = gps.get(tag);
    return e === undefined ? "" : String.fromCharCode(v.getUint8(e + 8));
  };

  let lat = graus(0x0002), lng = graus(0x0004);
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return null;
  if (ref(0x0001) === "S") lat = -lat;
  if (ref(0x0003) === "W") lng = -lng;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
