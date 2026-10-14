import { HoloField } from '@mk7s/hologpu-react';
import gradient from '@mk7s/hologpu/effects/gradient-oklch';

export function App() {
  return (
    <HoloField
      className="hero"
      effect={gradient}
      preset="dusk"
      style={{ minHeight: '70vh' }}
    >
      <h1>A React consumer</h1>
    </HoloField>
  );
}
