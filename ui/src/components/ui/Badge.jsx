import React from 'react';

function Badge({ children, color = 'var(--blue)', bg, icon: Icon, size = 'sm', gradient }) {
  const sizes = { xs: { p: '2px 6px', f: 10, i: 9 }, sm: { p: '3px 10px', f: 11, i: 11 }, md: { p: '5px 14px', f: 12, i: 12 } };
  const s = sizes[size] || sizes.sm;
  
  const style = {
    padding: s.p,
    fontSize: s.f,
    background: gradient || bg || 'transparent',
    border: `1px solid ${color}`,
    color: color,
  };

  return (
    <span className="inline-flex items-center gap-1 rounded-full font-semibold tracking-wide" style={style}>
      {Icon && <Icon size={s.i}/>}
      {children}
    </span>
  );
}

export default Badge;
