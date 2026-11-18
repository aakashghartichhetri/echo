import { useState } from 'react';
import type { Machine } from '../types';

function positions(count: number): { x: number; y: number }[] {
  if (count === 1) return [{ x: 350, y: 160 }];
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / count;
    return { x: 350 + Math.cos(angle) * 250, y: 158 + Math.sin(angle) * 108 };
  });
}

export function MachineGraph({ machine }: { machine: Machine }) {
  const [selected, setSelected] = useState(0);
  const nodes = positions(machine.states.length);
  const active = machine.states.some((state) => state.id === selected) ? selected : 0;
  const outgoing = machine.transitions.filter((edge) => edge.from === active);

  return (
    <div className="graph-wrap">
      <div className="panel-heading-row">
        <div><h3>Inferred state machine</h3><p>Click a state below to inspect its transitions.</p></div>
        <span className="tag">MEALY MACHINE</span>
      </div>
      <svg viewBox="0 0 700 325" className="machine-svg" role="img" aria-label={`State machine with ${nodes.length} inferred states. Selected state S${active}.`}>
        <defs>
          <marker id="edge-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#8294b6" /></marker>
        </defs>
        {nodes[0] && <>
          <path d={`M${nodes[0].x - 90} ${nodes[0].y} H${nodes[0].x - 40}`} stroke="#607493" strokeWidth="2" strokeDasharray="5 5" markerEnd="url(#edge-arrow)" />
          <text x={nodes[0].x - 118} y={nodes[0].y - 13} fill="#8192b3" fontSize="12">start</text>
        </>}
        {outgoing.map((edge, i) => {
          const from = nodes[edge.from];
          const to = nodes[edge.to];
          if (!from || !to) return null;
          if (edge.from === edge.to) {
            return <path key={`${edge.action}-${i}`} d={`M${from.x - 12} ${from.y - 26} C${from.x - 65} ${from.y - 95},${from.x + 65} ${from.y - 95},${from.x + 12} ${from.y - 26}`} fill="none" stroke="#92a3c5" strokeWidth="1.8" markerEnd="url(#edge-arrow)" />;
          }
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const length = Math.hypot(dx, dy);
          const ux = dx / length, uy = dy / length;
          const fromX = from.x + ux * 35, fromY = from.y + uy * 35;
          const toX = to.x - ux * 40, toY = to.y - uy * 40;
          const offset = (i - outgoing.length / 2 + 0.5) * 14;
          return <path key={`${edge.action}-${i}`} d={`M${fromX} ${fromY} Q${(fromX + toX) / 2 - uy * offset} ${(fromY + toY) / 2 + ux * offset} ${toX} ${toY}`} fill="none" stroke="#8b9dbb" strokeWidth="1.8" markerEnd="url(#edge-arrow)" />;
        })}
        {machine.states.map((state) => {
          const node = nodes[state.id];
          if (!node) return null;
          return <g key={state.id}>
            <circle cx={node.x} cy={node.y} r={active === state.id ? 36 : 32} fill={active === state.id ? '#6457b8' : '#1a263e'} stroke={active === state.id ? '#b2a5ff' : '#596e95'} strokeWidth="2" />
            <text x={node.x} y={node.y + 5} fontSize="16" fontWeight="700" textAnchor="middle" fill="#fff">S{state.id}</text>
          </g>;
        })}
      </svg>
      <div className="state-pills" aria-label="Choose state to inspect">
        {machine.states.map((state) => <button type="button" key={state.id} aria-pressed={active === state.id} className={`state-pill ${active === state.id ? 'selected' : ''}`} onClick={() => setSelected(state.id)}>S{state.id} <span>{state.accessSequence.join(' → ') || 'initial'}</span></button>)}
      </div>
      <div className="transition-table-wrap">
        <table className="data-table compact">
          <thead><tr><th>From</th><th>Action</th><th>Output</th><th>Next state</th></tr></thead>
          <tbody>{outgoing.map((edge) => <tr key={`${edge.from}-${edge.action}`}><td>S{edge.from}</td><td><code>{edge.action}</code></td><td><code className="result-value">{edge.output}</code></td><td>S{edge.to}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
