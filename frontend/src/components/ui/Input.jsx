export function Input({
  label,
  description,
  multiline = false,
  className = '',
  inputClassName = '',
  ...props
}) {
  const fieldClassName = ['ui-input__field', inputClassName].filter(Boolean).join(' ');

  return (
    <label className={['ui-input', className].filter(Boolean).join(' ')}>
      {label ? <span className="ui-input__label">{label}</span> : null}

      {multiline ? (
        <textarea className={fieldClassName} {...props} />
      ) : (
        <input className={fieldClassName} {...props} />
      )}

      {description ? <span className="ui-input__description">{description}</span> : null}
    </label>
  );
}
