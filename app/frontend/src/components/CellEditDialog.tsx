import { useEffect, useRef, useState } from 'react';

interface CellEditDialogProps {
    initialValue: string;
    rowIndex: number;
    columnIndex: number;
    onSave: (value: string) => void;
    onCancel: () => void;
}

export function CellEditDialog({
    initialValue,
    rowIndex,
    columnIndex,
    onSave,
    onCancel,
}: CellEditDialogProps) {
    const [value, setValue] = useState(initialValue);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const composingRef = useRef(false);
    const compositionEndAtRef = useRef(0);

    useEffect(() => {
        textareaRef.current?.focus();
        textareaRef.current?.select();
    }, []);

    const isIME = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing) return true;
        if (composingRef.current) return true;
        if (e.keyCode === 229) return true;
        if (Date.now() - compositionEndAtRef.current < 50) return true;
        return false;
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (isIME(e)) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        } else if (e.key === 'Enter' && !e.altKey) {
            e.preventDefault();
            onSave(value);
        }
    };

    return (
        <div className="cell-edit-dialog-overlay" onClick={onCancel}>
            <div
                className="cell-edit-dialog"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="cell-edit-dialog-header">
                    Edit Cell ({rowIndex + 1}, {columnIndex + 1})
                </div>
                <textarea
                    ref={textareaRef}
                    className="cell-edit-dialog-textarea"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onCompositionStart={() => {
                        composingRef.current = true;
                    }}
                    onCompositionEnd={() => {
                        composingRef.current = false;
                        compositionEndAtRef.current = Date.now();
                    }}
                    onKeyDown={handleKeyDown}
                    spellCheck={false}
                />
                <div className="cell-edit-dialog-buttons">
                    <button
                        className="cell-edit-dialog-btn cell-edit-dialog-btn-cancel"
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        className="cell-edit-dialog-btn cell-edit-dialog-btn-save"
                        onClick={() => onSave(value)}
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
}