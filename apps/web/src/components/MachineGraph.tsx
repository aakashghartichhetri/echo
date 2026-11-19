import { useState } from 'react';
import type { Machine } from '../types';

function positions(count: number): { x: number; y: number }[] {
  if (count === 1) return [{ x: 370, y: 210 }];
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
    return { x: 370 + Math.cos(angle) * 255, y: 210 + Math.sin(angle) * 104 };
  });
}

export function MachineGraph({ machine }: { machine: Machine }) {
  const [selected, setSelected] = useState(machine.initialState);
  const nodes = positions(machine.states.length);
  const active = machine.states.some((state) => state.id === selected) ? selected : machine.initialState;
  const outgoing = machine.transitions.filter((edge) => edge.from === active);

  return <div className="graph-wrap">
    <div className="panel-heading-row"><div><h3>Learned state machine</h3><p>Select a state to inspect its actions and outcomes.</p></div><span className="tag">MEALY MACHINE</span></div>
    <svg viewBox="0 0 740 415" className="machine-svg" role="img" aria-label={`State machine with ${nodes.length} inferred states; selected state S${active}.`}>
      <defs><marker id="echo-edge-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="var(--graph-edge)"/></marker></defs>
      {nodes[machine.initialState] && <>
        <path d={`M${nodes[machine.initialState]!.x - 102} ${nodes[machine.initialState]!.y} H${nodes[machine.initialState]!.x - 43}`} className="graph-edge" strokeDasharray="6 6" markerEnd="url(#echo-edge-arrow)"/>
        <text x={nodes[machine.initialState]!.x - 107} y={nodes[machine.initialState]!.y - 13} className="graph-start">start</text>
      </>}
      {outgoing.map((edge, index) => {
        const from = nodes[edge.from];
        const to = nodes[edge.to];
        if (!from || !to) return null;
        if (edge.from === edge.to) {
          return <path key={`${edge.action}-${index}`} d={`M${from.x - 13} ${from.y - 35} C${from.x - 83} ${from.y - 119}, ${from.x + 83} ${from.y - 119}, ${from.x + 13} ${from.y - 35}`} className="graph-edge" markerEnd="url(#echo-edge-arrow)"/>;
        }
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy);
        const ux = dx / length;
        const uy = dy / length;
        const fromX = from.x + ux * 40;
        const fromY = from.y + uy * 40;
        const toX = to.x - ux * 46;
        const toY = to.y - uy * 46;
        const offset = (index - outgoing.length / 2 + .5) * 17;
        return <path key={`${edge.action}-${index}`} d={`M${fromX} ${fromY} Q${(fromX + toX) / 2 - uy * offset} ${(fromY + toY) / 2 + ux * offset} ${toX} ${toY}`} className="graph-edge" markerEnd="url(#echo-edge-arrow)"/>;
      })}
      {machine.states.map((state) => {
        const node = nodes[state.id];
        if (!node) return null;
        return <g key={state.id} className={`graph-node ${active === state.id ? 'active' : ''}`}>
          <circle cx={node.x} cy={node.y} r={active === state.id ? 39 : 36}/>
          <text x={node.x} y={node.y + 6} textAnchor="middle">S{state.id}</text>
        </g>;
      })}
    </svg>
    <div className="state-pills" aria-label="Choose state to inspect">
      {machine.states.map((state) => <button type="button" key={state.id} aria-pressed={active === state.id} className={`state-pill ${active === state.id ? 'selected' : ''}`} onClick={() => setSelected(state.id)}>S{state.id} <span>{state.accessSequence.join(' → ') || 'initial state'}</span></button>)}
    </div>
    <div className="transition-table-wrap"><table className="data-table compact"><thead><tr><th>FROM</th><th>ACTION</th><th>OUTPUT</th><th>NEXT STATE</th></tr></thead><tbody>{outgoing.map((edge) => <tr key={`${edge.from}-${edge.action}`}><td>S{edge.from}</td><td><code>{edge.action}</code></td><td><code className="result-value">{edge.output}</code></td><td>S{edge.to}</td></tr>)}</tbody></table></div>
  </div>;
}
