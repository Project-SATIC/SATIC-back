# SATIC-back — TypeScript + Express + PostgreSQL

Back-end do **SATIC** (*Sistema de Alocação de Turmas do Instituto de Computação — UFAL*) desenvolvido em **TypeScript + Express**, com persistência relacional em **PostgreSQL** (suportando tanto PostgreSQL 16+ externo/Docker quanto **PGlite** embarcado para desenvolvimento local), modelo de **aulas de 50 minutos**, **Motor de Busca em Espaço de Estados (MRV + Best-Fit)**, **Motor de Sugestões de Horário + Sala** em `Worker Threads`, **Logs Estruturados JSON** e **Histórico Transacional de Auditoria**.

---

## Estrutura do Projeto

* **`docker-compose.yml` e `ts/Dockerfile`**: Orquestração completa dos serviços `satic-postgres` (`postgres:16-alpine`) e `satic-api` (`node:22-alpine` não-root com `HEALTHCHECK` e `AUTO_MIGRATE`/`AUTO_SEED`).
* **`docs/`**
  * [`api-contratos-frontend.md`](docs/api-contratos-frontend.md): Especificação completa de todas as rotas REST (consultas, CRUD, geração, confirmação em lote, sugestões, publicação, fila assíncrona e auditoria).
  * [`modelo-aulas-e-motor-de-sugestoes.md`](docs/modelo-aulas-e-motor-de-sugestoes.md): Modelo de aulas de 50 minutos (`M1–M6`, `T1–T6`, `N1–N4`, `SEG–SAB`), turnos por curso (`CC`, `EC`, `IA`) e arquitetura do motor de sugestões em 3 estágios.
  * [`registro-migracao-typescript.md`](docs/registro-migracao-typescript.md): Histórico da evolução arquitetural para TypeScript + Express + PostgreSQL.
  * [`satic_er_chen.drawio`](docs/satic_er_chen.drawio): Diagrama Entidade-Relacionamento (DER) na notação de Peter Chen.
* **`ts/`**
  * **`migrations/001..006`**:
    * `001_criar_schema_inicial.sql`: 7 tabelas principais do modelo lógico.
    * `002_integridade_alocacao.sql`: `UNIQUE(id_turma)` e `CHECK` constraints de domínio.
    * `003_aulas_semanais_e_curso_ia.sql`: coluna `aulas_semanais` e curso `IA` noturno.
    * `004_auditoria_alocacao.sql`: coluna e trigger `atualizado_em`.
    * `005_campos_espacos_preferencias_publicacao.sql`: `status` (`Disponível`/`Manutenção`), `pcs`, `equipamentos`, `observacao` em `sala`; `preferencias_horario`; `semestre_publicacao`; `regime`, `carga_max` e `permitir_mudar_formato`.
    * `006_historico_auditoria.sql`: tabela `auditoria_log` e triggers PL/pgSQL com snapshots `JSONB`.
  * **`src/shared/`**: Tipos (`tipos.ts`), parser SIGAA (`horario-sigaa.ts`), modelo de grade de 50 min (`grade.ts`) e validador isomórfico (`validador.ts`), também servidos ao navegador via `GET /shared/*.js`.
  * **`src/motor/`**: `StateSpaceSearch`, `sugestoes.ts`, `AlocadorService`, `RemanejamentoService`, `SugestoesService`, `motor-worker.ts` e `fila-motor.service.ts`.
  * **`src/db/`**: Conexão e transações (`connection.ts`), `migrator.ts` e repositórios (`SalaRepository`, `ProfessorRepository`, `DisciplinaRepository`, `TurmaRepository`, `AlocacaoRepository`, `AuditoriaRepository`).
  * **`src/api/`**: Servidor Express 5 (`app.ts`, `server.ts`), `logger.ts` e rotas REST (`routes/`).
  * **`test/`**: Suíte completa de testes unitários, regressão de gabaritos, PGlite e integração PostgreSQL real.

---

## Como Executar

### Opção 1: Execução Local Imediata (PGlite — sem Docker)
```powershell
cd ts
npm install
npm run local          # Sobe PGlite + migrations 001..006 + seed 2026.2 + grade inicial + API em http://localhost:3001
# Ou com a amostra de 17 turmas reais para testes manuais:
npm run local:amostra
```

### Opção 2: PostgreSQL 16 via Docker ou Local
```powershell
docker compose up -d
cd ts
npm install
npm run migrate
npm run db:seed
npm start
```

### Verificação e Testes
```powershell
cd ts
npm run typecheck      # Checagem estrita de tipos TypeScript (tsc --noEmit)
npm test               # Suíte completa (172 testes, incluindo PostgreSQL real via PGlite)
```
