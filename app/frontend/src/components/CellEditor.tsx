import { useEffect, useRef, useState } from 'react';

interface CellEditorProps {
    initialValue: string;
    width: number;
    height: number;
    onCommit: (value: string) => void;
    onCancel: () => void;
}

// CellEditor renders an <input> overlay positioned inside a table cell.
// IME safety: WebKit fires keydown(Enter) and compositionend in different
// orders depending on the IME / browser version. We combine three guards:
//   1. e.nativeEvent.isComposing      (modern, works in most cases)
//   2. composingRef                   (catches isComposing=false during composition)
//   3. compositionEndAt timing buffer (50ms after compositionend → still IME)
//   4. keyCode === 229                (legacy Process-key fallback)
export function CellEditor({
    initialValue,
    width,
    height,
    onCommit,
    onCancel,
}: CellEditorProps) {
    const [value, setValue] = useState(initialValue);
    const inputRef = useRef<HTMLInputElement>(null);
    const composingRef = useRef(false);
    const compositionEndAtRef = useRef(0);
    const settledRef = useRef(false);

    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.select();
    }, []);

    const commit = () => {
        if (settledRef.current) return;
        settledRef.current = true;
        onCommit(value);
    };

    const cancel = () => {
        if (settledRef.current) return;
        settledRef.current = true;
        onCancel();
    };

    const isIME = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.nativeEvent.isComposing) return true;
        if (composingRef.current) return true;
        if (e.keyCode === 229) return true;
        if (Date.now() - compositionEndAtRef.current < 50) return true;
        return false;
    };

    return (
        <input
            ref={inputRef}
            type="text"
            value={value}
            className="vt-cell-editor"
            style={{ width, height }}
            onChange={(e) => setValue(e.target.value)}
            onCompositionStart={() => {
                composingRef.current = true;
            }}
            onCompositionEnd={() => {
                composingRef.current = false;
                compositionEndAtRef.current = Date.now();
            }}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (isIME(e)) return;
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commit();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancel();
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                    commit();
                }
            }}
            onBlur={commit}
        />
    );
}
