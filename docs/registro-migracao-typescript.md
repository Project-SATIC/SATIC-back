# Registro de mudança: back-end Java → TypeScript + Express

**Data:** 17/11/2026 · **Branch:** `ts-back-dev` (criada a partir de `lg-back-dev`) · **Situação:** etapa 1 de 4 concluída

## O que mudou

Criamos a pasta `ts/` com o núcleo do back-end portado para TypeScript:

- **`ts/src/shared/`:** parser de horários do SIGAA e validador das regras RN-01 a RN-04, choque de sala e escopo IC. Será usado **pelo front e pelo back**.
- **`ts/src/motor/`:** a busca em espaço de estados (MRV + Best-Fit + recuperação parcial).
- **`ts/src/seed/`:** a oferta real de 2026.2.
- **`ts/test/`:** 36 testes automatizados.

O código Java **continua intacto** nesta branch e em `lg-back-dev`.

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
- Na confirmação, o servidor valida e escolhe a sala **só da turma movida**. As outras turmas não mudam. Se o movimento for inválido, o servidor recusa e diz qual regra foi violada.

## Próximas etapas

1. Banco SQLite em TypeScript, com as mesmas 7 tabelas.
2. API Express, incluindo a rota de confirmação.
3. Ligar o front (`samyr-front-dev`) à API, no lugar dos dados de exemplo.

## Como rodar a nova versão

É preciso ter o **Node.js 22.18 ou mais recente** (confira com `node -v`). Não há pacotes para instalar. Os comandos são os mesmos no Windows, no Linux e no macOS:

```powershell
git checkout ts-back-dev
cd ts
npm test          # 36 testes; o esperado é "pass 36" e "fail 0"
npm run motor     # roda o motor na base 2026.2 e imprime as alocações em JSON
```

No PowerShell do Windows, se o `npm` for bloqueado com o erro *"a execução de scripts foi desabilitada"*, use `npm.cmd test` e `npm.cmd run motor`.

Para conferir a versão Java original, siga a seção "Como Compilar e Executar" do [README](../README.md).
