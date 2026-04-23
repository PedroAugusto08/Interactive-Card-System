// Pagina base para gerenciamento de decks.
export function DecksPage() {
  return (
    <section className="stack-gap">
      <article className="card">
        <h1>Decks</h1>
        <p>
          Estrutura inicial pronta. Na proxima etapa vamos integrar CRUD de decks e cartas
          personalizadas.
        </p>
      </article>

      <article className="card">
        <h2>Planejado</h2>
        <ul>
          <li>Criar deck</li>
          <li>Editar composicao de cartas</li>
          <li>Salvar deck do jogador</li>
        </ul>
      </article>
    </section>
  );
}
