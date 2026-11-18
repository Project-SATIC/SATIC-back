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
npm test            # Executa todos os 54 testes automatizados
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
| `POST` | `/api/alocacoes/gerar` | Executa o motor (MRV + Best-Fit) e persiste alocações |
| `POST` | `/api/alocacoes/validar` | Validação ágil de drag-and-drop sem persistir |
| `POST` | `/api/alocacoes/confirmar` | Valida e salva o remanejamento (retorna 409 se inválido) |
