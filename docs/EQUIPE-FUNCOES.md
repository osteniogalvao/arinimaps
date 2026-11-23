# Equipe e funções por setor

Migration **0161** (roda depois da 0160). Tela: **Central › Equipe e funções**
(`/admin/equipe`), no menu de todo mundo da equipe.

## O que cada um faz

| Quem | Vê | Organiza |
|---|---|---|
| Equipe | quem está em cada setor, a função e o gestor (para saber a quem delegar) | nada |
| Gestor do setor | igual, mais os e-mails | libera e retira o acesso **do setor que gere**, define a função de quem está nele e cria login novo só com os setores que gere |
| Diretoria | tudo | tudo, e é quem **nomeia e tira gestores** |

- **Função** (cargo) é rótulo: Corretor, Captador, Recepcionista, Gerente de Locação...
  O que a pessoa acessa continua saindo dos setores marcados.
- Retirar a pessoa do setor também tira o "gestor" daquele setor (o banco garante).
- Ninguém vira Diretoria nem é desativado por aqui: isso continua em
  **Equipe e usuários** (`/admin/usuarios`). A recepção do WhatsApp continua em
  **Menu do WhatsApp e recepção**; aqui ela só aparece como etiqueta.
- As colunas novas (`profiles.cargo`, `profiles.setores_gestor`) não podem ser
  alteradas pela API pública (lista fechada da policy da 0036): só o servidor grava.
- Sem a 0161 a tela abre e os setores podem ser liberados/retirados; função e
  gestor aparecem quando a migration rodar.

## Para integrar a equipe

1. Diretoria abre Equipe e funções, cria o acesso de cada pessoa (ou libera o setor
   para quem já tem login) e define a função.
2. Marca um gestor por setor ("Tornar gestor"). Daí em diante o gestor organiza o próprio setor.
3. Atendimento: quem faz triagem da caixa central é marcado em Menu do WhatsApp e recepção.
