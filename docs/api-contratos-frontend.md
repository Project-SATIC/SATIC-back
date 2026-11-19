# SATIC - Documentação da API e Contratos com o Front-end

Esta documentação descreve todos os endpoints da API REST do SATIC, schemas de requisição e resposta, códigos HTTP e o fluxo recomendado para a interface gráfica (drag-and-drop da grade horária).

---

## 1. Informações Gerais

* **Base URL**: `http://localhost:3001` (configurável via variável de ambiente `PORT`)
* **Headers Padrão**:
  * `Content-Type: application/json`
  * `Accept: application/json`
* **CORS**: Sem configuração, aceita qualquer origem (desenvolvimento local, inclusive o servidor do front em `http://127.0.0.1:8040`). Para restringir, defina `CORS_ORIGIN` no `.env` com as origens separadas por vírgula (ex: `CORS_ORIGIN=http://127.0.0.1:8040,http://localhost:8040`).
* **Padrão de Erro Genérico**: `erro` sempre presente e legível para o usuário; `detalhes` só quando houver informação técnica extra.
  ```json
  {
    "erro": "turmaId é obrigatório e deve ser um inteiro positivo",
    "detalhes": "opcional"
  }
  ```
* **Códigos HTTP usados**:

  | Código | Quando |
  |---|---|
  | `200` | Sucesso (inclui `/validar` com `valida: false`: a validação em si funcionou) |
  | `400` | JSON malformado, corpo que não é objeto, id não inteiro/positivo, horário fora do padrão SIGAA, `status` ou `semestre` inválidos |
  | `404` | Turma, sala, professor ou disciplina inexistente; semestre sem turmas em `/gerar` |
  | `409` | `/confirmar` recusado por regra de negócio, ou violação de integridade do banco |
  | `503` | PostgreSQL fora do ar ou inacessível (`erro: "Banco de dados indisponível"`) |
  | `500` | Erro inesperado |

* **IDs**: `turmaId`, `salaId` e `:id` aceitam número ou string numérica (ex: valor lido de um `data-attribute`).
* **Horários**: notação SIGAA (`"35T34"`, `"2T56 6T12"`). O servidor normaliza maiúsculas e espaços e devolve o horário normalizado.

---

## 2. Endpoints de Consulta (Leitura)

### `GET /api/health`
Verifica a integridade do serviço e o status da conexão com o banco PostgreSQL.
Responde **200** com `status: "ok"` quando o banco responde e **503** com `status: "degradado"` e `database.conectado: false` quando a API está no ar mas o banco não. O corpo tem o mesmo formato nos dois casos.

* **Resposta 200**:
  ```json
  {
    "status": "ok",
    "timestamp": "2026-11-17T22:30:00.000Z",
    "database": {
      "conectado": true,
      "mensagem": "Conectado ao banco 'satic'"
    }
  }
  ```

---

### `GET /api/salas`
Retorna a lista de salas e laboratórios cadastrados.

* **Query Parameters (Opcionais)**:
  * `alocavel_ic`: `"true"` (retorna apenas salas do pool do IC) ou `"false"` (apenas externas).
  * `bloco`: Filtra por bloco (ex: `"IC"`, `"BL12"`, `"IM"`, `"CTEC"`, `"IF"`).
* **Exemplo**: `GET /api/salas?alocavel_ic=true`
* **Resposta 200**:
  ```json
  [
    {
      "id": 1,
      "nome": "Sala 02 IC",
      "capacidade": 60,
      "tipoEspaco": "Sala",
      "bloco": "IC",
      "alocavelIc": true
    },
    {
      "id": 6,
      "nome": "Laboratório 01 - IC",
      "capacidade": 65,
      "tipoEspaco": "Laboratório",
      "bloco": "IC",
      "alocavelIc": true
    }
  ]
  ```

---

### `GET /api/salas/:id`
Busca os detalhes de uma sala específica por ID.

* **Resposta 200**: Objeto `Sala`.
* **Resposta 404**: `{ "erro": "Sala de id 999 não encontrada" }`

---

### `GET /api/turmas`
Retorna as turmas ofertadas, com suas disciplinas e professores vinculados (incluindo co-docência).

* **Query Parameters (Opcionais)**:
  * `semestre`: Filtra por semestre (ex: `?semestre=2026.2`).
  * `requer_ic`: `"true"` (apenas turmas que demandam espaço do IC) ou `"false"` (turmas externas).
* **Exemplo**: `GET /api/turmas?semestre=2026.2&requer_ic=true`
* **Resposta 200**:
  ```json
  [
    {
      "id": 1,
      "disciplina": {
        "codigo": "COMP360",
        "nome": "PROGRAMAÇÃO 1",
        "cargaHoraria": 60,
        "exigeLaboratorio": true
      },
      "codigoTurma": "01",
      "semestre": "2026.2",
      "cursosOfertados": "CC",
      "horarioSigaa": "35M34",
      "vagas": 45,
      "matriculados": 42,
      "requerAlocacaoIc": true,
      "aulasSemanais": 4,
      "professores": [
        {
          "matriculaSiape": "2024389",
          "nome": "RANILSON OSCAR ARAUJO PAIVA",
          "indisponibilidades": [
            {
              "diaSemana": "SEX",
              "turno": "T",
              "indiceHorario": "56"
            }
          ]
        }
      ],
      "cargaHorariaPorDocente": {
        "2024389": 60
      }
    }
  ]
  ```

---

### `GET /api/turmas/:id`
Busca os detalhes de uma turma específica por ID.

* **Resposta 200**: Objeto `Turma`.
* **Resposta 404**: `{ "erro": "Turma de id 999 não encontrada" }`

---

### `GET /api/professores`
Lista os docentes cadastrados e suas restrições de indisponibilidade (RN-02).

* **Resposta 200**:
  ```json
  [
    {
      "matriculaSiape": "2024389",
      "nome": "RANILSON OSCAR ARAUJO PAIVA",
      "indisponibilidades": [
        {
          "professorMatricula": "2024389",
          "diaSemana": "SEX",
          "turno": "T",
          "indiceHorario": "56"
        }
      ]
    }
  ]
  ```

---

### `GET /api/disciplinas`
Lista as disciplinas da matriz curricular.

* **Resposta 200**:
  ```json
  [
    {
      "codigo": "COMP360",
      "nome": "PROGRAMAÇÃO 1",
      "cargaHoraria": 60,
      "exigeLaboratorio": true
    }
  ]
  ```

---

### `GET /api/alocacoes`
Retorna as alocações físicas registradas no banco de dados.

* **Query Parameters (Opcionais)**:
  * `semestre`: Filtra alocações por semestre da turma (ex: `?semestre=2026.2`). Formato `AAAA.S`; outro formato responde 400.
* **Turma embutida**: cada alocação traz a turma completa, com `professores` (e suas `indisponibilidades`) e `cargaHorariaPorDocente`, no mesmo formato de `GET /api/turmas`.
* **Status possíveis** (no máximo uma alocação por turma):
  * `RASCUNHO`: proposta do motor. É substituída a cada `/gerar` com `persistir: true`.
  * `DEFINITIVA`: remanejamento confirmado pela secretaria via `/confirmar`. Por padrão sobrevive a novas gerações.
  * `EXTERNA_FIXA`: turma de outro instituto que ocupa sala do pool do IC (ex: `IF0001-05` na `Sala 207 BL12`). Gravada pelo seed e nunca apagada pelo `/gerar`.
* **Resposta 200**:
  ```json
  [
    {
      "id": 1,
      "turma": {
        "id": 1,
        "codigoTurma": "01",
        "semestre": "2026.2",
        "disciplina": { "codigo": "COMP360", "nome": "PROGRAMAÇÃO 1", "cargaHoraria": 60, "exigeLaboratorio": true },
        "vagas": 45,
        "matriculados": 42
      },
      "sala": {
        "id": 6,
        "nome": "Laboratório 01 - IC",
        "capacidade": 65,
        "tipoEspaco": "Laboratório",
        "bloco": "IC",
        "alocavelIc": true
      },
      "horarioCodigo": "35M34",
      "status": "DEFINITIVA",
      "dataGeracao": "2026-11-17T22:00:00.000Z"
    }
  ]
  ```

---

## 3. Endpoints de Operação e Interação do Usuário

### `POST /api/alocacoes/gerar`
Aciona o motor de busca em espaço de estados (MRV + Best-Fit) para calcular a proposta otimizada de alocação de salas para o semestre.

* **Payload (JSON)**:
  ```json
  {
    "semestre": "2026.2",
    "persistir": true,
    "semSalas": ["Auditório CEPETEC"]
  }
  ```
  * `semestre` (string, opcional): Padrão `"2026.2"`. Formato `AAAA.S`.
  * `persistir` (boolean, opcional): Padrão `true`. Se `false`, atua em modo *preview* (simulação sem gravar no banco).
  * `semSalas` (string[], opcional): Lista de nomes de salas a desconsiderar no cálculo.
  * `limiteNos` (inteiro, opcional): Limite de nós da busca, de 1 a 3.000.000. Padrão: 300.000, o mesmo do motor Java.
  * `preservarDefinitivas` (boolean, opcional): Padrão `true`. As alocações `DEFINITIVA` entram no motor como fixas e não são recalculadas. Com `false`, elas são descartadas e o motor decide de novo a sala dessas turmas.

* **O que acontece com `persistir: true`**: leitura, busca e gravação rodam numa única transação, com lock do semestre. São apagadas só as alocações `RASCUNHO` (e as `DEFINITIVA`, se `preservarDefinitivas: false`) e gravadas as novas. As reservas `EXTERNA_FIXA` nunca são apagadas. Se algo falhar, nada muda no banco.

* **Resposta 200**:
  ```json
  {
    "sucesso": true,
    "semestre": "2026.2",
    "persistido": true,
    "resumo": {
      "completo": true,
      "totalTurmas": 86,
      "alocadas": 86,
      "pendentes": 0,
      "preservadas": 2,
      "podas": 631,
      "nosVisitados": 87,
      "tempoMs": 4
    },
    "alocacoes": [ ... ],
    "preservadas": [ ... ],
    "pendentes": [],
    "horariosInvalidos": []
  }
  ```
  * `alocacoes`: o que o motor decidiu nesta execução (status `RASCUNHO`; com `persistir: true`, já vêm com `id`).
  * `preservadas`: alocações `EXTERNA_FIXA` e `DEFINITIVA` mantidas e usadas como bloqueios pelo motor. Para desenhar a grade completa, junte `alocacoes` com `preservadas`, ou recarregue `GET /api/alocacoes`.
  * `pendentes`: turmas que o motor não conseguiu alocar.
  * `horariosInvalidos`: chaves (`"COMP360-01"`) de turmas cujo `horarioSigaa` no banco é ilegível. Elas ficam fora da busca e também aparecem em `pendentes`.
* **Resposta 404**: semestre sem turmas cadastradas (rode o seed).

---

### `POST /api/alocacoes/validar` (Feedback em tempo real de Drag-and-Drop)
Permite ao front-end testar se mover um card para determinado horário/sala viola qualquer uma das regras (**RN-01 a RN-04**, choque de sala e escopo do IC), **sem alterar o banco de dados**.

* **Payload (JSON)**:
  ```json
  {
    "turmaId": 12,
    "salaId": 3,
    "horario": "35T34"
  }
  ```
  * `turmaId` (number, obrigatório): ID da turma.
  * `salaId` (number, **opcional** desde 19/11): sala pretendida. Se omitido, o servidor **mantém a sala atual** se ela continuar válida no novo horário; se não, **sugere a melhor sala livre** (Best-Fit, sala comum antes de laboratório para teóricas). A resposta traz `sala` e `origemSala` (`"pedida"`, `"mantida"` ou `"sugerida"`); sem sala possível, `salaId`/`sala` vêm `null`.
  * `horario` (string, opcional): Horário pretendido. Se omitido, usa o horário atual da alocação (ou o `horarioSigaa` da turma). Horário fora da notação SIGAA responde 400.
  * Além de RN-01 a RN-04, sala e escopo, o diagnóstico inclui **`FORMATO`** (número de aulas por semana diferente do cadastro, ou mais de um bloco no mesmo dia) e **`TURNO`** (turno fora do curso: CC/EC manhã e tarde, IA noite). Ver [`modelo-aulas-e-motor-de-sugestoes.md`](./modelo-aulas-e-motor-de-sugestoes.md).
  * O semestre usado na checagem é sempre o da própria turma.
  * As checagens RN-01 (choque de docente, inclusive co-docentes) e RN-02 (indisponibilidade) usam os docentes cadastrados no banco para a turma movida e para todas as turmas já alocadas no semestre.
* **Respostas de erro**: 400 (payload inválido) e 404 (turma ou sala inexistente).

* **Resposta 200 (Válida)**:
  ```json
  {
    "valida": true,
    "turmaId": 12,
    "salaId": 3,
    "horario": "35T34",
    "violacoes": []
  }
  ```

* **Resposta 200 (Inválida)**:
  ```json
  {
    "valida": false,
    "turmaId": 12,
    "salaId": 3,
    "horario": "35T34",
    "violacoes": [
      {
        "regra": "RN-03",
        "mensagem": "RN-03 Lotação: turma com 60 alunos excede capacidade de Sala 04 IC (45 lugares)."
      },
      {
        "regra": "SALA",
        "mensagem": "Choque de Sala: Sala 04 IC já está ocupada no horário 35T34."
      }
    ]
  }
  ```

---

### `POST /api/alocacoes/confirmar` (Efetivação de Remanejamento)
Executado quando o usuário aperta o botão **"Confirmar"** na interface após mover uma turma.
O servidor valida novamente todas as regras. Se aprovado, **atualiza exclusivamente a alocação da turma movida**, preservando intactas todas as outras turmas.

* **Payload (JSON)**:
  ```json
  {
    "turmaId": 12,
    "salaId": 2,
    "horario": "35T34",
    "status": "DEFINITIVA"
  }
  ```
  * `status` (opcional): `RASCUNHO`, `DEFINITIVA` ou `EXTERNA_FIXA`; qualquer outro valor responde 400. Se omitido, vale `DEFINITIVA`. A exceção é mover uma reserva `EXTERNA_FIXA`, que mantém esse status.
  * Validação e gravação rodam na mesma transação, com lock do semestre. Dois usuários confirmando ao mesmo tempo não conseguem colocar turmas na mesma sala e horário: o segundo recebe 409.

* **Resposta 200 (Sucesso)**:
  ```json
  {
    "sucesso": true,
    "mensagem": "Alocação remanejada e atualizada com sucesso.",
    "alocacao": {
      "id": 15,
      "turma": { ... },
      "sala": { ... },
      "horarioCodigo": "35T34",
      "status": "DEFINITIVA"
    }
  }
  ```

* **Resposta 409 Conflict (Rejeição por Violação de Regras)**:
  ```json
  {
    "sucesso": false,
    "mensagem": "Remanejamento recusado pelo servidor: uma ou mais regras de negócio foram violadas.",
    "violacoes": [
      {
        "regra": "RN-04",
        "mensagem": "RN-04 Infraestrutura: COMP360 exige laboratório, mas Sala 02 IC não possui perfil de laboratório."
      }
    ]
  }
  ```

---

### `POST /api/alocacoes/confirmar-lote` ("Confirmar tudo" do rascunho)
Aplica de uma vez as mudanças acumuladas no navegador. Tudo roda numa transação, com lock de cada semestre envolvido. Cada movimento é validado contra o estado que já inclui os anteriores aceitos, e os recusados não impedem os demais. Os recusados ganham uma segunda tentativa no fim, porque às vezes um movimento só cabe depois que outro libera a sala.

* **Payload**:
  ```json
  {
    "movimentos": [
      { "turmaId": 12, "horario": "3M3456" },
      { "turmaId": 30, "salaId": 4, "horario": "24T12" },
      { "turmaId": 41, "acao": "remover" }
    ]
  }
  ```
  * Cada item aceita os mesmos campos de `/confirmar` (`salaId` opcional, `horario`, `status`) e `acao`: `"mover"` (padrão) ou `"remover"`, que tira a turma da grade e a deixa pendente.
  * No máximo 200 movimentos. Um item malformado responde **400** para o lote inteiro, e nada é gravado.
* **Resposta**: **200** se todos foram aceitos, **207** se só parte foi, **409** se nenhum foi.
  ```json
  {
    "aceitos": 2,
    "recusados": 1,
    "resultados": [
      { "indice": 0, "turmaId": 12, "sucesso": true, "mensagem": "...", "alocacao": { ... }, "origemSala": "mantida" },
      { "indice": 1, "turmaId": 30, "sucesso": false, "mensagem": "...", "violacoes": [{ "regra": "SALA", "mensagem": "..." }] },
      { "indice": 2, "turmaId": 41, "sucesso": true, "mensagem": "Turma retirada da grade; agora está pendente." }
    ]
  }
  ```

---

### `GET /api/alocacoes/conflitos?semestre=2026.2`
Conflitos e pendências do semestre, calculados pelo servidor com o mesmo validador.

* **Resposta 200**:
  ```json
  {
    "semestre": "2026.2",
    "conflitos": [
      { "turmaId": 12, "turma": "COMP360-01", "status": "RASCUNHO", "violacoes": [{ "regra": "SALA", "mensagem": "..." }] }
    ],
    "pendentes": [
      { "turmaId": 50, "turma": "COMP399-01", "motivo": "sem sala" }
    ]
  }
  ```
  * `motivo` da pendência: `"sem sala"`, `"sem docente"` ou `"sem horário"`.

---

### `POST /api/alocacoes/sugestoes` (motor de horário + sala)
Roda o motor de sugestões para os conflitos e pendências. **Não grava nada.** Para aplicar uma sugestão, o front envia as `mudancas` dela para `/confirmar-lote`. Turmas `DEFINITIVA` e `EXTERNA_FIXA` nunca são alteradas.

* **Payload** (todos opcionais):
  ```json
  {
    "semestre": "2026.2",
    "alvos": [12, 30],
    "permitirMudarFormato": [30],
    "limiteNos": 200000,
    "maxAlternativas": 3
  }
  ```
  * `alvos`: turmas a resolver. Padrão: todas as em conflito e as pendentes que só não têm sala.
  * `permitirMudarFormato`: turmas cujo formato o motor pode mudar (2+2 → 4 num dia etc.). A busca fica mais lenta.
  * `limiteNos`: 1 a 1.000.000 (padrão 200.000).
* **Resposta 200**:
  ```json
  {
    "semestre": "2026.2",
    "conflitos": [ ... ],
    "pendentes": [ ... ],
    "alvos": [12, 30],
    "plano": {
      "descricao": "COMP360-01: Sala 02 IC → Sala 04 IC; COMP362-01: 24T12 · Sala 03 IC → 24T34 · Sala 207 BL12",
      "custo": { "turmasAlteradas": 2, "mudancasDeHorario": 1, "mudancasDeSala": 2, "pontos": 12 },
      "mudancas": [
        {
          "turmaId": 12, "turma": "COMP360-01", "tipo": "sala",
          "de":   { "salaId": 1, "sala": "Sala 02 IC", "horario": "24M34" },
          "para": { "salaId": 3, "sala": "Sala 04 IC", "horario": "24M34" }
        }
      ]
    },
    "alternativasPorTurma": { "12": [ { "descricao": "...", "custo": { ... }, "mudancas": [ ... ] } ] },
    "naoResolvidos": [],
    "nosVisitados": 3037,
    "limiteAtingido": false,
    "tempoMs": 280
  }
  ```
  * `tipo` da mudança: `"sala"`, `"horario"`, `"horario+sala"` ou `"nova"` (turma pendente que ganha sala).
  * `plano`: tenta resolver todas as turmas juntas. `alternativasPorTurma`: até `maxAlternativas` opções por turma, cada uma considerando as demais turmas como estão, ordenadas por custo (horário pesa 10, sala pesa 1).
  * `naoResolvidos`: turmas sem solução dentro do limite, ou que exigem decisão manual (por exemplo, duas confirmadas em conflito, ou turma sem docente).

---

### `GET /shared/{grade,horario-sigaa,tipos,validador}.js`
O parser SIGAA, o modelo de grade e o validador do servidor, como **módulos ES** para o navegador. Com eles o front valida um movimento na hora com o mesmo código da confirmação. CORS liberado.

```js
const API = "http://localhost:3001";
const { diagnosticarViolacoes } = await import(`${API}/shared/validador.js`);
const { RELOGIO_AULAS, CURSOS, montarHorarioSigaa, blocosDoHorario } = await import(`${API}/shared/grade.js`);
```

---

## 4. Guia de Integração do Front-end

### Fluxo de Carregamento da Grade
0. (Opcional) `GET /api/health`: se responder 503, mostrar aviso de "banco indisponível" em vez de uma grade vazia.
1. Fazer `GET /api/salas?alocavel_ic=true` para renderizar as colunas/linhas das salas disponíveis.
2. Fazer `GET /api/turmas?semestre=2026.2` para obter os dados completos das turmas.
3. Fazer `GET /api/alocacoes?semestre=2026.2` para posicionar os cards já alocados na grade.

### Fluxo de Drag-and-Drop com rascunho (combinado em 19/11)
1. Ao soltar aulas numa nova posição, o front monta o novo horário (`montarHorarioSigaa`) e valida **na hora** com `/shared/validador.js`, sem chamar o servidor. Se não houver problema, a mudança entra no rascunho com o contador "N alterações não salvas".
2. **Confirmar tudo** → `POST /api/alocacoes/confirmar-lote` com o rascunho. Os itens aceitos saem do rascunho; os recusados ficam marcados com as `violacoes`.
3. **Descartar** → recarrega `GET /api/alocacoes` e limpa o rascunho.
4. **Resolver via motor** (Central de Conflitos) e **Gerar grade** → `POST /api/alocacoes/sugestoes`. Aceitar uma sugestão coloca as `mudancas` dela no rascunho.

### Fluxo de Drag-and-Drop (movimento único, versão anterior)
1. **Durante o arraste / soltura temporária**:
   * O front chama `POST /api/alocacoes/validar` enviando `{ turmaId, salaId, horario }`.
   * Se `valida === true`: a interface destaca o card em verde.
   * Se `valida === false`: a interface destaca em vermelho e exibe as mensagens de `violacoes` em um tooltip/alerta.
2. **Ao clicar em "Confirmar"**:
   * O front chama `POST /api/alocacoes/confirmar`.
   * Se `status 200`: atualiza o estado local e exibe toast de sucesso.
   * Se `status 409`: exibe modal de erro listando as regras que impediram a movimentação e reverte o card para a posição anterior.
   * Se `status 400`/`404`: bug do cliente ou dado desatualizado. Mostrar `erro` e recarregar a grade.
   * Se `status 503`: banco fora do ar. Manter o card na posição anterior e avisar o usuário.
