function buildCardClassName({ interactive, selected, glow, compact, className }) {
  return [
    'ui-card',
    interactive ? 'ui-card--interactive' : '',
    selected ? 'ui-card--selected' : '',
    glow ? 'ui-card--glow' : '',
    compact ? 'ui-card--compact' : '',
    className || '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function Card({
  title,
  description,
  children,
  actions,
  interactive = false,
  selected = false,
  glow = false,
  compact = false,
  className = '',
}) {
  return (
    <article className={buildCardClassName({ interactive, selected, glow, compact, className })}>
      <div className="ui-card__content">
        {title || description || actions ? (
          <div className="ui-card__header">
            <div>
              {title ? <h2 className="ui-card__title">{title}</h2> : null}
              {description ? <p className="ui-card__description">{description}</p> : null}
            </div>
            {actions ? <div>{actions}</div> : null}
          </div>
        ) : null}

        {children}
      </div>
    </article>
  );
}
