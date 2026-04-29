import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { Button } from './Button';
import { Card } from './Card';

let modalLockCount = 0;
let lockedScrollY = 0;

function lockDocumentScroll() {
  if (typeof document === 'undefined') {
    return;
  }

  if (modalLockCount === 0) {
    lockedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
  }

  modalLockCount += 1;
}

function unlockDocumentScroll() {
  if (typeof document === 'undefined' || modalLockCount === 0) {
    return;
  }

  modalLockCount -= 1;

  if (modalLockCount === 0) {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    document.body.style.overflow = '';
    window.scrollTo(0, lockedScrollY);
  }
}

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

    lockDocumentScroll();

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose?.();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      unlockDocumentScroll();
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return createPortal(
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
    </div>,
    document.body
  );
}
