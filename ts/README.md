# SATIC-back — Versão TypeScript + Express + PostgreSQL

Back-end do **SATIC** (*Sistema de Alocação de Turmas do Instituto de Computação — UFAL*) em **TypeScript + Express**, com persistência relacional em **PostgreSQL**.

---

## 🚀 Como Executar

### 1. Pré-requisitos
* **Node.js 22.18+** (suporte nativo a execução TypeScript via type stripping).
* **PostgreSQL 16+** (instalado localmente ou via Docker).

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
npm run migrate     # Cria as 7 tabelas do modelo lógico no PostgreSQL
npm run db:seed     # Povoa o banco com as salas, docentes e ofertas 2026.2
```

### 4. Iniciar a API Express
```powershell
npm start           # Inicia em http://localhost:3001
# ou para desenvolvimento com hot-reload:
npm run dev
```

### 5. Rodar a Suíte de Testes
```powershell
npm test                  # Executa os testes unitários e de contrato
npm run test:integration  # Executa a suíte real contra o banco isolado 'satic_test' no PostgreSQL
```

---

## 📡 Documentação da API

Os contratos detalhados de requisição, resposta e guia de integração para o front-end estão disponíveis em:
👉 **[`docs/api-contratos-frontend.md`](../docs/api-contratos-frontend.md)**

### Resumo das Rotas:
| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/api/health` | Diagnóstico da API e status da conexão com PostgreSQL |
| `GET` / `POST` | `/api/salas` | Lista (filtros SQL: `alocavel_ic`, `bloco`) ou cria sala física |
| `GET` / `PUT` / `DELETE` | `/api/salas/:id` | Busca, atualiza ou remove uma sala |
| `GET` / `POST` | `/api/disciplinas` | Lista ou cria disciplina da matriz curricular |
| `GET` / `PUT` / `DELETE` | `/api/disciplinas/:codigo` | Busca, atualiza ou remove uma disciplina |
| `GET` / `POST` | `/api/professores` | Lista ou cria docente com indisponibilidades (RN-02) |
| `GET` / `PUT` / `DELETE` | `/api/professores/:siape` | Busca, atualiza ou remove um docente |
| `POST` / `PUT` | `/api/professores/:siape/restricoes` | Adiciona ou substitui indisponibilidades de um docente |
| `DELETE` | `/api/professores/:siape/restricoes/:horario` | Remove uma indisponibilidade específica do docente |
| `GET` / `POST` | `/api/turmas` | Lista (filtros SQL: `semestre`, `requer_ic`) ou cria turma |
| `GET` / `PUT` / `DELETE` | `/api/turmas/:id` | Busca, atualiza ou remove uma turma e seus vínculos docentes |
| `GET` | `/api/alocacoes` | Lista alocações salvas (filtro: `semestre`) |
| `GET` / `DELETE` | `/api/alocacoes/:id` | Busca ou remove uma alocação específica |
| `POST` | `/api/alocacoes/gerar` | Executa o motor (MRV + Best-Fit) e persiste alocações |
| `POST` | `/api/alocacoes/validar` | Validação ágil de drag-and-drop sem persistir |
| `POST` | `/api/alocacoes/confirmar` | Valida e salva o remanejamento (retorna 409 se inválido) |
