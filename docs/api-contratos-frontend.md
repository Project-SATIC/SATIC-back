# SATIC - Documentação da API e Contratos com o Front-end

Esta documentação descreve todos os endpoints da API REST do SATIC, schemas de requisição e resposta, códigos HTTP e o fluxo recomendado para a interface gráfica (drag-and-drop da grade horária).

---

## 1. Informações Gerais

* **Base URL**: `http://localhost:3001` (configurável via variável de ambiente `PORT`)
* **Headers Padrão**:
  * `Content-Type: application/json`
  * `Accept: application/json`
* **CORS**: Habilitado para qualquer origem em ambiente de desenvolvimento (permite requisições de `localhost:3000`, `localhost:5173`, etc.).
* **Padrão de Erro Genérico**:
  ```json
  {
    "erro": "Descrição do erro",
    "detalhes": "Mensagem técnica ou detalhe adicional"
  }
  ```

---

## 2. Endpoints de Consulta (Leitura)

### `GET /api/health`
Verifica a integridade do serviço e o status da conexão com o banco PostgreSQL.

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
      "professores": [
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

### `GET /api/professores/:siape`
Busca um docente específico por matrícula SIAPE, incluindo suas restrições de indisponibilidade.

* **Resposta 200**: Objeto `Professor`.
* **Resposta 404**: `{ "erro": "Professor com SIAPE '999' não encontrado" }`

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

### `GET /api/disciplinas/:codigo`
Busca uma disciplina específica pelo código (case-insensitive).

* **Resposta 200**: Objeto `Disciplina`.
* **Resposta 404**: `{ "erro": "Disciplina 'COMP999' não encontrada" }`

---

### `GET /api/alocacoes`
Retorna as alocações físicas registradas no banco de dados (com turma, disciplina, sala e docentes hidratados).

* **Query Parameters (Opcionais)**:
  * `semestre`: Filtra alocações por semestre da turma (ex: `?semestre=2026.2`).
* **Resposta 200**:
  ```json
  [
    {
      "id": 1,
      "turma": {
        "id": 1,
        "codigoTurma": "01",
        "semestre": "2026.2",
        "cursosOfertados": "CC",
        "horarioSigaa": "35M34",
        "requerAlocacaoIc": true,
        "disciplina": { "codigo": "COMP360", "nome": "PROGRAMAÇÃO 1", "cargaHoraria": 60, "exigeLaboratorio": true },
        "vagas": 45,
        "matriculados": 42,
        "professores": [
          { "matriculaSiape": "2024389", "nome": "RANILSON OSCAR ARAUJO PAIVA", "indisponibilidades": [] }
        ],
        "cargaHorariaPorDocente": { "2024389": 60 }
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
      "dataGeracao": "2026-11-17T22:00:00.000Z",
      "atualizadoEm": "2026-11-17T22:05:00.000Z"
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
    "limiteNos": 300000,
    "semSalas": ["Auditório CEPETEC"]
  }
  ```
  * `semestre` (string, opcional): Padrão `"2026.2"`.
  * `persistir` (boolean, opcional): Padrão `true`. Se `false`, atua em modo *preview* (simulação sem gravar no banco).
  * `limiteNos` (integer, opcional): Limite máximo de nós na busca (`1` a `5000000`).
  * `semSalas` (string[], opcional): Lista de nomes de salas a desconsiderar no cálculo.

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
      "podas": 124,
      "nosVisitados": 86,
      "tempoMs": 15
    },
    "alocacoes": [ ... ],
    "pendentes": []
  }
  ```

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
  * `salaId` (number, obrigatório): ID da sala pretendida.
  * `horario` (string, opcional): Horário pretendido. Se omitido, usa o `horarioSigaa` original da turma.

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
      "status": "DEFINITIVA",
      "dataGeracao": "2026-11-17T22:00:00.000Z",
      "atualizadoEm": "2026-11-17T22:05:00.000Z"
    }
  }
  ```

> **Proteção de reservas externas:** `POST /api/alocacoes/confirmar` aceita apenas `status` `"RASCUNHO"` ou `"DEFINITIVA"` e retorna `409 Conflict` se o cliente tentar alterar uma alocação com status `"EXTERNA_FIXA"` ou atribuir `"EXTERNA_FIXA"` manualmente. Da mesma forma, `DELETE /api/alocacoes/:id` recusa com `409 Conflict` a remoção de reservas `"EXTERNA_FIXA"`.

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

## 4. Endpoints de Gerenciamento (CRUD)

Todos os endpoints de escrita retornam `400 Bad Request` para payload inválido, `404 Not Found` quando o recurso não existe e `409 Conflict` em violações de unicidade ou remoção de registro referenciado por chave estrangeira.

- **Salas**: `POST /api/salas` (`201`), `PUT /api/salas/:id` (`200`), `DELETE /api/salas/:id` (`204`)
- **Disciplinas**: `POST /api/disciplinas` (`201`), `PUT /api/disciplinas/:codigo` (`200`), `DELETE /api/disciplinas/:codigo` (`204`)
- **Professores**: `POST /api/professores` (`201`), `PUT /api/professores/:siape` (`200`), `DELETE /api/professores/:siape` (`204`)
- **Restrições Docentes (RN-02)**:
  - `POST /api/professores/:siape/restricoes` (`201`): aceita `{ "horarioIndisponivel": "SEX-T-56" }` ou `{ "diaSemana": "SEX", "turno": "T", "indiceHorario": "56" }`
  - `PUT /api/professores/:siape/restricoes` (`200`): substitui toda a lista `{ "indisponibilidades": ["SEX-T-56", ...] }`
  - `DELETE /api/professores/:siape/restricoes/:horario` (`204`)
- **Turmas**: `POST /api/turmas` (`201`), `PUT /api/turmas/:id` (`200`), `DELETE /api/turmas/:id` (`204`)
- **Alocações**: `GET /api/alocacoes/:id` (`200`), `DELETE /api/alocacoes/:id` (`204`)

---

## 5. Guia de Integração do Front-end

### Fluxo de Carregamento da Grade
1. Fazer `GET /api/salas?alocavel_ic=true` para renderizar as colunas/linhas das salas disponíveis.
2. Fazer `GET /api/turmas?semestre=2026.2` para obter os dados completos das turmas.
3. Fazer `GET /api/alocacoes?semestre=2026.2` para posicionar os cards já alocados na grade.

### Fluxo de Drag-and-Drop (Arrastar e Soltar)
1. **Durante o arraste / soltura temporária**:
   * O front chama `POST /api/alocacoes/validar` enviando `{ turmaId, salaId, horario }`.
   * Se `valida === true`: a interface destaca o card em verde.
   * Se `valida === false`: a interface destaca em vermelho e exibe as mensagens de `violacoes` em um tooltip/alerta.
2. **Ao clicar em "Confirmar"**:
   * O front chama `POST /api/alocacoes/confirmar`.
   * Se `status 200`: atualiza o estado local e exibe toast de sucesso.
   * Se `status 409`: exibe modal de erro listando as regras que impediram a movimentação e reverte o card para a posição anterior.
