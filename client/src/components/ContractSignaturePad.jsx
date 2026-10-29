import { useEffect, useRef } from 'react';

const WIDTH = 600, HEIGHT = 180, MAX_POINTS = 2000;

export default function ContractSignaturePad({ signature, onChange, disabled, label = 'Draw your signature', clearLabel = 'Clear' }) {
    const strokeRef = useRef(null);
    const signatureRef = useRef(signature);
    useEffect(() => { signatureRef.current = signature; }, [signature]);
    function point(event) {
        const bounds = event.currentTarget.getBoundingClientRect();
        return [Math.max(0, Math.min(WIDTH, Math.round((event.clientX - bounds.left) / bounds.width * WIDTH * 100) / 100)),
            Math.max(0, Math.min(HEIGHT, Math.round((event.clientY - bounds.top) / bounds.height * HEIGHT * 100) / 100))];
    }
    function start(event) {
        if (disabled || event.button !== 0 || (signatureRef.current.strokes || []).length >= 32) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        const strokes = [...signatureRef.current.strokes, [point(event)]];
        strokeRef.current = { pointerId: event.pointerId, index: strokes.length - 1 };
        const next = { type: 'drawn', width: WIDTH, height: HEIGHT, strokes };
        signatureRef.current = next; onChange(next);
    }
    function move(event) {
        const active = strokeRef.current;
        if (!active || disabled || active.pointerId !== event.pointerId) return;
        const previous = signatureRef.current;
        if (previous.strokes.reduce((count, stroke) => count + stroke.length, 0) >= MAX_POINTS) return;
        const strokes = previous.strokes.map((stroke, index) => index === active.index ? [...stroke, point(event)] : stroke);
        const next = { ...previous, strokes };
        signatureRef.current = next; onChange(next);
    }
    const stop = () => { strokeRef.current = null; };
    function clear() {
        if (disabled) return;
        stop();
        const next = { type: 'drawn', width: WIDTH, height: HEIGHT, strokes: [] };
        signatureRef.current = next;
        onChange(next);
    }
    const hasMarks = signature.strokes.some(stroke => stroke.length > 0);
    return <div className="native-signature-pad">
        <svg data-native-signature-drawing width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" tabIndex={disabled ? -1 : 0} aria-label={label} aria-disabled={disabled || undefined}
            onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}>
            {signature.strokes.map((stroke, index) => <polyline key={index} points={stroke.map(point => point.join(',')).join(' ')} fill="none" stroke="#e5d9fa" strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />)}
        </svg>
        {!hasMarks && <span className="native-signature-pad-placeholder" aria-hidden="true">{label}</span>}
        <button type="button" className="native-signature-clear" aria-label={clearLabel} title={clearLabel} disabled={disabled || !hasMarks} onClick={clear}>×</button>
    </div>;
}
