# Interactive Card System

Aplicacao web multiplayer para:

- cadastro e autenticacao de jogadores
- criacao e edicao de decks
- lobby com selecao de deck e prontidao
- partida em tempo real com estado persistido no backend
- cartas Imo personalizadas por jogador

## Setup rapido

1. Instale dependencias:

```bash
npm run install:all
```

2. Suba o Postgres local:

```bash
npm run db:up
```

3. Rode backend + frontend:

```bash
npm run dev
```

Frontend padrao: `http://localhost:5173`
Backend padrao: `http://localhost:3001`

## Fluxo principal

1. Registrar ou logar
2. Criar decks validos
3. Criar ou entrar em uma sala
4. Selecionar deck na sala
5. Marcar pronto
6. Host inicia a partida
7. Jogadores compram, jogam cartas e encerram turnos na `MatchPage`

## Checks

Backend tests:

```bash
npm run test:backend
```

Smoke check do frontend:

```bash
npm run check:frontend
```
