function buildButtonClassName({ variant, size, loading, className }) {
  return [
    'ui-button',
    `ui-button--${variant}`,
    `ui-button--${size}`,
    loading ? 'is-loading' : '',
    className || '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  disabled = false,
  type = 'button',
  ...props
}) {
  return (
    <button
      {...props}
      className={buildButtonClassName({ variant, size, loading, className })}
      disabled={disabled || loading}
      type={type}
    >
      {loading ? <span aria-hidden="true" className="ui-button__spinner" /> : null}
      <span>{children}</span>
    </button>
  );
}
