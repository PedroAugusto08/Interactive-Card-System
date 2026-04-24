export function Tooltip({ content, children }) {
  return (
    <span className="ui-tooltip" tabIndex={0}>
      {children}
      <span className="ui-tooltip__bubble" role="tooltip">
        {content}
      </span>
    </span>
  );
}
