# Registro de mudança: back-end Java → TypeScript + Express + PostgreSQL

**Data inicial:** 17/11/2026 · **Atualizado em:** 22/11/2026 · **Situação:** etapas 1 a 3 concluídas (núcleo, banco PostgreSQL e API Express)

## O que mudou

Criamos a pasta `ts/` com o back-end portado para TypeScript, banco relacional **PostgreSQL** e API **Express**:

- **`ts/src/shared/`:** parser de horários do SIGAA e validador das regras RN-01 a RN-04, choque de sala e escopo IC. Será usado **pelo front e pelo back**.
- **`ts/src/motor/`:** busca em espaço de estados (MRV + Best-Fit + recuperação parcial), `AlocadorService` e `RemanejamentoService`.
- **`ts/migrations/` e `ts/src/db/`:** schema PostgreSQL em 7 tabelas (migrations `001` e `002` com constraints `CHECK`, `UNIQUE(id_turma)` e auditoria `atualizado_em`), executor de migrations e 5 repositórios com CRUD completo, filtros SQL e transações.
- **`ts/src/seed/`:** oferta real de 2026.2 em memória e seeder transacional PostgreSQL (`db-seeder.ts`) incluindo reservas `EXTERNA_FIXA`.
- **`ts/src/api/`:** servidor Express com endpoints REST de leitura, CRUD, geração de alocações, validação e confirmação transacional de remanejamentos.
- **`ts/test/`:** testes unitários, golden tests contra o Java e suíte de integração PostgreSQL (`npm run test:integration`).

O código Java + SQLite (`src/`) **continua intacto** como referência histórica e de validação dos gabaritos.

> **Evolução em relação ao plano inicial (SQLite → PostgreSQL):** inicialmente a etapa 2 previa SQLite em TypeScript, mas a equipe optou por **PostgreSQL 16** (via Docker `docker-compose.yml`) para suportar concorrência segura em remanejamentos (`pg_advisory_xact_lock`), constraints de domínio e facilidade de deploy compartilhado. Em relação ao legado SQLite (`src/dao/DatabaseInitializer.java`), o schema PostgreSQL usa nomes no singular (`sala`, `turma`, `alocacao`, `professor_turma`) e armazena restrições em `restricoes_horario(matricula_siape, horario_indisponivel)` no formato canônico `DIA-TURNO-HORAS` (ex.: `SEX-T-56`).

## Por que mudou

- **Objetivo:** fazer uma integração simples entre o front e o back. Hoje o back é só linha de comando, sem servidor HTTP.
- **Regras nos dois lados:** o front vai bloquear movimentos inválidos na hora, e o back vai validar de novo quando o usuário confirmar. Com TypeScript, as duas validações são **o mesmo código**, sem duplicação.
- **Express em vez de NestJS:** é mais conhecido pela equipe e é suficiente para o tamanho do sistema (7 tabelas e poucas rotas).
- **Java não era obrigatório:** era só uma convenção de outra disciplina.
- **O front continua em JavaScript puro:** trocar de framework não ajuda na integração e jogaria fora uma interface que já funciona e tem testes.

## Como sabemos que nada quebrou

Rodamos o motor Java e o TypeScript em 6 cenários: a base real e casos de estresse com salas removidas e professores indisponíveis, chegando a 300 mil nós de busca. O resultado foi **idêntico** em todos, com as mesmas salas, a mesma ordem e os mesmos números de nós e podas. A suíte Java continua passando 46 de 46 testes.

## O que foi acrescentado (sem mudar o resultado do motor)

- O validador aceita um horário diferente do original, para conferir um encontro arrastado na grade antes da confirmação.
- Uma turma do IC não pode ir para uma sala de fora do IC, por exemplo do CTEC ou do IF.
- Os erros saem no formato `{ regra, mensagem }`, prontos para a API mostrar ao usuário.

## Regras combinadas para a interface

- O usuário pode arrastar **um encontro por vez** de uma turma para outro horário.
- **Nada é gravado sem apertar Confirmar.**
- Na confirmação (`POST /api/alocacoes/confirmar`), o servidor valida a sala e o horário pretendidos **só da turma movida** (protegendo reservas `EXTERNA_FIXA`). As outras turmas não mudam. Se o movimento for inválido, o servidor recusa (`409`) e diz qual regra foi violada.

## Status das etapas

1. ~~Núcleo TypeScript (parser SIGAA, validador RN-01..RN-04 e motor `StateSpaceSearch`)~~ — **Concluída**.
2. ~~Banco PostgreSQL com as 7 tabelas, migrations (`001` e `002`), repositórios CRUD e seed `2026.2`~~ — **Concluída**.
3. ~~API Express com consulta, CRUD, geração de alocações, validação e confirmação transacional~~ — **Concluída**.
4. Ligar o front (`samyr-front-dev`) à API, no lugar dos dados de exemplo — **Em andamento / próxima etapa**.

## Como rodar a nova versão

É preciso ter o **Node.js 22.18 ou mais recente** e **PostgreSQL 16+** (ou Docker). Na pasta `ts/`:

```powershell
docker compose up -d       # na raiz do repositório (sobe PostgreSQL 16)
cd ts
npm install
npm run migrate            # aplica migrations 001 e 002
npm run db:seed            # popula oferta 2026.2 + reservas EXTERNA_FIXA
npm test                   # testes unitários e de contrato
npm run test:integration   # testes de integração reais no banco 'satic_test'
npm start                  # inicia a API em http://localhost:3001
```

No PowerShell do Windows, se o `npm` for bloqueado com o erro *"a execução de scripts foi desabilitada"*, use `npm.cmd test` e `npm.cmd run motor`.

Para conferir a versão Java original, siga a seção "Como Compilar e Executar" do [README](../README.md).
