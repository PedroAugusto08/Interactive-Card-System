import { useEffect } from 'react';

import { Button } from './Button';
import { Card } from './Card';

export function Modal({
  open,
  title,
  description,
  children,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  onConfirm,
  onClose,
  isLoading = false,
}) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose?.();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="ui-modal" onClick={onClose} role="presentation">
      <div className="ui-modal__panel" onClick={(event) => event.stopPropagation()}>
        <Card glow title={title} description={description}>
          {children}

          <div className="ui-modal__footer">
            {cancelLabel ? (
              <Button variant="secondary" onClick={onClose}>
                {cancelLabel}
              </Button>
            ) : null}
            <Button loading={isLoading} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
