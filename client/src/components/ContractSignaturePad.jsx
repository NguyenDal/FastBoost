import { useEffect, useRef } from 'react';

const WIDTH = 600, HEIGHT = 180, MAX_POINTS = 2000;

export default function ContractSignaturePad({ signature, onChange, disabled }) {
    const canvasRef = useRef(null);
    const strokeRef = useRef(null);
    const signatureRef = useRef(signature);
    useEffect(() => { signatureRef.current = signature; }, [signature]);
    useEffect(() => {
        const context = canvasRef.current?.getContext('2d');
        if (!context) return;
        context.clearRect(0, 0, WIDTH, HEIGHT);
        context.strokeStyle = '#252039'; context.lineWidth = 2.5; context.lineCap = 'round'; context.lineJoin = 'round';
        for (const stroke of signature.strokes || []) {
            if (!stroke.length) continue;
            context.beginPath(); context.moveTo(...stroke[0]);
            for (const point of stroke.slice(1)) context.lineTo(...point);
            context.stroke();
        }
    }, [signature]);
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
    return <div className="native-signature-pad">
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} aria-label="Draw your signature" aria-describedby="native-drawing-help"
            onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} />
        <div><p id="native-drawing-help">Draw with your mouse, pen or finger. You can use a typed signature instead.</p>
            <button type="button" disabled={disabled || !signature.strokes.length} onClick={() => { stop(); onChange({ type: 'drawn', width: WIDTH, height: HEIGHT, strokes: [] }); }}>Clear</button></div>
    </div>;
}
