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
npm run local       # PostgreSQL (PGlite) + migrations + seed (se vazio) + API em http://localhost:3001
```
* Os dados ficam em `ts/.pglite/` (fora do git) e sobrevivem a reinícios. `npm run local -- --resetar` recria tudo do zero.
* `npm run db:local` sobe só o banco (porta 5432, ou `-- --porta=5433`). Para usar com `npm start` em outro terminal, defina `PGPOOL_MAX=1`.
* Com `npm run local` o banco usa uma porta livre qualquer (só a API do mesmo processo o acessa), então não briga com um PostgreSQL instalado na 5432.
* **Uma instância por vez.** Dois bancos abrindo `ts/.pglite/` ao mesmo tempo poderiam corromper os dados. Por isso o script cria a trava `ts/.pglite.lock` (com o PID) e confere as portas antes de abrir a pasta. Se já houver um SATIC local rodando, ele avisa, diz como usar ou encerrar o anterior e não inicia. Uma trava de processo que já terminou é descartada sozinha.
* Fechar o terminal nem sempre encerra o processo. Se a API continuar respondendo em `:3001`, encerre-a com:
  ```powershell
  Stop-Process -Id (Get-NetTCPConnection -LocalPort 3001 -State Listen).OwningProcess
  ```
* O PGlite é um PostgreSQL 18 real compilado para WebAssembly, mas com uma única sessão. Serve para desenvolvimento e para integrar o front, não para produção. Para produção, use os passos abaixo.

### 2. Configurar o Banco de Dados (PostgreSQL)
Você pode subir o PostgreSQL via Docker na raiz do projeto:
```powershell
docker compose up -d
```
Ou usar seu PostgreSQL local. As credenciais padrão estão no arquivo `.env`:
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
npm run migrate     # 001: 7 tabelas do modelo lógico; 002: restrições de integridade (1 alocação por turma, status, CHECKs)
npm run db:seed     # Salas, docentes e ofertas 2026.2 + as 2 reservas EXTERNA_FIXA (IF0001-05, FALE0002-03)
```

### 4. Iniciar a API Express
```powershell
npm start           # Inicia em http://localhost:3001
# ou para desenvolvimento com hot-reload:
npm run dev
```

### 5. Rodar a Suíte de Testes
```powershell
npm test            # 133 testes; não precisa instalar PostgreSQL (test/postgres-real.test.ts sobe um PostgreSQL real em memória com o PGlite)
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
* **Erros**: 400 para entrada inválida, 404 para recurso inexistente, 409 para regra violada, 503 para banco indisponível (`src/erros.ts` + handler em `src/api/app.ts`).
* **`CORS_ORIGIN`** (opcional, no `.env`): lista de origens aceitas, separadas por vírgula. Sem ela, qualquer origem é aceita.
