'use client';

import { HoloField } from '@mk7s/hologpu-react';
import gradient from '@mk7s/hologpu/effects/gradient-oklch';

// The effect only runs in the browser, so the field is a client component while the page around it
// stays server-rendered.
export function Field() {
  return (
    <HoloField effect={gradient} preset="lagoon" style={{ minHeight: '60vh' }}>
      <p style={{ textAlign: 'center' }}>Rendered on the server, animated on the client.</p>
    </HoloField>
  );
}
