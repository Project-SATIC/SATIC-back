# SATIC-back — porte TypeScript (prova de conceito)

Porte do núcleo de domínio do `SATIC-back` (Java, branch `lg-back-dev`) para TypeScript, como primeiro passo da migração para **Express.js**. Esta etapa cobre só a lógica, sem banco de dados e sem HTTP.

| Java (`../src`) | TypeScript (`./src`) |
|---|---|
| `model/*.java` | `shared/tipos.ts`: objetos de dados serializáveis em JSON e funções derivadas (`numeroAlunos`, `isLaboratorio`, `mesmaTurma`, `mesmaSala`) |
| `service/SigaaHorarioParser.java` | `shared/horario-sigaa.ts` |
| `service/ValidadorDeRestricoes.java` | `shared/validador.ts` |
| `StateSpaceSearch.java` | `motor/state-space-search.ts` |
| trecho de montagem do `Main.java` | `motor/montar-problema.ts` (turmas do IC e reservas `EXTERNA_FIXA`) |
| `dao/DatabaseSeeder.java` | `seed/seeder.ts` + `seed/ofertas-2026-2.ts` (dados em memória, com os mesmos ids e SIAPEs) |
| `test/SaticValidationSuite.java` | `test/*.test.ts` (`node:test`) |

A pasta **`src/shared/` não usa nenhuma API do Node**. Ela será servida pelo Express ao front-end, para que as mesmas regras (RN-01 a RN-04, choque de sala e escopo espacial) bloqueiem combinações inválidas no navegador e sejam conferidas de novo no servidor quando o usuário confirmar.

## Requisitos e comandos

É preciso ter o Node.js 22.18 ou mais recente. O Node executa `.ts` diretamente (*type stripping*), então esta etapa não tem nenhuma dependência npm.

```powershell
cd ts
npm test              # 36 testes: parser, validador, motor e equivalência com o Java
npm run motor         # roda o motor na base 2026.2 e imprime o resultado em JSON
```

Como o código precisa rodar com *type stripping*, use apenas sintaxe TypeScript apagável: nada de `enum`, `namespace` ou propriedades declaradas no construtor, e use `import type` para tipos. O `tsconfig.json` já força isso (`erasableSyntaxOnly`) para quando o `tsc` for adicionado.

## Equivalência com o Java

`test/golden.test.ts` compara o resultado do TS, campo a campo, com gabaritos gerados pelo próprio motor Java (`tools/GoldenDump.java`). A comparação cobre a ordem das alocações, as salas escolhidas, as pendências, os nós visitados, as podas e as matrículas SIAPE. São 6 cenários: a base real e casos de estresse com salas removidas e indisponibilidades, chegando a 39.700 nós de backtracking e ao corte de 300.000 nós. Todos são idênticos.

Para regerar um gabarito, rode na pasta `SATIC-back`, com o Java compilado em `bin/`:

```powershell
javac -encoding UTF-8 -cp "bin;lib/*" -d ts/tools/out ts/tools/GoldenDump.java
java "-Dfile.encoding=UTF-8" "-Dstdout.encoding=UTF-8" -cp "ts/tools/out;bin;lib/*" GoldenDump "$env:TEMP\golden.db" "sem=Auditório IC" > golden.json
```

O seed imprime duas linhas de log antes do JSON. Remova-as antes de salvar o arquivo em `test/fixtures/`.

## Diferenças intencionais em relação ao Java

Nenhuma delas altera o resultado do motor, como confirmam os gabaritos.

- **Horário explícito no validador:** as funções `verificar*` e `isAlocacaoValida` aceitam um parâmetro opcional `horario`. O padrão é `turma.horarioSigaa`. Ele serve para validar um encontro remanejado no front antes da confirmação.
- **Escopo espacial (`verificarEscopoEspacial`):** uma turma com `requerAlocacaoIc` só pode ir para uma sala com `alocavelIc`. A checagem entra em `isAlocacaoValida` e no diagnóstico, seguindo a recomendação da seção 4.2 do `ANALISE_PROJETO.md`.
- **Diagnóstico estruturado:** `diagnosticarViolacoes` devolve `{ regra, mensagem }` em vez de strings, pronto para uma resposta 409 da API.

## Próximas etapas

1. Persistência SQLite das 7 tabelas, mantendo `PRAGMA foreign_keys = ON`, mais o porte do teste de integração de DAOs.
2. API Express: listagens, geração de proposta e `POST /api/alocacoes/confirmar`, que mexe só na turma movida.
3. Servir `src/shared/` ao front (`samyr-front-dev`) e trocar o mock `criarDadosIniciais()` por `fetch`.
