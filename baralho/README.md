# Acédia — Montador de Grimório

Projeto web em **HTML, CSS e JavaScript puro** para simular:
- montagem de deck
- compra de cartas
- envio ao exílio

## Recursos
- Login/cadastro local com `localStorage`
- No login você informa seus pontos atuais de **Imo** e **Carne**
- Cartas base prontas para adicionar ao deck
- Criação de cartas **Imo** personalizadas com:
	- nome
	- custo de Imo
	- descrição
	- upload de imagem
- Deck com regra de tamanho entre **15 e 25** cartas
- Simulação de compra (`Comprar 1` e `Comprar 3`)
- Exílio de cartas da mão e retorno do exílio ao topo do baralho
- Modal de visualização da carta ao clicar
- Persistência de conta, pontos e deck por usuário

## Como rodar
Abra o arquivo `index.html` diretamente no navegador.

## Estrutura
- `index.html`
- `style.css`
- `script.js`
- `cartas/`
