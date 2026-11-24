# Dimensionamento de banco e armazenamento

Medido em 07/10/2026 no projeto Supabase `qtpjryvqifcmmabebccf` (roadmap 1.9).

## Hoje

| Item | Volume | Observação |
|---|---|---|
| Banco inteiro | 90 MB | inclui 7 MB do PostGIS (`spatial_ref_sys`) |
| `urban_lots` | 40 MB · 31 245 lotes | 3 cidades; ~1,3 KB por lote com geometria em 4326 e 3857 |
| `car_imoveis` | 26 MB · 10 196 áreas | 6 municípios; ~2,7 KB por área |
| Tabelas de negócio | < 2 MB | 3 imóveis de demonstração |
| Storage `media` | 46 MB · 6 arquivos | plantas das cidades (GeoJSON) |
| Storage `docs` | ~0 | documentos, selfies e anexos entram com o uso real |

## Projeção por item

| Item | Por unidade | Premissa |
|---|---|---|
| Lotes urbanos | 1,3 MB por 1 000 lotes | cidade de 30 mil habitantes ≈ 10 mil lotes ≈ 13 MB |
| CAR | 2,7 MB por 1 000 áreas | um município rural do Pontal tem 1 500 a 2 500 áreas |
| Planta da cidade (storage) | 2 a 20 MB | depende do CAD; a versão pública é menor |
| Anúncio | ~8 MB | 10 fotos de 600 KB + documentos em PDF |
| Vídeo do anúncio | até 500 MB (o worker reduz para 720p) | limite da rota de envio |
| Vídeo automático (worker) | 15 a 30 MB | 1080p, 40 s |
| Eventos e auditoria | ~0,5 KB por evento | ficha aberta, tour, consulta, login |

## Cenários

| Cenário | Banco | Storage |
|---|---|---|
| Piloto atual: 6 municípios, 200 anúncios, 5 mil usuários | ~250 MB | ~3 GB (com vídeo em metade dos anúncios: ~8 GB) |
| Região ampliada: 30 municípios, 2 mil anúncios, 50 mil usuários | ~1,5 GB | ~30 a 70 GB |
| Estado de MG inteiro no CAR (~1 milhão de áreas, sem anúncios) | +2,7 GB só do CAR | — |

## Conclusões

- **Plano gratuito do Supabase não serve para produção**: 500 MB de banco e 1 GB de storage
  estouram no primeiro mês de anúncios reais, e não há backup com retenção (item 1.6).
- **Plano Pro** (cerca de US$ 25/mês, decisão 8.8 do Carlos) cobre o piloto e a região ampliada:
  8 GB de banco e 100 GB de storage incluídos, backup diário.
- **Vídeos** são o que mais cresce. Se passarem de 50 GB, mover para o Cloudflare R2
  (sem custo de saída) já previsto na arquitetura.
- **CAR do estado inteiro** cabe, mas os tiles vetoriais (migration 0031) é que tornam isso viável;
  o índice espacial em `geom_3857` mantém o tempo do tile estável.
- **Eventos** (`property_events`, `audit_log`, `auth_events`) crescem com o tráfego, não com os
  anúncios. Com 50 mil usuários ativos, estimar ~1 GB por ano; a retenção configurável (item 6.4)
  controla isso.

## Como medir de novo

```bash
node scripts/sql.mjs "select relname, pg_size_pretty(pg_total_relation_size(c.oid)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by pg_total_relation_size(c.oid) desc limit 15"
```

## Fotos e vídeos dos anúncios (08/10/2026)

**Para não sobrecarregar o servidor:**
- Fotos são reduzidas **no aparelho de quem anuncia**, antes de subir (`src/lib/midia/comprimirFoto.ts`):
  WebP de até 2.048 px, qualidade 0,82, sem EXIF (some o GPS da foto). Medido: foto de 12 MP de
  6,3 MB → 0,21 MB em 0,5 s. 20 fotos passam de até 400 MB para ~5 MB por anúncio.
- Vídeos **não passam pelo servidor do site**: o navegador manda direto ao armazenamento com
  autorização de uso único (`/api/imoveis/[id]/midia`), até 500 MB e 3 por imóvel.
- Depois do envio, o worker converte o vídeo (`worker/jobs/otimizarVideo.mjs`): MP4 H.264 720p, AAC,
  `faststart`, sem metadados, mais uma capa em JPEG. Resolve o vídeo HEVC/.mov do iPhone (não toca no
  Chrome/Android) e reduz 4–6× o peso para quem assiste. O original só é apagado depois que o
  otimizado subiu. O player só baixa o vídeo quando a pessoa aperta o play (`preload="metadata"`).

**Quanto ocupa (estimativa):** 15 fotos × ~0,4 MB + 1 vídeo de 1 min (~8 MB otimizado) ≈ **15 MB por anúncio**.

| Anúncios | Armazenamento | Custo no Supabase Pro (100 GB incluídos) | Custo na Cloudflare R2 (US$ 0,015/GB, saída grátis) |
|---|---|---|---|
| 1.000 | ~15 GB | incluído | ~US$ 0,25/mês |
| 10.000 | ~150 GB | +US$ 1,30/mês de espaço | ~US$ 2,25/mês |
| 50.000 | ~750 GB | +US$ 16/mês de espaço | ~US$ 11/mês |

**O custo que importa é o tráfego, não o espaço.** O Supabase Pro inclui 250 GB de saída/mês e cobra
~US$ 0,09/GB acima disso; quem abre um anúncio baixa ~3–5 MB de fotos. Com ~60 mil visualizações de
anúncio por mês o tráfego passa do incluído. **Quando isso acontecer, migrar o bucket `media` para a
Cloudflare R2** (saída sem custo, servida pela mesma CDN do mapa): os caminhos `properties/<id>/...`
continuam os mesmos, muda só a URL base de `mediaUrl()` e o destino da autorização de envio.

**Ciclo de vida:** mídia de anúncio reprovado ou inativo entra no descarte por prazo
(Configurações › Segurança, rotina `descarte_retencao`), quando o Carlos definir os prazos (8.9).
