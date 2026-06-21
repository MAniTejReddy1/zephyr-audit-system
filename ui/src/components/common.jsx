import React, { useState, useCallback, useEffect, useRef } from 'react';
import { T } from '../theme';

export function useResizable(initialWidth, minWidth = 200, maxWidth = 600) {
  const [width, setWidth] = useState(initialWidth);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = useCallback((e) => {
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth.current + delta));
      setWidth(newWidth);
    };
    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [minWidth, maxWidth]);

  return { width, handleMouseDown };
}


export function Badge({ children, color = T.blue, bg, icon: Icon, size = 'sm', gradient }) {
  const sizes = { xs: { p: '2px 6px', f: 10, i: 9 }, sm: { p: '3px 10px', f: 11, i: 11 }, md: { p: '5px 14px', f: 12, i: 12 } };
  const s = sizes[size];
  return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: s.p, borderRadius: 20, fontSize: s.f, fontWeight: 600,
        background: gradient || bg || `${color}20`, color: gradient ? '#fff' : color,
        letterSpacing: '.02em'
      }}>
      {Icon && <Icon size={s.i}/>}
        {children}
    </span>
  );
}

export function IconButton({ icon: Icon, onClick, active, disabled, size = 16, title, variant = 'default' }) {
  const variants = {
    default: { bg: active ? T.blueDim : 'transparent', border: active ? T.blue : T.border, color: active ? T.blue : T.textMuted },
    ghost: { bg: 'transparent', border: 'transparent', color: T.textMuted },
    primary: { bg: T.blue, border: T.blue, color: '#fff' },
  };
  const v = variants[variant];
  return (
      <button
          onClick={onClick}
          disabled={disabled}
          title={title}
          aria-label={title}
          style={{
            width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 8, border: `1px solid ${v.border}`,
            background: v.bg, color: v.color, opacity: disabled ? 0.5 : 1
          }}
      >
        <Icon size={size}/>
      </button>
  );
}

export function EmptyState({ icon: Icon, title, description, action, actionLabel }) {
  return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ textAlign: 'center', maxWidth: 300 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20,
            background: `linear-gradient(135deg, ${T.bgSurface} 0%, ${T.card} 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px',
            border: `1px solid ${T.border}`
          }}>
            <Icon size={32} color={T.textDim}/>
          </div>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: T.text, marginBottom: 8 }}>{title}</h3>
          <p style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.6, marginBottom: action ? 16 : 0 }}>{description}</p>
          {action && (
              <button onClick={action} style={{
                padding: '10px 20px', borderRadius: 8, border: 'none',
                background: T.gradBlue, color: '#fff', fontSize: 13, fontWeight: 500
              }}>{actionLabel}</button>
          )}
        </div>
      </div>
  );
}

export function SkeletonCard({ height = 92 }) {
  return (
      <div style={{
        height, marginBottom: 12, borderRadius: 16, border: `1px solid ${T.borderLight}`,
        background: `linear-gradient(90deg, ${T.card} 25%, ${T.cardHover} 37%, ${T.card} 63%)`,
        backgroundSize: '400% 100%', animation: 'shimmer 1.4s ease infinite',
      }}/>
  );
}

export function ResizeHandle({ onMouseDown }) {
  return (
      <div
          className="resize-handle hide-narrow"
          onMouseDown={onMouseDown}
          onDoubleClick={onMouseDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          style={{
            width: 12, flexShrink: 0, cursor: 'col-resize', background: 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background .2s ease'
          }}
      >
        <div style={{ width: 2, height: '100%', background: T.border, transition: 'background .2s ease' }}/>
      </div>
  );
}
