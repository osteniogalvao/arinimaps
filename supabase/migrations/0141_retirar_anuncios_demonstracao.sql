-- Arquiva os 40 anúncios identificados nos seeds de agosto e outubro.
-- A identidade tripla protege imóveis reais em outros ambientes.
alter table public.properties add column demonstracao boolean not null default false;

with demonstracao(id,codigo,titulo) as (values
  ('a8a8fdcd-b845-46ba-b2fe-b41c94fd5e9b'::uuid, 'AIB-000001', 'Fazenda Boa Vista'),
  ('2a088eb4-2fe7-4caf-9368-fa77e92b809e'::uuid, 'AIB-000002', 'Sítio Água Limpa'),
  ('fdffe41c-488b-461f-b8e6-d588ca718ad2'::uuid, 'AIB-000003', 'Lote Av. Prefeito Juca Padua'),
  ('3c1ee3c8-e3af-4aa3-b228-f370cadf9ced'::uuid, 'AIB-000023', 'Chácara Recanto do Ipê'),
  ('94c04692-9baf-483f-acd6-ce4255fa5c39'::uuid, 'AIB-000024', 'Sítio Santa Luzia'),
  ('217cb886-028e-43b0-b5b2-448749fe7d24'::uuid, 'AIB-000025', 'Fazenda Córrego Fundo'),
  ('526307a5-fe6e-4916-8753-8b9bf63eaa4f'::uuid, 'AIB-000026', 'Fazenda Três Barras'),
  ('c069eaf9-74f3-4ed1-a8ff-d69dfe6d8e04'::uuid, 'AIB-000027', 'Lote central — Quadra 35'),
  ('d6417893-c4a0-48c3-a9f0-675d03eb61ff'::uuid, 'AIB-000028', 'Lote residencial — Quadra 15'),
  ('5542261e-5cdd-4874-bdda-651715b2c7c5'::uuid, 'AIB-000029', 'Chácara Bela Vista'),
  ('ace329a4-158f-4da5-a673-1768cf4a56b1'::uuid, 'AIB-000030', 'Sítio Boa Esperança'),
  ('1def7803-cbd2-4d6e-a72d-93469531a27c'::uuid, 'AIB-000031', 'Fazenda São Sebastião'),
  ('41ccd2df-4a79-48ef-8ee0-f0b9291f7464'::uuid, 'AIB-000032', 'Lote de esquina — Quadra 41'),
  ('48500375-7297-4ede-b537-292e21091bdd'::uuid, 'AIB-000033', 'Terreno amplo — Quadra 33'),
  ('8ca87f7b-59e1-408b-8130-34bfdc7fc5db'::uuid, 'AIB-000034', 'Lote residencial — Quadra 16'),
  ('577afbb7-e34f-4389-8a80-bcd6c0c65c6c'::uuid, 'AIB-000035', 'Chácara Santa Rita'),
  ('14f00314-edef-44b6-9613-8ef0d5605c7f'::uuid, 'AIB-000036', 'Fazenda Recanto Verde'),
  ('9235a398-0f98-48f5-a620-22c76ebe009b'::uuid, 'AIB-000037', 'Sítio Bom Jardim'),
  ('577cc403-f6f1-4ab5-9324-3af3d0ef42e1'::uuid, 'AIB-000038', 'Fazenda Pôr do Sol'),
  ('5d262816-8547-453d-bb1e-8f691c690673'::uuid, 'AIB-000039', 'Fazenda Ouro Verde'),
  ('b8b5872e-e1c8-4fab-8b74-3e53336dcc08'::uuid, 'AIB-000040', 'Sítio Três Irmãos'),
  ('01b60040-c4a0-4a17-b4f4-b55d027036d5'::uuid, 'AIB-000041', 'Fazenda Água Branca'),
  ('9a4c3066-acc1-4192-8e33-ea4593642ce5'::uuid, 'AIB-000042', 'Chácara Sabiá'),
  ('1563444b-3012-49fd-b756-aab810c15bd9'::uuid, 'AIB-000043', 'Fazenda Estrela do Pontal'),
  ('0d2e6d4d-5285-4e74-aeb5-5feeaae064c9'::uuid, 'AIB-000044', 'Sítio Paineiras'),
  ('a5104995-a068-4610-b67b-a7febfe8f51b'::uuid, 'AIB-000045', 'Fazenda Barreiro'),
  ('291408b0-1509-4112-ab36-5698ca7dfb75'::uuid, 'AIB-000046', 'Lote comercial — Quadra 11, lote 19'),
  ('9f506e39-068a-4d0e-bc10-ba76c3f82bec'::uuid, 'AIB-000047', 'Lote residencial — Quadra 03, lote 08'),
  ('4322f05c-adfb-44cc-a034-148e7634b27a'::uuid, 'AIB-000048', 'Terreno — Quadra 04, lote 17'),
  ('14825e6f-90aa-4aa7-b4dc-c3286648c1eb'::uuid, 'AIB-000049', 'Lote de meio de quadra — Quadra B, lote 10'),
  ('0fa2dff0-e716-4532-93ac-1b016c7f4f3f'::uuid, 'AIB-000050', 'Lote de meio de quadra — Quadra 22, lote 08'),
  ('cd0d216c-857d-49af-9c16-b58e4cf6a90c'::uuid, 'AIB-000051', 'Terreno — Quadra 10, lote 4'),
  ('f9038192-a860-4cf3-ba04-2108b1891484'::uuid, 'AIB-000052', 'Terreno — Quadra 01, lote 10'),
  ('f9714f97-aef6-4002-982d-3f2ff4eb8a3a'::uuid, 'AIB-000053', 'Lote comercial — Quadra 24, lote 03'),
  ('2eeb76bd-1849-4d3b-a72a-4d417cb59766'::uuid, 'AIB-000054', 'Lote de meio de quadra — Quadra 26, lote 02'),
  ('15c70919-263e-40a7-b21f-e8cd6aaffaea'::uuid, 'AIB-000055', 'Terreno — Quadra 75, lote 18'),
  ('4558e361-a921-40a0-b61c-9510d5ff90a6'::uuid, 'AIB-000056', 'Terreno — Quadra 15, lote 04'),
  ('4dada682-eed4-475d-aac0-8e273832ce18'::uuid, 'AIB-000057', 'Lote comercial — Quadra 20, lote 15'),
  ('95b49998-e1bd-47d4-aa5e-eb937b92e8af'::uuid, 'AIB-000058', 'Terreno — Quadra 29, lote 09'),
  ('b56f2585-a389-48d3-b6b4-3637b035a00a'::uuid, 'AIB-000059', 'Lote residencial — Quadra 97, lote 6')
)
update public.properties p
set demonstracao=true, status=case when p.status='vendido' then 'historico'::public.property_status else 'inativo'::public.property_status end
from demonstracao d
where (p.id,p.codigo,p.titulo)=(d.id,d.codigo,d.titulo) and p.status in ('vendido','publicado');
