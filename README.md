# SATIC-back

Back-end em Java + SQLite do **SATIC** (*Sistema de Alocação de Turmas do Instituto de Computação — UFAL*), estruturado com foco inicial na **fase pós-oferta acadêmica** (horários importados do SIGAA e alocação otimizada de espaços físicos do Bloco IC, Bloco 12 e salas cedidas pelo IM).

> **Migração em andamento (branch `ts-back-dev`):** o back-end está sendo portado para **TypeScript + Express**, na pasta [`ts/`](ts/). Os motivos e o andamento estão em [`docs/registro-migracao-typescript.md`](docs/registro-migracao-typescript.md), e as instruções para rodar estão em [Versão TypeScript](#versão-typescript-ts). O código Java abaixo continua funcionando, e é a referência usada para conferir os resultados da nova versão.

---

## Estrutura do Projeto

* **`src/config/`**
  * `DatabaseConnection`: fábrica de conexões JDBC para `data/satic.db` com ativação obrigatória de `PRAGMA foreign_keys = ON`.
* **`src/model/`**
  * Entidades de domínio: `Disciplina`, `Turma` (com suporte a co-docência N:M e turmas conjuntas CC/EC), `Professor`, `IndisponibilidadeDocente`, `Sala` (classificação unificada via `tipo_espaco`), `Alocacao`, `DiaSemana`, `Turno`.
* **`src/dao/`**
  * `DatabaseInitializer`: DDL idempotente (`CREATE TABLE IF NOT EXISTS`) das 7 tabelas relacionais.
  * `DatabaseSeeder`: carga da oferta real **2026.2 (CC + EC)** com deduplicação automática de turmas compartilhadas e espaços do IC, BL12, IM e unidades externas.
  * `SalaDAO`, `ProfessorDAO`, `DisciplinaDAO`, `TurmaDAO`, `AlocacaoDAO`: camada de acesso a dados via JDBC / `PreparedStatement`.
* **`src/service/`**
  * `SigaaHorarioParser`: converte expressões de horário SIGAA (simples, compostas, sábado `7` e noturno `N`) em slots atômicos `"DIA-TURNO+HORA"`.
  * `ValidadorDeRestricoes`: implementa e audita as restrições rígidas **RN-01** (choque docente/co-docência), **RN-02** (indisponibilidade), **RN-03** (capacidade), **RN-04** (laboratório via `tipo_espaco`) e exclusividade de sala.
* **`src/`**
  * `StateSpaceSearch`: motor de busca em espaço de estados (Backtracking com poda antecipada, ordenação MRV e heurística *Best-Fit* com recuperação parcial).
  * `Main`: inicializa/carrega o banco, executa a busca para 2026.2, persiste `alocacoes`, audita violações e compara os resultados com o gabarito SIGAA.
* **`test/`**
  * `SaticValidationSuite`: suíte de testes unitários, regressão, busca e integração SQLite em banco temporário isolado.
* **`docs/`**
  * `satic_er_chen.drawio`: Diagrama Entidade-Relacionamento (DER) na notação clássica de Peter Chen.
* **`lib/`**
  * Driver JDBC (`sqlite-jdbc-3.45.1.0.jar`) e dependências SLF4J (`slf4j-api-2.0.12.jar`, `slf4j-simple-2.0.12.jar`).

---

## Como Compilar e Executar

Requisito: **JDK 21** (ou compatível) na raiz do repositório `SATIC-back`.

### Windows (PowerShell)

**1. Compilar o código-fonte e rodar o motor principal (`Main`):**
```powershell
New-Item -ItemType Directory -Force -Path "bin" | Out-Null
$src = Get-ChildItem -Path "src" -Recurse -Filter "*.java" | ForEach-Object { $_.FullName }
javac -encoding UTF-8 -cp "lib/*" -d bin $src
java "-Dfile.encoding=UTF-8" "-Dstdout.encoding=UTF-8" -cp "bin;lib/*" Main
```

**2. Compilar e executar a suíte de testes (`SaticValidationSuite`):**
```powershell
New-Item -ItemType Directory -Force -Path "bin-test" | Out-Null
javac -encoding UTF-8 -cp "bin;lib/*" -d bin-test test/SaticValidationSuite.java
java "-Dfile.encoding=UTF-8" "-Dstdout.encoding=UTF-8" -cp "bin-test;bin;lib/*" SaticValidationSuite
```

### Linux / macOS (Bash)

Substitua `;` por `:` no classpath (`-cp "bin:lib/*"` e `-cp "bin-test:bin:lib/*"`), passando `$(find src -name "*.java")` para o `javac`.

---

## Versão TypeScript (`ts/`)

Requisito: **Node.js 22.18 ou mais recente** (confira com `node -v`).

### Windows (PowerShell), Linux e macOS

**1. Entrar na pasta e instalar dependências:**
```powershell
cd ts
npm install
```

**2. Checar tipos e rodar os testes** (parser SIGAA, validador, motor, API, PGlite e gabaritos do Java):
```powershell
npm run typecheck
npm test
```
O resultado esperado termina em `pass 151` e `fail 0`.

> No PowerShell do Windows, se aparecer o erro *"a execução de scripts foi desabilitada neste sistema"*, use `npm.cmd test` e `npm.cmd run motor`, ou rode direto com o Node: `node --test "test/**/*.test.ts"` e `node tools/rodar-motor.ts`.

**3. Rodar o motor na base real 2026.2** (imprime as alocações em JSON):
```powershell
npm run motor
```
A primeira linha mostra um resumo como `alocadas=86 pendentes=0 ... completo=true`. Para salvar o JSON em um arquivo, use `npm run motor > saida.json`.

Opcionalmente, dá para simular cenários: `node tools/rodar-motor.ts "sem=Auditório IC"` remove uma sala, e `node tools/rodar-motor.ts "indisp=2024389:TER:T:34"` adiciona uma indisponibilidade a um docente.

Detalhes da estrutura e de como regerar os gabaritos do Java: [`ts/README.md`](ts/README.md).

---

## Observações de Banco Local

* O arquivo `data/satic.db` é gerado automaticamente na primeira execução do `Main` (e ignorado pelo Git via `.gitignore`).
* Caso precise recriar o banco local do zero após alterações no schema, remova `data/satic.db` (ou utilize `DatabaseInitializer.recreateSchema()`) e execute `Main` novamente.
