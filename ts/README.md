# SATIC-back — Versão TypeScript + Express + PostgreSQL

Back-end do **SATIC** (*Sistema de Alocação de Turmas do Instituto de Computação — UFAL*) em **TypeScript + Express**, com persistência relacional em **PostgreSQL**.

---

## 🚀 Como Executar

### 1. Pré-requisitos
* **Node.js 22.18+** (suporte nativo a execução TypeScript via type stripping).
* **PostgreSQL 16+** (instalado localmente ou via Docker).

### Atalho: banco local sem Docker nem instalação
```powershell
cd ts
npm install
npm run local          # PostgreSQL (PGlite) + migrations + seed (se vazio) + grade inicial + API em http://localhost:3001
npm run local:amostra  # o mesmo, só com 17 turmas reais para testes manuais (dados em ts/.pglite-amostra)
```
* Os dados ficam em `ts/.pglite/` (fora do git) e sobrevivem a reinícios. `npm run local -- --resetar` recria tudo do zero.
* Num banco recém-criado, o script já gera a grade inicial com o motor. Não é preciso chamar `/api/alocacoes/gerar` à mão.
* **Amostra para testes manuais** (`src/seed/amostra.ts`): 17 turmas reais de 2026.2, todas as 19 salas e as 2 reservas externas. Cada turma está lá para facilitar o teste de uma regra: indisponibilidade (Ranilson, SEX T5–T6), choque docente, co-docência, 4 aulas num dia, horário diferente em cada dia, sábado, turma conjunta grande, IA à noite e reservas fixas. Fica numa pasta própria, então o banco completo não é tocado. Para rodar a amostra junto do banco completo, use outra porta (`$env:PORT=3101; npm run local:amostra`) e abra o front com `?api=http://localhost:3101`. Num PostgreSQL de verdade: `npm run db:seed -- --amostra`.
* `npm run db:local` sobe só o banco (porta 5432, ou `-- --porta=5433`). Para usar com `npm start` em outro terminal, defina `PGPOOL_MAX=1`.
* Com `npm run local` o banco usa uma porta livre qualquer (só a API do mesmo processo o acessa), então não briga com um PostgreSQL instalado na 5432.
* **Uma instância por vez.** Dois bancos abrindo `ts/.pglite/` ao mesmo tempo poderiam corromper os dados. Por isso o script cria a trava `ts/.pglite.lock` (com o PID) e confere as portas antes de abrir a pasta. Se já houver um SATIC local rodando, ele avisa, diz como usar ou encerrar o anterior e não inicia. Uma trava de processo que já terminou é descartada sozinha.
* Fechar o terminal nem sempre encerra o processo. Se a API continuar respondendo em `:3001`, encerre-a com:
  ```powershell
  Stop-Process -Id (Get-NetTCPConnection -LocalPort 3001 -State Listen).OwningProcess
  ```
* O PGlite é um PostgreSQL 18 real compilado para WebAssembly, mas com uma única sessão. Serve para desenvolvimento e para integrar o front, não para produção. Para produção, use os passos abaixo.

### 2. Executar com Docker Compose (PostgreSQL 16 + API SATIC-back)
Na raiz do repositório (`SATIC-back/`):
```powershell
docker compose up -d --build
```
* O container `satic-postgres` sobe com `healthcheck` (`pg_isready`).
* O container `satic-api` (`ts/Dockerfile`, Node 22 Alpine, usuário não-root) aguarda o banco ficar saudável, executa automaticamente as migrations `001` a `006` (`AUTO_MIGRATE=true`), popula a oferta 2026.2 e gera a grade inicial caso o banco esteja vazio (`AUTO_SEED=true`), expondo a API em `http://localhost:3001`.
* Para subir apenas o banco via Docker e rodar a API localmente no host:
```powershell
docker compose up -d postgres
```
As credenciais padrão estão no arquivo `.env`:
```env
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=postgres
PGDATABASE=satic
```

### 3. Rodar as Migrations e o Seed
Dentro da pasta `ts/`:
```powershell
cd ts
npm run migrate     # 001: 7 tabelas do modelo lógico; 002: integridade (1 alocação/turma, status, CHECKs); 003: aulas_semanais e IART como IA
npm run db:seed     # Salas, docentes e ofertas 2026.2 + as 2 reservas EXTERNA_FIXA (IF0001-05, FALE0002-03)
```

### 4. Iniciar a API Express
```powershell
npm start           # Inicia em http://localhost:3001
# ou para desenvolvimento com hot-reload:
npm run dev
```

### 5. Rodar a Suíte de Testes e Checagem de Tipos
```powershell
npm run typecheck   # tsc --noEmit (strict: true)
npm test            # 151 testes; não precisa instalar PostgreSQL (test/postgres-real.test.ts sobe um PostgreSQL real em memória com o PGlite)
```

---

## 📡 Documentação da API

Os contratos detalhados de requisição, resposta e guia de integração para o front-end estão disponíveis em:
👉 **[`docs/api-contratos-frontend.md`](../docs/api-contratos-frontend.md)**

### Resumo das Rotas:
| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/api/health` | Diagnóstico da API e status da conexão com PostgreSQL |
| `GET` | `/api/turmas` | Lista turmas ofertadas (filtros: `semestre`, `requer_ic`) |
| `GET` | `/api/turmas/:id` | Detalhes de uma turma específica |
| `GET` | `/api/salas` | Catálogo de salas físicas (filtros: `alocavel_ic`, `bloco`) |
| `GET` | `/api/salas/:id` | Detalhes de uma sala específica |
| `GET` | `/api/professores` | Lista docentes e restrições de indisponibilidade (RN-02) |
| `GET` | `/api/disciplinas` | Lista disciplinas da matriz |
| `GET` | `/api/alocacoes` | Lista alocações salvas (filtro: `semestre`) |
| `POST` | `/api/alocacoes/gerar` | Executa o motor (MRV + Best-Fit) e troca os RASCUNHO numa transação, preservando EXTERNA_FIXA e DEFINITIVA |
| `POST` | `/api/alocacoes/validar` | Validação ágil de drag-and-drop sem persistir |
| `POST` | `/api/alocacoes/confirmar` | Valida e salva o remanejamento (retorna 409 se inválido); `salaId` opcional |
| `POST` | `/api/alocacoes/confirmar-lote` | "Confirmar tudo": aplica o rascunho do front (200 / 207 parcial / 409) |
| `GET` | `/api/alocacoes/conflitos` | Conflitos e pendências do semestre |
| `POST` | `/api/alocacoes/sugestoes` | Motor de sugestões: horário + sala para os conflitos, sem gravar |
| `GET` | `/shared/*.js` | Parser SIGAA, modelo de grade e validador como módulos ES para o navegador |

O modelo de **aulas de 50 minutos**, as regras de formato, os turnos por curso (CC/EC manhã e tarde, IA noite) e o motor de sugestões estão explicados em [`docs/modelo-aulas-e-motor-de-sugestoes.md`](../docs/modelo-aulas-e-motor-de-sugestoes.md).

---

## 🧭 Regras de persistência e robustez

* **Uma alocação por turma** (`UNIQUE (id_turma)` na migration 002). Status: `RASCUNHO` (proposta do motor), `DEFINITIVA` (confirmada pela secretaria) e `EXTERNA_FIXA` (turma de outro instituto em sala do IC).
* **`/gerar` não apaga reservas externas nem remanejamentos confirmados**: só os `RASCUNHO` são trocados, numa única transação.
* **Lock por semestre** (`pg_advisory_xact_lock`): `/gerar` e `/confirmar` do mesmo semestre nunca gravam em paralelo, nem entre processos.
* **RN-01/RN-02 com dados do banco**: toda turma carregada (inclusive dentro de uma alocação) vem com docentes e indisponibilidades, hidratados em lote.
* **Ordenação binária** (`COLLATE "C"`) nas consultas que alimentam o motor, para o resultado não depender da collation do servidor e bater com o Java.
* **Erros**: 400 para entrada inválida, 404 para recurso inexistente, 409 para regra violada, 503 para banco indisponível (`src/erros.ts` + handler em `src/api/app.ts`). Com `NODE_ENV=production`, detalhes internos de banco são omitidos das respostas 500/503.
* **`CORS_ORIGIN`** (opcional, no `.env`): lista de origens aceitas, separadas por vírgula. Sem ela, qualquer origem é aceita (uso local). Em servidor interno do IC/UFAL, defina `NODE_ENV=production` e `CORS_ORIGIN`.
