# Modelo de aulas de 50 minutos e motor de sugestões

**Data:** 19/11/2026 · **Branch:** `ts-back-dev` · **Situação:** back-end implementado; integração com o front em andamento

Este documento registra as decisões tomadas com a equipe antes de ligar o front-end à API e o que foi implementado a partir delas.

---

## 1. Como a grade funciona na pós-oferta

1. O **coordenador do curso** conversa com os professores e monta a pré-grade (disciplina, professor, horário, sala desejada).
2. A **secretaria** recebe a pré-grade, lança no SATIC, confere conflitos, resolve o que precisar (pode mudar horário, sala e professor) e publica no SIGAA.

O SATIC trabalha nessa segunda etapa. A secretaria tem autonomia para editar tudo.

## 2. Aulas de 50 minutos

Uma turma ocupa um **conjunto de aulas de 50 minutos**, e não um "bloco de 2 aulas repetido". Cada aula é `DIA-TURNO+ÍNDICE`, por exemplo `TER-M3`, e é exatamente o que o parser SIGAA já produz: `35M34` vira `TER-M3, TER-M4, QUI-M3, QUI-M4`.

Isso cobre todos os casos reais de 2026.2:

| Caso | Exemplo |
|---|---|
| 2 aulas em 2 dias | `24M34` |
| 4 aulas seguidas num dia | `6M3456` |
| Horário diferente em cada dia | `2T56 6T12` |
| 4 dias × 4 aulas (COMP382, 4 docentes) | `2345M3456` |
| Noite (IA) | `4N1234` |
| Sábado | `7M45` |

### Relógio

| Aula | Manhã | Tarde | Noite |
|---|---|---|---|
| 1 | 07:30–08:20 | 13:30–14:20 | 19:00–19:50 |
| 2 | 08:20–09:10 | 14:20–15:10 | 19:50–20:40 |
| 3 | 09:20–10:10 | 15:20–16:10 | 20:50–21:40 |
| 4 | 10:10–11:00 | 16:10–17:00 | 21:40–22:30 |
| 5 | 11:10–12:00 | 17:10–18:00 | — |
| 6 | 12:00–12:50 | 18:00–18:50 | — |

### Cursos e turnos

| Curso | Turnos |
|---|---|
| CC — Ciência da Computação | manhã e tarde |
| EC — Engenharia de Computação | manhã e tarde |
| IA — Inteligência Artificial | só noite (N1–N4) |

IA é o único curso noturno, então quase não tem conflitos. A dificuldade da grade está na manhã e na tarde, onde CC e EC convivem. Turmas conjuntas CC + EC ficam na manhã ou na tarde.

> **Correção de dados:** a oferta importada do SIGAA/Java traz as disciplinas `IART*` como curso `CC`. A migration 003 e o seed do banco as gravam como `IA`. A base em memória (`seed/seeder.ts`) continua como no Java, para os gabaritos de equivalência.

## 3. Regras de formato do horário

Valem quando a secretaria muda um horário e quando o motor sugere um:

| Regra | Tipo | Código |
|---|---|---|
| O número de aulas por semana não muda (`aulas_semanais` no cadastro) | rígida | `FORMATO` |
| No máximo um bloco contínuo por dia: sem buraco e sem dois turnos no mesmo dia | rígida | `FORMATO` |
| Um bloco não cruza turno (consequência da regra acima) | rígida | `FORMATO` |
| Só turnos do curso da turma | rígida | `TURNO` |

A oferta real de 2026.2 já cumpre todas. `aulas_semanais` fica no cadastro para a turma continuar sabendo quantas aulas precisa mesmo quando ficar sem horário. A carga horária da disciplina não serve para isso: uma disciplina de 75h tem 2 aulas por semana.

Essas regras ficam em `ts/src/shared/grade.ts` e entram no `diagnosticarViolacoes`, junto com as que já existiam.

## 4. Impedimentos (regras de alocação)

| Código | Regra |
|---|---|
| `RN-01` | Professor em duas turmas no mesmo horário. Na co-docência, **todos os docentes contam em todas as aulas** da turma. |
| `SALA` | Duas turmas na mesma sala com aulas sobrepostas. |
| `RN-02` | Aula numa janela bloqueada de algum docente. |
| `RN-03` | Mais alunos que lugares. |
| `RN-04` | Disciplina que exige laboratório em sala comum. |
| `ESCOPO` | Turma do IC em sala fora do pool do IC (CTEC, IF). |
| `FORMATO` / `TURNO` | Seção 3. |

Os choques costumam estar ligados: mudar uma turma de horário muitas vezes resolve o choque de sala e o de docente de uma vez.

**Uma sala por turma.** Todas as aulas da semana ficam na mesma sala, como no cadastro do SIGAA.

**Pendente** é a turma sem sala, sem docente ou sem horário.

## 5. Mudanças feitas pela secretaria

- O arrasto na grade move aulas de 50 minutos. O ideal combinado é selecionar várias aulas em área, ou puxar o bloco pelo cabeçalho do primeiro card. O mínimo aceitável é mover uma aula por vez. O destino precisa ter espaço para todas.
- As mudanças **se acumulam como rascunho** no navegador e são validadas na hora, com o mesmo código do servidor (`/shared/*.js`). "**Confirmar tudo**" envia o lote e "**Descartar**" volta ao que está salvo.
- O servidor valida o **estado final do lote**, e não um movimento por vez. Assim, uma troca entre duas turmas é aceita. O teste no navegador mostrou que, validando um por vez, cada lado batia no outro.
- O motor de sugestões recebe o rascunho (`movimentos`) e o aplica só em memória, para enxergar os conflitos criados no navegador antes de confirmar.
- **Sala ao mover:** se a sala atual continua livre e válida no novo horário, a turma fica nela. Se não, o servidor sugere a melhor sala livre (o mesmo critério do motor: sala comum antes de laboratório para disciplina teórica, e a menor sala que comporta a turma). A secretaria pode trocar antes de confirmar.

## 6. Motor de sugestões (horário + sala)

### Histórico

O protótipo original ([VictorSamyr/state-space-search](https://github.com/VictorSamyr/state-space-search), importado no commit `81a349d`) **atribuía horários**: 30 blocos de 100 minutos (SEG–SEX × M/T × 12/34/56) com restrições de dia e turno. No commit `3328549` (12/11), o motor passou a receber o horário pronto do SIGAA e a escolher **só a sala** (MRV + Best-Fit), e o porte para TypeScript copiou esse comportamento. O motor de sugestões junta as duas coisas, agora em aulas de 50 minutos. O motor de salas (`state-space-search.ts`) continua intacto e com os gabaritos do Java.

### Quando é usado

- Na **Central de Conflitos**, pelo botão "Resolver via motor".
- No **"Gerar grade"**, que consolida a grade: verifica os conflitos, chama o motor e libera a exportação (ICS, PDF via impressão e CSV).

### O que ele faz

O motor **sugere, nunca aplica sozinho**. Turmas `DEFINITIVA` (confirmadas) e `EXTERNA_FIXA` nunca entram nas sugestões. As etapas vão da mudança mais barata para a mais cara, porque **trocar sala é preferível a mudar horário** (o horário foi combinado com o professor):

0. **Quem mantém o horário:** das turmas maiores para as menores, cada turma-alvo fica no horário atual se ele não bater com as demais. Assim, num choque de docente entre uma turma de 16 aulas e uma de 4, é a de 4 que muda.
1. **Só salas (etapa A):** as turmas que mantêm o horário são redistribuídas nas salas pelo motor atual (MRV + Best-Fit).
2. **Horário + sala (etapa B):** para as outras, gera horários candidatos **no mesmo formato** (2+2 continua 2+2) e nos turnos do curso, do mais parecido com o atual para o menos. Escolhe o primeiro sem choque de docente ou indisponibilidade que tenha sala livre.
3. **Mexer em outra turma (etapa C):** se ainda não couber, tenta liberar uma sala movendo **de sala**, sem mudar o horário, uma turma em rascunho que não estava em conflito.

O resultado traz um **plano** que resolve o máximo de turmas juntas e até 3 **alternativas por turma**, ordenadas pelo custo (horário pesa 10, sala pesa 1).

### Formato

Por padrão, o motor mantém os tamanhos dos blocos. Cada turma pode permitir **mudar o formato** (por exemplo, 2+2 virar 4 num dia ou 1+1+1+1), com o aviso de que a busca fica mais lenta. Hoje isso é um parâmetro da requisição (`permitirMudarFormato`). A configuração salva por turma está reservada em `PATCH /api/turmas/:id/motor`.

### Limites

A busca é **heurística e limitada** (200.000 nós por padrão). Ela não testa todas as combinações, então não garante o mínimo absoluto de mudanças. Com o formato livre, cada formato recebe uma cota igual de candidatos. Na base real, resolver 7 conflitos provocados levou cerca de 0,3 s.

**Ainda não faz:** mudar o *horário* de outras turmas (a etapa C só troca sala) e usar a disponibilidade "preferencial" dos professores como critério.

## 7. O que ficou só no navegador e módulos pendentes

Estas funções do front continuam funcionando apenas na sessão do navegador ou seguem pendentes (fora do escopo atual). As rotas estão reservadas, como comentário, nos routers:

| Função | Situação / Rota reservada |
|---|---|
| Cadastro e edição de espaços, status "Manutenção" | Só navegador (`POST/PUT /api/salas`, `PATCH /api/salas/:id/status`) |
| Disponibilidade "preferencial" do professor | Só navegador (`PUT /api/professores/:siape/disponibilidade`) |
| Cadastro e edição de turmas e troca de docentes | Só navegador (`POST/PUT /api/turmas`, `PUT /api/turmas/:id/professores`) |
| "Permitir mudar formato" salvo por turma | Só parâmetro de requisição (`PATCH /api/turmas/:id/motor`) |
| Publicar a grade | Só navegador (`POST /api/alocacoes/publicar`) |
| Exportação gerada no servidor | Só navegador gera ICS, PDF da grade oficial e CSV (`GET /api/alocacoes/exportar`) |
| Exportação **"Grade por professor (PDF)"** | **Pendente / fora de escopo atual** (não é requisito funcional no momento; botão exibe aviso de não implementada) |
| Exportação **"Planilha SIAP (XLSX)"** | **Pendente / não implementada** |
| Prioridades do gerador ("agrupar horários", "preferências") | Pendente no motor de sugestões (seção 6) |
| Autenticação/autorização da API | **Uso local ou intranet restrita do IC/UFAL** (não público na internet). Em servidor interno, rodar com `NODE_ENV=production` (oculta `detalhes` internos em erros 500/503) e `CORS_ORIGIN` configurado; se exposto externamente, adicionar autenticação/proxy. |

Quando a API ou o banco estão fora do ar, o front mostra um aviso com "Tentar de novo". Não existe modo de demonstração com dados de exemplo.

## 8. Endpoints novos

Detalhes em [`api-contratos-frontend.md`](./api-contratos-frontend.md).

| Método | Rota | Para quê |
|---|---|---|
| `GET` | `/shared/{grade,horario-sigaa,tipos,validador}.js` | Mesmo parser e validador do servidor, como módulo ES para o navegador |
| `POST` | `/api/alocacoes/validar` | `salaId` agora é opcional (o servidor mantém ou sugere a sala) |
| `POST` | `/api/alocacoes/confirmar` | idem |
| `POST` | `/api/alocacoes/confirmar-lote` | "Confirmar tudo": aplica uma lista de movimentos, inclusive `acao: "remover"` |
| `GET` | `/api/alocacoes/conflitos` | Conflitos e pendências do semestre |
| `POST` | `/api/alocacoes/sugestoes` | Motor de sugestões (horário + sala), sem gravar |
