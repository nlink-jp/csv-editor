import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type CommitDirection = 'none' | 'up' | 'down' | 'left' | 'right';

// Narrow columns still get a usable editor. The editor is absolutely
// positioned (see App.css), so widening past the column overlays the
// neighbouring cells rather than reflowing the table.
const MIN_EDITOR_WIDTH = 160;

interface CellEditorProps {
    initialValue: string;
    width: number;
    height: number;
    onCommit: (value: string, direction: CommitDirection) => void;
    onCancel: () => void;
}

// CellEditor renders a <textarea> overlay positioned inside a table cell.
// Textarea (instead of <input>) lets cells with embedded newlines (from
// RFC 4180-quoted CSV fields) be both displayed and edited intact.
//
// Key bindings (Excel-style):
//   - Enter       → commit ('down')
//   - Shift+Enter → commit ('up')
//   - Alt+Enter   → insert a newline
//   - Tab / Shift+Tab → commit ('right' / 'left')
//   - Esc         → cancel
//
// IME safety: WebKit fires keydown(Enter) and compositionend in different
// orders depending on the IME / browser version. We combine four guards:
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
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const composingRef = useRef(false);
    const compositionEndAtRef = useRef(0);
    const settledRef = useRef(false);

    const editorWidth = Math.max(width, MIN_EDITOR_WIDTH);

    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.select();
    }, []);

    // Auto-grow the textarea to fit its content so neither a horizontal
    // nor a vertical scrollbar is needed in the common case. This matters
    // most on Windows, where classic (non-overlay) scrollbars consume
    // ~17px each — over half of a ~28px-tall cell editor, hiding the text
    // being edited (issue #2). With CSS white-space: pre-wrap the content
    // wraps instead of overflowing horizontally, and here we match the
    // height to the wrapped content. The editor is absolutely positioned
    // (App.css) so growing it overlays neighbouring cells rather than
    // reflowing the table. Runs after every value change.
    useLayoutEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    }, [value, editorWidth]);

    const commit = (direction: CommitDirection) => {
        if (settledRef.current) return;
        settledRef.current = true;
        onCommit(value, direction);
    };

    const cancel = () => {
        if (settledRef.current) return;
        settledRef.current = true;
        onCancel();
    };

    const isIME = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing) return true;
        if (composingRef.current) return true;
        if (e.keyCode === 229) return true;
        if (Date.now() - compositionEndAtRef.current < 50) return true;
        return false;
    };

    return (
        <textarea
            ref={inputRef}
            value={value}
            className="vt-cell-editor"
            style={{ width: editorWidth, minHeight: height }}
            rows={1}
            spellCheck={false}
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
                    if (e.altKey) {
                        // Alt+Enter inserts a literal newline at the cursor.
                        // Let the textarea's default behaviour handle it.
                        return;
                    }
                    e.preventDefault();
                    commit(e.shiftKey ? 'up' : 'down');
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancel();
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                    commit(e.shiftKey ? 'left' : 'right');
                }
            }}
            onBlur={() => commit('none')}
        />
    );
}
