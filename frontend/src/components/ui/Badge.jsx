export function Badge({ children, tone = 'primary', className = '' }) {
  return (
    <span className={['ui-badge', `ui-badge--${tone}`, className].filter(Boolean).join(' ')}>
      {children}
    </span>
  );
}
